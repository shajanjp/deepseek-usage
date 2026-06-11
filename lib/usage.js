/**
 * DeepSeek usage data: fetch, extract, parse, and aggregate.
 *
 * The DeepSeek API returns a ZIP containing a CSV with columns:
 *   utc_date, model, api_key_name, type, price, amount, ...
 *
 * Types: output_tokens, input_cache_hit_tokens, input_cache_miss_tokens, request_count
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { downloadFile } from './http.js';
import { parseCSV } from './csv.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const csvCache = new Map(); // key: "2026-6" -> { rows, fetchedAt }

// --- Helpers -----------------------------------------------------------

function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${dy}_${hh}${mm}${ss}`;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- Fetch & parse -----------------------------------------------------

/**
 * Download the usage export zip for a given month/year, extract the CSV,
 * parse it, and return the rows. Stores the zip + a timestamped copy of
 * the CSV under dataDir.
 */
export async function fetchAndParseUsage(year, month, dataDir, bearerToken) {
  ensureDir(dataDir);

  const ts = timestamp();
  const url = `https://platform.deepseek.com/api/v0/usage/export?month=${month}&year=${year}`;
  const zipPath = join(dataDir, `deepseek-usage-${ts}.zip`);

  console.log(`[usage] Downloading ${url}`);
  await downloadFile(url, zipPath, bearerToken);
  console.log(`[usage] Saved ${zipPath}`);

  // Extract to a temp directory within dataDir
  const extractDir = join(dataDir, `extracted-${ts}`);
  ensureDir(extractDir);

  try {
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, {
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message;
    throw new Error(`Failed to extract zip: ${msg}`);
  }

  const csvFilename = `amount-${year}-${month}.csv`;
  const csvPath = join(extractDir, csvFilename);
  if (!existsSync(csvPath)) {
    throw new Error(`${csvFilename} not found in the zip archive`);
  }

  // Keep a timestamped copy for debugging
  const csvSavedPath = join(dataDir, `amount-${year}-${month}-${ts}.csv`);
  const csvContent = readFileSync(csvPath, 'utf-8');
  createWriteStream(csvSavedPath).write(csvContent);

  // Clean up the extraction directory
  rmSync(extractDir, { recursive: true, force: true });

  const { rows } = parseCSV(csvContent);
  console.log(`[usage] Parsed ${rows.length} line items from ${csvFilename}`);
  return rows;
}

/**
 * Get usage rows for a given month/year, using an in-memory TTL cache.
 */
export async function getUsageRows(year, month, dataDir, bearerToken) {
  const cacheKey = `${year}-${month}`;
  const now = Date.now();
  const cached = csvCache.get(cacheKey);

  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return cached.rows;
  }

  const rows = await fetchAndParseUsage(year, month, dataDir, bearerToken);
  csvCache.set(cacheKey, { rows, fetchedAt: now });
  return rows;
}

// --- Aggregation -------------------------------------------------------

/**
 * Aggregate raw CSV rows into per-day usage grouped by (date, model, key).
 * Converts USD amounts to `currency` using the provided rate.
 *
 * Returns an object keyed by date string (yyyy-mm-dd), where each value
 * is an array of { model, api_key_name, input_cache_hit_tokens_total,
 * input_cache_miss_tokens_total, output_tokens, bill_amount }.
 *
 * Skips 'request_count' rows since they carry no cost.
 */
export function aggregateByDay(rows, rate, currency = 'USD') {
  // Group by (date, model, api_key_name)
  const groups = new Map();

  for (const row of rows) {
    const { utc_date: date, model, api_key_name: keyName, type, price, amount } = row;

    // request_count rows have no price / cost — skip
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

    // Accumulate USD bill only when a price is present
    if (price && price !== '') {
      const p = parseFloat(price);
      if (!isNaN(p)) {
        g.bill_amount_usd += p * amt;
      }
    }
  }

  // Re-group by date
  const result = {};
  for (const g of groups.values()) {
    if (!result[g.date]) result[g.date] = [];
    result[g.date].push({
      model: g.model,
      api_key_name: g.api_key_name,
      input_cache_hit_tokens_total: g.input_cache_hit_tokens_total,
      input_cache_miss_tokens_total: g.input_cache_miss_tokens_total,
      output_tokens: g.output_tokens,
      bill_amount: rate
        ? Math.round(g.bill_amount_usd * rate * 100) / 100
        : 0,
    });
  }

  return result;
}
