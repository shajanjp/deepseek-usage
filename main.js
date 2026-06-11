#!/usr/bin/env node

/**
 * DeepSeek Usage Dashboard — server entry point.
 *
 * Endpoints:
 *   GET  /                          — serve the HTML dashboard
 *   GET  /api/usage?month=&year=&currency= — aggregated usage JSON
 *   GET  /api/currencies            — list of supported currency codes/names
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getUsageRows, aggregateByDay } from './lib/usage.js';
import { getExchangeRate, getSupportedCurrencies } from './lib/exchange.js';

// -- Paths ------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// -- Config -----------------------------------------------------------------

const BEARER_TOKEN = process.env.DEEPSEEK_BEARER_TOKEN;
if (!BEARER_TOKEN) {
  console.error('Error: DEEPSEEK_BEARER_TOKEN not set in .env file');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 3000;

// -- Hono app ---------------------------------------------------------------

const app = new Hono();

// Serve the dashboard HTML
app.get('/', (c) => {
  const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  return c.html(html);
});

// List supported currencies
app.get('/api/currencies', async (c) => {
  const currencies = await getSupportedCurrencies();
  return c.json(currencies);
});

// API: aggregated usage for a given month
app.get('/api/usage', async (c) => {
  const monthRaw = c.req.query('month');
  const yearRaw = c.req.query('year');
  const currency = (c.req.query('currency') || 'USD').toUpperCase();

  // --- Validate query params ---
  if (!monthRaw || !yearRaw) {
    return c.json({ error: 'month and year query parameters are required' }, 400);
  }

  const month = parseInt(monthRaw, 10);
  const year = parseInt(yearRaw, 10);

  if (isNaN(month) || isNaN(year) || month < 1 || month > 12 || year < 2024) {
    return c.json({ error: 'Invalid month or year' }, 400);
  }

  // --- Validate currency ---
  const supported = await getSupportedCurrencies();
  if (!supported[currency]) {
    return c.json({ error: `Unsupported currency: ${currency}` }, 400);
  }

  // --- Fetch usage rows (with cache) ---
  let rows;
  try {
    rows = await getUsageRows(year, month, DATA_DIR, BEARER_TOKEN);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    return c.json({ error: `Failed to fetch usage data: ${err.message}` }, 502);
  }

  // --- Get exchange rate (with cache, tolerant of failure) ---
  const rate = await getExchangeRate(currency);

  // --- Aggregate and return ---
  const data = aggregateByDay(rows, rate, currency);
  return c.json({ data, currency });
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
    console.log(`Endpoint: GET /api/usage?month=9&year=2026`);
  },
);
