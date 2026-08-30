#!/usr/bin/env node
/** Apply a SQL file via DATABASE_URL (Supabase → Settings → Database → URI). */
import { readFileSync } from 'fs';
import pg from 'pg';

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Usage: DATABASE_URL=postgres://... node agent/scripts/apply-sql.mjs path/to/file.sql');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Applied', file);
} finally {
  await client.end();
}
