import { getPool } from "./pool";

export type DbError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

// Deliberately loose row typing (any) to mirror supabase-js untyped behavior —
// call sites destructure row properties directly.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ExecResult = { data: any; error: DbError | null; count?: number | null };
export type ListResult = { data: any[] | null; error: DbError | null; count?: number | null };
export type SingleResult = { data: any; error: DbError | null; count?: number | null };

export type DbResult<T> = {
  data: T;
  error: DbError | null;
  count?: number | null;
};

type OrderSpec = { column: string; ascending: boolean; nullsFirst?: boolean };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: ${name}`);
  return `"${name}"`;
}

type Filter = { kind: "op"; col: string; op: string; val: unknown; negate?: boolean } | { kind: "or"; raw: string };

type EmbedSpec = {
  alias: string;
  table: string;
  columns: string[] | "*";
};

type ParsedSelect = {
  base: string; // "*" or explicit base columns
  embeds: EmbedSpec[];
};

function parseSelect(spec: string | undefined): ParsedSelect {
  if (!spec || spec.trim() === "*" || spec.trim() === "") return { base: "*", embeds: [] };
  const parts: string[] = [];
  const embeds: EmbedSpec[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of spec) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const embedRe = /^([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/;
  const baseParts: string[] = [];
  for (const part of parts) {
    const embedMatch = part.match(embedRe);
    if (embedMatch) {
      const [, alias, table, cols] = embedMatch;
      embeds.push({
        alias,
        table,
        columns: cols.trim() === "*" ? "*" : cols.split(",").map((c) => c.trim()).filter(Boolean),
      });
    } else {
      baseParts.push(part);
    }
  }
  return { base: baseParts.length ? baseParts.join(", ") : "*", embeds };
}

function castParam(colType: string, val: unknown): unknown {
  return val;
}

export class PostgrestQuery {
  private table = "";
  private selectSpec: string | undefined;
  private filters: Filter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;
  private mode: "select" | "insert" | "update" | "delete" | "rpc" = "select";
  private insertRows: Record<string, unknown>[] = [];
  private writeValues: Record<string, unknown> = {};
  private onConflictCols: string | null = null;
  private ignoreDup = false;
  private countOption: "exact" | null = null;
  private headOption = false;
  private rpcName: string | null = null;
  private rpcArgs: Record<string, unknown> = {};

  from(table: string): this {
    this.table = table;
    return this;
  }

  select(spec?: string, options?: { count?: "exact"; head?: boolean }): this {
    this.selectSpec = spec;
    if (options?.count) this.countOption = options.count;
    if (options?.head) this.headOption = true;
    return this;
  }

  private addFilter(col: string, op: string, val: unknown, negate = false): this {    this.filters.push({ kind: "op", col, op, val, negate });
    return this;
  }

  eq(col: string, val: unknown) { return this.addFilter(col, "eq", val); }
  neq(col: string, val: unknown) { return this.addFilter(col, "neq", val); }
  gt(col: string, val: unknown) { return this.addFilter(col, "gt", val); }
  gte(col: string, val: unknown) { return this.addFilter(col, "gte", val); }
  lt(col: string, val: unknown) { return this.addFilter(col, "lt", val); }
  lte(col: string, val: unknown) { return this.addFilter(col, "lte", val); }
  like(col: string, val: string) { return this.addFilter(col, "like", val); }
  ilike(col: string, val: string) { return this.addFilter(col, "ilike", val); }
  is(col: string, val: unknown) { return this.addFilter(col, "is", val); }
  in(col: string, val: unknown[]) { return this.addFilter(col, "in", val); }
  contains(col: string, val: unknown) { return this.addFilter(col, "contains", val); }

  not(col: string, op: string, val: unknown) { return this.addFilter(col, op, val, true); }

  or(raw: string): this {
    this.filters.push({ kind: "or", raw });
    return this;
  }

  match(obj: Record<string, unknown>): this {
    for (const [col, val] of Object.entries(obj)) this.eq(col, val);
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single(): PostgrestSingleQuery {
    this.wantSingle = "single";
    return new PostgrestSingleQuery(this);
  }

  maybeSingle(): PostgrestSingleQuery {
    this.wantSingle = "maybeSingle";
    return new PostgrestSingleQuery(this);
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean; defaultToNull?: boolean }): this {
    this.mode = "insert";
    this.insertRows = Array.isArray(values) ? values : [values];
    if (options?.onConflict) this.onConflictCols = options.onConflict;
    if (options?.ignoreDuplicates) this.ignoreDup = true;
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    return this.insert(values, options);
  }

  update(values: Record<string, unknown>): this {
    this.mode = "update";
    this.writeValues = values;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  rpc(fn: string, args: Record<string, unknown> = {}): this {
    this.mode = "rpc";
    this.rpcName = fn;
    this.rpcArgs = args;
    return this;
  }

  // ── SQL generation ──

  private columnType(table: string, column: string): Promise<string | null> {
    return columnDataType(table, column);
  }

  private async buildWhere(params: unknown[]): Promise<string> {
    const clauses: string[] = [];
    for (const f of this.filters) {
      if (f.kind === "or") {
        clauses.push(`(${parseOrSpec(f.raw, params)})`);
        continue;
      }
      const colSql = ident(f.col);
      const op = f.op;
      const negate = f.negate === true;
      let clause: string;
      if (op === "is") {
        clause = f.val === null ? `${colSql} IS NULL` : `${colSql} = $${params.push(f.val)}`;
      } else if (op === "in") {
        // Accept both JS arrays and PostgREST list syntax "(a,b,c)" (used with .not/.or strings).
        const vals = Array.isArray(f.val)
          ? f.val
          : String(f.val).replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => coerceScalar(v.trim()));
        clause = `${colSql} IN (${vals.map((v) => `$${params.push(v)}`).join(", ")})`;
      } else if (op === "contains") {
        // Column type decides the cast: uuid[]/text[] vs jsonb.
        const colType = await this.columnType(this.table, f.col);
        if (colType === "ARRAY" || (Array.isArray(f.val) && !colType)) {
          clause = `${colSql} @> $${params.push(f.val)}`;
        } else {
          clause = `${colSql} @> $${params.push(JSON.stringify(f.val))}::jsonb`;
        }
      } else if (op === "ilike" || op === "like") {
        const kw = op === "ilike" ? "ILIKE" : "LIKE";
        clause = `${colSql} ${kw} $${params.push(f.val)}`;
      } else {
        const sqlOp = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
        if (!sqlOp) throw new Error(`unsupported operator: ${op}`);
        clause = `${colSql} ${sqlOp} $${params.push(castParam(op, f.val))}`;
      }
      clauses.push(negate ? `NOT (${clause})` : clause);
    }
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  private buildOrder(): string {
    if (!this.orders.length) return "";
    const parts = this.orders.map((o) => {
      const dir = o.ascending ? "ASC" : "DESC";
      const nulls = o.nullsFirst === undefined ? "" : o.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
      return `${ident(o.column)} ${dir}${nulls}`;
    });
    return ` ORDER BY ${parts.join(", ")}`;
  }

  private async runSql(sql: string, params: unknown[]): Promise<ExecResult> {
    try {
      const res = await getPool().query(sql, params);
      let rows: Record<string, unknown>[] = res.rows as Record<string, unknown>[];
      const parsed = parseSelect(this.selectSpec);
      if (parsed.embeds.length && rows.length) {
        rows = await resolveEmbeds(this.table, rows, parsed.embeds);
      }
      if (this.wantSingle) {
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "Results contain 2 rows, 1 was expected", hint: null },
          };
        }
        if (rows.length === 0) {
          if (this.wantSingle === "single") {
            return {
              data: null,
              error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "The result contains 0 rows", hint: null },
            };
          }
          return { data: null, error: null };
        }
        return { data: rows[0], error: null };
      }
      const out: ExecResult = { data: rows, error: null };
      if (this.countOption === "exact") out.count = this.headOption ? Number((res as unknown as { rowCount?: number }).rowCount ?? 0) : rows.length;
      return out;
    } catch (err) {
      const e = err as { message?: string; code?: string; detail?: string; hint?: string };
      return {
        data: null,
        error: { message: e.message ?? String(err), code: e.code, details: e.detail ?? null, hint: e.hint ?? null },
      };
    }
  }

  then<TResult1 = ListResult, TResult2 = never>(
    onfulfilled?: ((value: ListResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then((r) => r as ListResult).then(onfulfilled, onrejected);
  }

  async exec(): Promise<ExecResult> {
    if (this.mode === "rpc") {
      const keys = Object.keys(this.rpcArgs);
      const params = keys.map((k) => this.rpcArgs[k]);
      const named = keys.map((k, i) => `${ident(k)} := $${i + 1}`).join(", ");
      const sql = `SELECT * FROM ${ident(this.rpcName!)}(${named})`;
      return this.runSql(sql, params);
    }

    if (!this.table) throw new Error("no table selected");
    const t = ident(this.table);
    const params: unknown[] = [];
    const where = await this.buildWhere(params);
    const parsed = parseSelect(this.selectSpec);

    if (this.mode === "select") {
      if (this.countOption === "exact" && this.headOption) {
        const sql = `SELECT count(*)::int AS n FROM ${t}${where}`;
        try {
          const res = await getPool().query(sql, params);
          return { data: null, error: null, count: Number(res.rows[0]?.n ?? 0) };
        } catch (err) {
          const e = err as { message?: string; code?: string };
          return { data: null, error: { message: e.message ?? String(err), code: e.code }, count: null };
        }
      }
      let sql = `SELECT ${parsed.base === "*" ? "*" : parsed.base} FROM ${t}${where}${this.buildOrder()}`;
      if (this.limitN !== null) sql += ` LIMIT ${Number(this.limitN)}`;
      if (this.offsetN !== null) sql += ` OFFSET ${Number(this.offsetN)}`;
      return this.runSql(sql, params);
    }

    if (this.mode === "insert") {
      if (!this.insertRows.length) return { data: [], error: null };
      const cols = Object.keys(this.insertRows[0]);
      const jsonCols = new Set(
        (await Promise.all(cols.map(async (c) => [c, await columnDataType(this.table, c)] as const)))
          .filter(([, t]) => t === "json" || t === "jsonb")
          .map(([c]) => c),
      );
      const encode = (c: string, v: unknown): unknown => {
        // jsonb/json columns: pre-serialize so arrays don't hit pg's array-literal path.
        if (jsonCols.has(c) && v !== null && (typeof v === "object" || typeof v === "string")) {
          return JSON.stringify(v);
        }
        return v;
      };
      const colSql = cols.map(ident).join(", ");
      const tuples = this.insertRows.map((row) => {
        const vals = cols.map((c) => `$${params.push(encode(c, row[c] ?? null))}`);
        return `(${vals.join(", ")})`;
      });
      let sql = `INSERT INTO ${t} (${colSql}) VALUES ${tuples.join(", ")}`;
      if (this.onConflictCols) {
        const conflictCols = this.onConflictCols.split(",").map((c) => ident(c.trim())).join(", ");
        if (this.ignoreDup) {
          sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
        } else {
          const updates = cols.filter((c) => !this.onConflictCols!.split(",").map((x) => x.trim()).includes(c));
          sql += updates.length
            ? ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")}`
            : ` ON CONFLICT (${conflictCols}) DO NOTHING`;
        }
      }
      sql += ` RETURNING *`;
      const res = await this.runSql(sql, params);
      if (res.error) return res;
      return this.embedAfterWrite(res, parsed);
    }

    if (this.mode === "update") {
      const cols = Object.keys(this.writeValues);
      if (!cols.length) return { data: [], error: null };
      const sets = cols.map(async (c) => {
        let v = this.writeValues[c] ?? null;
        const t = await columnDataType(this.table, c);
        if ((t === "json" || t === "jsonb") && v !== null && (typeof v === "object" || typeof v === "string")) {
          v = JSON.stringify(v);
        }
        return `${ident(c)} = $${params.push(v)}`;
      });
      const setSql = (await Promise.all(sets)).join(", ");
      const sql = `UPDATE ${t} SET ${setSql}${where} RETURNING *`;
      const res = await this.runSql(sql, params);
      if (res.error) return res;
      return this.embedAfterWrite(res, parsed);
    }

    if (this.mode === "delete") {
      const sql = `DELETE FROM ${t}${where} RETURNING *`;
      return this.runSql(sql, params);
    }

    throw new Error(`unsupported mode: ${this.mode}`);
  }

  private async embedAfterWrite(res: ExecResult, parsed: ParsedSelect): Promise<ExecResult> {
    if (!parsed.embeds.length || !Array.isArray(res.data) || !res.data.length) return res;
    const rows = await resolveEmbeds(this.table, res.data, parsed.embeds);
    const wrapped: ExecResult = { data: rows, error: null };
    return this.wantSingle ? this.applySingle(wrapped) : wrapped;
  }

  private applySingle(res: ExecResult): ExecResult {
    const rows = (res.data ?? []) as Record<string, unknown>[];
    if (rows.length > 1) {
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: null, hint: null } };
    }
    if (rows.length === 0) {
      if (this.wantSingle === "single") return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116", details: "The result contains 0 rows", hint: null } };
      return { data: null, error: null };
    }
    return { data: rows[0], error: null };
  }
}

// PostgREST or-spec: "col.op.val,and(col.op.val,...),or(...)"
// Terms may nest and()/or() groups (the agent runner relies on this for
// upload-job recovery polling), so split only on top-level commas.
export function splitTopLevelList(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of raw) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseOrTerm(term: string, params: unknown[]): string {
  const group = term.match(/^(and|or)\(([\s\S]*)\)$/);
  if (group) {
    const joiner = group[1] === "and" ? " AND " : " OR ";
    return `(${splitTopLevelList(group[2]).map((inner) => parseOrTerm(inner, params)).join(joiner)})`;
  }
  const m = term.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([a-z]+)\.([\s\S]*)$/);
  if (!m) throw new Error(`invalid or() term: ${term}`);
  const [, col, op, rawVal] = m;
  const colSql = ident(col);
  if (op === "is") return rawVal === "null" ? `${colSql} IS NULL` : `${colSql} = $${params.push(rawVal)}`;
  if (op === "in") {
    const vals = rawVal.replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => v.trim());
    return `${colSql} IN (${vals.map((v) => `$${params.push(coerceScalar(v))}`).join(", ")})`;
  }
  const sqlOp = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" }[op];
  if (!sqlOp) throw new Error(`unsupported or() operator: ${op}`);
  return `${colSql} ${sqlOp} $${params.push(coerceScalar(rawVal))}`;
}

function parseOrSpec(raw: string, params: unknown[]): string {
  return splitTopLevelList(raw)
    .map((term) => parseOrTerm(term, params))
    .join(" OR ");
}

function coerceScalar(v: string): unknown {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// ── Embedding resolution ──

type EmbedRelation =
  | { kind: "to-one"; fkColumn: string } // belongs-to: FK lives on the parent table, references the embed table's PK
  | { kind: "to-many"; fkColumn: string }; // has-many: FK lives on the embed table, references the parent table's PK

const embedCache = new Map<string, EmbedRelation | null>();

async function resolveRelation(parentTable: string, childTable: string): Promise<EmbedRelation | null> {
  const key = `${parentTable}->${childTable}`;
  if (embedCache.has(key)) return embedCache.get(key)!;
  const res = await getPool().query(
    `SELECT
       (SELECT a.attname FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.conrelid = $1::regclass AND c.confrelid = $2::regclass
        LIMIT 1) AS child_fk,
       (SELECT a.attname FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.conrelid = $2::regclass AND c.confrelid = $1::regclass
        LIMIT 1) AS parent_fk`,
    [`public.${parentTable}`, `public.${childTable}`],
  );
  const { child_fk, parent_fk } = res.rows[0] as { child_fk: string | null; parent_fk: string | null };
  let rel: EmbedRelation | null = null;
  if (child_fk) rel = { kind: "to-one", fkColumn: child_fk };
  else if (parent_fk) rel = { kind: "to-many", fkColumn: parent_fk };
  embedCache.set(key, rel);
  return rel;
}

const columnsCache = new Map<string, string[]>();

async function tableColumns(table: string): Promise<string[]> {
  if (columnsCache.has(table)) return columnsCache.get(table)!;
  const res = await getPool().query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  const cols = res.rows.map((r) => r.column_name as string);
  columnsCache.set(table, cols);
  return cols;
}

const colTypeCache = new Map<string, string | null>();

async function columnDataType(table: string, column: string): Promise<string | null> {
  const key = `${table}.${column}`;
  if (colTypeCache.has(key)) return colTypeCache.get(key)!;
  const res = await getPool().query(
    `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  const t = (res.rows[0]?.data_type as string | undefined) ?? null;
  colTypeCache.set(key, t);
  return t;
}

async function resolveEmbeds(parentTable: string, rows: Record<string, unknown>[], embeds: EmbedSpec[]): Promise<Record<string, unknown>[]> {
  const out = rows.map((r) => ({ ...r }));
  for (const e of embeds) {
    const rel = await resolveRelation(parentTable, e.table);
    if (!rel) throw new Error(`cannot resolve relation ${parentTable} <- ${e.table}`);
    const childCols = e.columns === "*" ? await tableColumns(e.table) : e.columns;
    const colList = childCols.map(ident).join(", ");
    for (const row of out) {
      if (rel.kind === "to-one") {
        // FK is on the parent row (belongs-to): match the embed table's PK.
        const fkVal = row[rel.fkColumn];
        if (fkVal == null) {
          row[e.alias] = null;
          continue;
        }
        const embedPk = await primaryKeyColumn(e.table);
        const res = await getPool().query(
          `SELECT ${colList} FROM public.${ident(e.table)} WHERE ${ident(embedPk)} = $1 LIMIT 1`,
          [fkVal],
        );
        row[e.alias] = res.rows[0] ?? null;
      } else {
        // FK is on the embed table (has-many): match against the parent row's PK.
        const pkCol = await primaryKeyColumn(parentTable);
        const res = await getPool().query(
          `SELECT ${colList} FROM public.${ident(e.table)} WHERE ${ident(rel.fkColumn)} = $1`,
          [row[pkCol]],
        );
        row[e.alias] = res.rows;
      }
    }
  }
  return out;
}

const pkCache = new Map<string, string>();

async function primaryKeyColumn(table: string): Promise<string> {
  if (pkCache.has(table)) return pkCache.get(table)!;
  const res = await getPool().query(
    `SELECT a.attname FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'p' AND c.conrelid = $1::regclass LIMIT 1`,
    [`public.${table}`],
  );
  const col = res.rows[0]?.attname ?? "id";
  pkCache.set(table, col);
  return col;
}

// Type-level wrapper: awaits of a .single()/.maybeSingle() chain resolve an
// object row (data: any), while plain chains resolve row arrays (data: any[]).
export class PostgrestSingleQuery implements PromiseLike<SingleResult> {
  constructor(private readonly inner: PostgrestQuery) {}

  then<TResult1 = SingleResult, TResult2 = never>(
    onfulfilled?: ((value: SingleResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return (this.inner as unknown as PromiseLike<SingleResult>).then(onfulfilled, onrejected);
  }
}

export type DbClient = {
  from: (table: string) => PostgrestQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => PostgrestQuery;
};

export function createDbClient(): DbClient {
  return {
    from: (table: string) => new PostgrestQuery().from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      const q = new PostgrestQuery();
      q.rpc(fn, args);
      return q;
    },
  };
}
