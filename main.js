#!/usr/bin/env node

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import 'dotenv/config';
import https from 'https';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

const BEARER_TOKEN = process.env.DEEPSEEK_BEARER_TOKEN;
if (!BEARER_TOKEN) {
  console.error('Error: DEEPSEEK_BEARER_TOKEN not set in .env file');
  process.exit(1);
}

// --- In-memory cache ---
const csvCache = new Map();       // key: "2026-6" -> { rows, fetchedAt }
const CACHE_TTL = 5 * 60 * 1000;  // 5 minutes

let exchangeRate = null;
let exchangeFetchedAt = 0;
const EXCHANGE_TTL = 60 * 60 * 1000; // 1 hour

// --- Utility functions ---

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split('\n').map((l) => l.replace(/\r+$/, ''));
  if (lines.length === 0) return { headers: [], rows: [] };

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = parseCSVLine(headerLine);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = idx < values.length ? values[idx] : '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

function downloadFile(url, destPath, token) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const u = new URL(url);
    let bodyChunks = [];

    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/zip',
        },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.on('data', (chunk) => bodyChunks.push(chunk));
          res.on('end', () => {
            file.close();
            const body = Buffer.concat(bodyChunks).toString('utf-8').slice(0, 200);
            reject(
              new Error(
                `DeepSeek API returned HTTP ${res.statusCode}${
                  body ? `: ${body}` : ''
                }`
              )
            );
          });
          return;
        }

        // Verify the response is actually a zip by checking PK magic bytes
        let verified = false;
        res.on('data', (chunk) => {
          if (verified) {
            file.write(chunk);
            return;
          }

          if (chunk.length < 2) {
            file.write(chunk);
            return;
          }

          verified = true;
          const magic = chunk.toString('hex', 0, 2);
          if (magic !== '504b') {
            // Not a zip -- DeepSeek returned an error page with 200 status
            res.destroy();
            file.close();
            bodyChunks.push(chunk);
            res.on('data', (c) => bodyChunks.push(c));
            res.on('end', () => {
              const body = Buffer.concat(bodyChunks).toString('utf-8').slice(0, 300);
              reject(new Error(`DeepSeek API did not return a zip: ${body}`));
            });
            return;
          }

          file.write(chunk);
        });

        res.on('end', () => {
          if (verified) {
            file.end(resolve);
          }
        });
      }
    );

    req.on('error', (err) => {
      file.close(() => reject(err));
    });
    req.on('timeout', () => {
      req.destroy();
      file.close(() => reject(new Error('Download timed out')));
    });
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchExchangeRate() {
  const data = await fetchJSON(
    'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR'
  );
  const rate = data.rates?.INR;
  if (!rate) throw new Error('INR rate not found in response');
  return rate;
}

function getOrCreateDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function tempPath(ext) {
  return join(tmpdir(), `deepseek-${randomBytes(4).toString('hex')}${ext}`);
}

// --- Fetch and parse DeepSeek usage CSV ---

async function fetchAndParseUsage(year, month) {
  getOrCreateDataDir();

  const ts =
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-` +
    `${String(new Date().getDate()).padStart(2, '0')}_` +
    `${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}${String(new Date().getSeconds()).padStart(2, '0')}`;

  const url = `https://platform.deepseek.com/api/v0/usage/export?month=${month}&year=${year}`;

  const zipPath = join(DATA_DIR, `deepseek-usage-${ts}.zip`);

  console.log(`[fetch] Downloading ${url}`);
  await downloadFile(url, zipPath, BEARER_TOKEN);
  console.log(`[fetch] Saved ${zipPath}`);

  // Extract to a temp directory
  const extractDir = join(DATA_DIR, `extracted-${ts}`);
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
  }

  try {
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, {
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (err) {
    const stderr = err.stderr?.toString().trim();
    const stdout = err.stdout?.toString().trim();
    throw new Error(
      `Failed to extract zip: ${stderr || stdout || err.message}`
    );
  }

  const csvFilename = `amount-${year}-${month}.csv`;
  const csvPath = join(extractDir, csvFilename);

  if (!existsSync(csvPath)) {
    throw new Error(`${csvFilename} not found in the zip archive`);
  }

  // Save a copy alongside the zip
  const csvSavedPath = join(DATA_DIR, `amount-${year}-${month}-${ts}.csv`);
  const csvContent = readFileSync(csvPath, 'utf-8');
  createWriteStream(csvSavedPath).write(csvContent);

  // Clean up extract dir
  rmSync(extractDir, { recursive: true, force: true });

  const { rows } = parseCSV(csvContent);
  console.log(`[fetch] Parsed ${rows.length} line items from ${csvFilename}`);
  return rows;
}

// --- Aggregation ---

function aggregateByDay(rows, inrRate) {
  // Group by (date, model, api_key_name)
  const groups = new Map();

  for (const row of rows) {
    const { utc_date: date, model, api_key_name: keyName, type, price, amount } = row;

    // Skip request_count rows entirely (they have no price and we don't count them)
    if (type === 'request_count') continue;

    const groupKey = `${date}||${model}||${keyName}`;
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        date,
        model,
        api_key_name: keyName,
        input_cache_hit_tokens_total: 0,
        input_cache_miss_tokens_total: 0,
        output_tokens: 0,
        bill_amount_usd: 0,
      };
      groups.set(groupKey, g);
    }

    const amt = parseFloat(amount) || 0;

    switch (type) {
      case 'output_tokens':
        g.output_tokens += amt;
        break;
      case 'input_cache_hit_tokens':
        g.input_cache_hit_tokens_total += amt;
        break;
      case 'input_cache_miss_tokens':
        g.input_cache_miss_tokens_total += amt;
        break;
    }

    // Calculate bill amount only if price exists
    if (price && price !== '') {
      const p = parseFloat(price);
      if (!isNaN(p)) {
        g.bill_amount_usd += p * amt;
      }
    }
  }

  // Group by date for the output structure
  const result = {};
  for (const g of groups.values()) {
    if (!result[g.date]) result[g.date] = [];
    result[g.date].push({
      model: g.model,
      api_key_name: g.api_key_name,
      input_cache_hit_tokens_total: g.input_cache_hit_tokens_total,
      input_cache_miss_tokens_total: g.input_cache_miss_tokens_total,
      output_tokens: g.output_tokens,
      bill_amount_in_inr: inrRate
        ? Math.round(g.bill_amount_usd * inrRate * 100) / 100
        : 0,
    });
  }

  return result;
}

// --- Hono App ---

const app = new Hono();

app.get('/', (c) => {
  const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  return c.html(html);
});

app.get('/api/usage', async (c) => {
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

  const cacheKey = `${year}-${month}`;
  const now = Date.now();

  // Check / populate cache
  let cached = csvCache.get(cacheKey);
  if (!cached || now - cached.fetchedAt > CACHE_TTL) {
    try {
      const rows = await fetchAndParseUsage(year, month);
      cached = { rows, fetchedAt: now };
      csvCache.set(cacheKey, cached);
    } catch (err) {
      console.error(`[error] ${err.message}`);
      return c.json({ error: `Failed to fetch usage data: ${err.message}` }, 502);
    }
  }

  // Fetch / reuse exchange rate
  let inrRate = exchangeRate;
  if (!inrRate || now - exchangeFetchedAt > EXCHANGE_TTL) {
    try {
      inrRate = await fetchExchangeRate();
      exchangeRate = inrRate;
      exchangeFetchedAt = now;
    } catch (err) {
      console.error(`[warn] Exchange rate fetch failed: ${err.message}`);
      inrRate = exchangeRate || null;
    }
  }

  const result = aggregateByDay(cached.rows, inrRate);
  return c.json(result);
});

app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// --- Start ---

const PORT = parseInt(process.env.PORT, 10) || 3000;

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`DeepSeek Usage API running on http://localhost:${info.port}`);
    console.log(`Endpoint: GET /api/usage?month=9&year=2026`);
  }
);
