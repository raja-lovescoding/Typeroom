import express from 'express';
import { pool } from '../db/client.js';

export const app = express();
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/ready', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ status: 'not_ready' });
  }
});
