// Object storage adapter (replaces Supabase Storage for the private
// work-os-screenshots bucket). Drivers:
//   - "r2"    Cloudflare R2 via the S3 API (production).
//   - "local" filesystem under .storage-data/ (development / tests).
// Selection via OBJECT_STORAGE_DRIVER ("r2" | "local"); defaults to "r2"
// when R2 credentials are present, else "local".
// See docs/NEON-MIGRATION-PLAN.md §3 (Storage).
// Node builtins are loaded lazily with turbopackIgnore so this module stays
// bundle-safe for Edge instrumentation (see scripts/neon docs).
import type { promises as FsPromises } from "node:fs";
import type PathMod from "node:path";

let fsP: typeof FsPromises | null = null;
async function fs(): Promise<typeof FsPromises> {
  if (!fsP) fsP = (await import(/* turbopackIgnore: true */ "node:fs/promises")) as typeof FsPromises;
  return fsP;
}
let pathM: typeof PathMod | null = null;
async function pathMod(): Promise<typeof PathMod> {
  if (!pathM) pathM = (await import(/* turbopackIgnore: true */ "node:path")) as typeof PathMod;
  return pathM;
}

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
  const mod = (await import(/* turbopackIgnore: true */ "@aws-sdk/client-s3")) as unknown as R2Module;
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

let localRootCache: string | null = null;
async function localRoot(): Promise<string> {
  if (!localRootCache) {
    const path = await pathMod();
    localRootCache = path.join(path.resolve(process.cwd()), ".storage-data");
  }
  return localRootCache;
}

async function localPath(bucket: string, objectPath: string): Promise<string> {
  const path = await pathMod();
  const root = await localRoot();
  const full = path.resolve(root, bucket, objectPath);
  if (!full.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("invalid storage path");
  }
  return full;
}

const local: StorageBackend = {
  async upload(bucket, objectPath, body, options) {
    try {
      const full = await localPath(bucket, objectPath);
      const path = await pathMod();
      const fsp = await fs();
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, body);
      void options;
      return { data: { path: objectPath }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
  async download(bucket, objectPath) {
    try {
      const fsp = await fs();
      const body = await fsp.readFile(await localPath(bucket, objectPath));
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
      const fsp = await fs();
      await Promise.all(objectPaths.map(async (p) => fsp.rm(await localPath(bucket, p), { force: true })));
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
