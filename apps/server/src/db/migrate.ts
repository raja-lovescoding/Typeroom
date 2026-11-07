import { readFile } from 'node:fs/promises';
import { db, pool } from './client.js';

const migration = await readFile(new URL('./migrations/0000_initial.sql', import.meta.url), 'utf8');
await db.execute(migration);
await pool.end();
