// Object storage adapter (replaces Supabase Storage for the private
// work-os-screenshots bucket). Drivers:
//   - "r2"    Cloudflare R2 via the S3 API (production).
//   - "local" filesystem under .storage-data/ (development / tests).
// Selection via OBJECT_STORAGE_DRIVER ("r2" | "local"); defaults to "r2"
// when R2 credentials are present, else "local".
// See docs/NEON-MIGRATION-PLAN.md §3 (Storage).
import { promises as fs } from "node:fs";
import path from "node:path";

export type StorageUploadOptions = {
  contentType?: string;
  upsert?: boolean;
};

export type StorageError = { message: string };

type UploadResult = { data: { path: string } | null; error: StorageError | null };
type DownloadResult = { data: { arrayBuffer: ArrayBuffer } | null; error: StorageError | null };
type RemoveResult = { data: { message: string } | null; error: StorageError | null };

type S3LikeClient = { send: (cmd: unknown) => Promise<unknown> };

type R2Module = {
  S3Client: new (cfg: Record<string, unknown>) => S3LikeClient;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectsCommand: new (input: Record<string, unknown>) => unknown;
};

export type StorageBackend = {
  upload(bucket: string, objectPath: string, body: Buffer, options?: StorageUploadOptions): Promise<UploadResult>;
  download(bucket: string, objectPath: string): Promise<DownloadResult>;
  remove(bucket: string, objectPaths: string[]): Promise<RemoveResult>;
};

let r2Ctx: { mod: R2Module; client: S3LikeClient } | null = null;
let r2Tried = false;

async function getR2(): Promise<{ mod: R2Module; client: S3LikeClient } | null> {
  if (r2Tried) return r2Ctx;
  r2Tried = true;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  const mod = (await import("@aws-sdk/client-s3")) as unknown as R2Module;
  const client = new mod.S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  r2Ctx = { mod, client };
  return r2Ctx;
}

const r2: StorageBackend = {
  async upload(bucket, objectPath, body, options) {
    const ctx = await getR2();
    if (!ctx) return { data: null, error: { message: "R2 credentials are not configured" } };
    try {
      await ctx.client.send(
        new ctx.mod.PutObjectCommand({
          Bucket: bucket,
          Key: objectPath,
          Body: body,
          ContentType: options?.contentType ?? "application/octet-stream",
        }),
      );
      return { data: { path: objectPath }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
  async download(bucket, objectPath) {
    const ctx = await getR2();
    if (!ctx) return { data: null, error: { message: "R2 credentials are not configured" } };
    try {
      const res = (await ctx.client.send(
        new ctx.mod.GetObjectCommand({ Bucket: bucket, Key: objectPath }),
      )) as { Body: AsyncIterable<Uint8Array> };
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.length;
      }
      return {
        data: { arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer },
        error: null,
      };
    } catch (err) {
      const code = (err as { name?: string }).name;
      if (code === "NoSuchKey") return { data: null, error: { message: "The specified key does not exist." } };
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
  async remove(bucket, objectPaths) {
    const ctx = await getR2();
    if (!ctx) return { data: null, error: { message: "R2 credentials are not configured" } };
    if (!objectPaths.length) return { data: { message: "Nothing to delete" }, error: null };
    try {
      await ctx.client.send(
        new ctx.mod.DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objectPaths.map((Key) => ({ Key })) },
        }),
      );
      return { data: { message: "Deleted" }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};

// ── Local filesystem driver ──

const localRoot = path.join(process.cwd(), ".storage-data");

function localPath(bucket: string, objectPath: string): string {
  const full = path.resolve(localRoot, bucket, objectPath);
  if (!full.startsWith(path.resolve(localRoot) + path.sep)) {
    throw new Error("invalid storage path");
  }
  return full;
}

const local: StorageBackend = {
  async upload(bucket, objectPath, body, options) {
    try {
      const full = localPath(bucket, objectPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
      void options;
      return { data: { path: objectPath }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
  async download(bucket, objectPath) {
    try {
      const body = await fs.readFile(localPath(bucket, objectPath));
      return {
        data: {
          arrayBuffer: body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ) as ArrayBuffer,
        },
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message: /ENOENT/.test(msg) ? "The specified key does not exist." : msg } };
    }
  },
  async remove(bucket, objectPaths) {
    try {
      await Promise.all(objectPaths.map((p) => fs.rm(localPath(bucket, p), { force: true })));
      return { data: { message: "Deleted" }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};

export function getStorageBackend(): StorageBackend {
  const driver = process.env.OBJECT_STORAGE_DRIVER;
  if (driver === "local") return local;
  if (driver === "r2") return r2;
  return process.env.R2_ACCOUNT_ID ? r2 : local;
}
