import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config/env.js';

const { Client } = pg;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const client = new Client({
  connectionString: config.DATABASE_URL,
  application_name: 'slot-booking-migrations'
});

try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [72419031]);
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
  );

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('Applied migration ' + file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [72419031]);
  } catch {}
  await client.end();
}
