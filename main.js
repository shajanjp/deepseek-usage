#!/usr/bin/env node

/**
 * DeepSeek Usage Dashboard — server entry point.
 *
 * Endpoints:
 *   GET  /                          — serve the HTML dashboard
 *   GET  /api/usage/export?month=&year= — raw CSV text from DeepSeek export API
 *   GET  /api/usage/summary          — raw JSON from DeepSeek user summary API
 *
 * Both API endpoints are thin proxies — they return the exact same response
 * from DeepSeek without any formatting or calculations. All currency
 * conversion and data aggregation is done on the frontend.
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { fetchUsageExportRaw, fetchUserSummary } from './lib/deepseek.js';

// -- Paths ------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// -- Config -----------------------------------------------------------------

const BEARER_TOKEN = process.env.DEEPSEEK_BEARER_TOKEN;
if (!BEARER_TOKEN) {
  console.error('Error: DEEPSEEK_BEARER_TOKEN not set in .env file');
  process.exit(1);
}

// Parse port: env > --port/-p flag > default 3000
const PORT_ARG = (() => {
  const idx = process.argv.findIndex((a) => a === '--port' || a === '-p');
  return idx !== -1 && idx + 1 < process.argv.length
    ? parseInt(process.argv[idx + 1], 10)
    : NaN;
})();
const PORT = PORT_ARG || parseInt(process.env.PORT, 10) || 3000;

// -- Hono app ---------------------------------------------------------------

const app = new Hono();

// Serve static assets (images, favicons, etc.)
app.use('/assets/*', serveStatic({ root: '.' }));

// Serve the dashboard HTML
app.get('/', (c) => {
  const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  return c.html(html);
});

// Proxy: raw CSV text from DeepSeek usage export API
app.get('/api/usage/export', async (c) => {
  const monthRaw = c.req.query('month');
  const yearRaw = c.req.query('year');

  if (!monthRaw || !yearRaw) {
    return c.json({ error: 'month and year query parameters are required' }, 400);
  }

  const month = parseInt(monthRaw, 10);
  const year = parseInt(yearRaw, 10);

  if (isNaN(month) || isNaN(year) || month < 1 || month > 12 || year < 2024) {
    return c.json({ error: 'Invalid month or year' }, 400);
  }

  try {
    const csvText = await fetchUsageExportRaw(year, month, DATA_DIR, BEARER_TOKEN);
    return c.text(csvText);
  } catch (err) {
    console.error(`[error] Failed to fetch usage export: ${err.message}`);
    return c.json({ error: `Failed to fetch usage data: ${err.message}` }, 502);
  }
});

// Proxy: raw JSON from DeepSeek user summary API
app.get('/api/usage/summary', async (c) => {
  try {
    const data = await fetchUserSummary(BEARER_TOKEN);
    return c.json(data);
  } catch (err) {
    console.error(`[error] Failed to fetch user summary: ${err.message}`);
    return c.json({ error: 'Failed to fetch summary' }, 502);
  }
});

// Global error handler
app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// -- Start ------------------------------------------------------------------

serve(
  { fetch: app.fetch, port: PORT },
  (info) => {
    console.log(`DeepSeek Usage API running on http://localhost:${info.port}`);
    console.log(`Endpoints:`);
    console.log(`  GET /api/usage/export?month=6&year=2026`);
    console.log(`  GET /api/usage/summary`);
  },
);
