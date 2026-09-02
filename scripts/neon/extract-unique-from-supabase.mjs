import fs from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire('/home/dev/agent-os/package.json');
const { Client } = req('pg');

const client = new Client({
  host: 'db.qdobqxyryntjescedjpf.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.PW,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await client.connect();

const uqs = (await client.query(`
  SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid, true) AS def
  FROM pg_constraint
  WHERE contype = 'u' AND connamespace = 'public'::regnamespace
  ORDER BY conrelid::regclass::text, conname`)).rows;
const sql = uqs.map((u) => `ALTER TABLE ${u.tbl} DROP CONSTRAINT IF EXISTS ${JSON.stringify(u.conname).replace(/"/g, '"')};\nALTER TABLE ${u.tbl} ADD CONSTRAINT ${JSON.stringify(u.conname).replace(/"/g, '"')} ${u.def};`).join('\n');
fs.writeFileSync('/tmp/unique-constraints.sql', sql);
console.log(`unique constraints: ${uqs.length} -> /tmp/unique-constraints.sql`);
console.log(uqs.slice(0, 5).map((u) => `${u.tbl}: ${u.def}`).join('\n'));
await client.end();
