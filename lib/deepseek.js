/**
 * DeepSeek API client — calls the platform REST API.
 *
 * Fetches usage data (Amount + Cost APIs) and user summary (balance).
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { downloadFile } from "./http.js";
import { parseCSV } from "./csv.js";
import { fetchJSON } from './http.js';

// --- Constants & helpers ---------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const rowsCache = new Map(); // key: "2026-6" -> { rows, fetchedAt }

function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${dy}_${hh}${mm}${ss}`;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- Usage rows (export ZIP / CSV API) ---------------------------------

/**
 * Download the usage export zip for a given month/year, extract the CSV,
 * parse it, and return the rows. Stores the zip + a timestamped copy of
 * the CSV under dataDir.
 *
 * CSV columns: utc_date, model, api_key_name, type, price, amount
 * Types: output_tokens, input_cache_hit_tokens, input_cache_miss_tokens,
 *        request_count
 */
export async function fetchAndParseUsage(year, month, dataDir, bearerToken) {
  ensureDir(dataDir);

  const ts = timestamp();
  const url = `https://platform.deepseek.com/api/v0/usage/export?month=${month}&year=${year}`;
  const zipPath = join(dataDir, `deepseek-usage-${ts}.zip`);

  console.log(`[deepseek] Downloading ${url}`);
  await downloadFile(url, zipPath, bearerToken);
  console.log(`[deepseek] Saved ${zipPath}`);

  // Extract to a temp directory within dataDir
  const extractDir = join(dataDir, `extracted-${ts}`);
  ensureDir(extractDir);

  try {
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err) {
    const msg =
      err.stderr?.toString().trim() ||
      err.stdout?.toString().trim() ||
      err.message;
    throw new Error(`Failed to extract zip: ${msg}`);
  }

  const csvFilename = `amount-${year}-${month}.csv`;
  const csvPath = join(extractDir, csvFilename);
  if (!existsSync(csvPath)) {
    throw new Error(`${csvFilename} not found in the zip archive`);
  }

  // Keep a timestamped copy for debugging
  const csvSavedPath = join(dataDir, `amount-${year}-${month}-${ts}.csv`);
  const csvContent = readFileSync(csvPath, "utf-8");
  createWriteStream(csvSavedPath).write(csvContent);

  // Clean up the extraction directory
  rmSync(extractDir, { recursive: true, force: true });

  const { rows } = parseCSV(csvContent);
  console.log(`[deepseek] Parsed ${rows.length} line items from ${csvFilename}`);
  return rows;
}

/**
 * Get usage rows for a given month/year, using an in-memory TTL cache.
 */
export async function getUsageRows(year, month, dataDir, bearerToken) {
  const cacheKey = `${year}-${month}`;
  const now = Date.now();
  const cached = rowsCache.get(cacheKey);

  if (cached && now - cached.fetchedAt < CACHE_TTL) {
    return cached.rows;
  }

  const rows = await fetchAndParseUsage(year, month, dataDir, bearerToken);
  rowsCache.set(cacheKey, { rows, fetchedAt: now });
  return rows;
}

/**
 * Fetch the raw CSV text from the DeepSeek usage export API.
 * Downloads the zip, extracts the CSV inside, and returns the raw text.
 * No parsing or formatting is done — the frontend handles everything.
 */
export async function fetchUsageExportRaw(year, month, dataDir, bearerToken) {
  ensureDir(dataDir);

  const ts = timestamp();
  const url = `https://platform.deepseek.com/api/v0/usage/export?month=${month}&year=${year}`;
  const zipPath = join(dataDir, `deepseek-usage-${ts}.zip`);

  console.log(`[deepseek] Downloading ${url}`);
  await downloadFile(url, zipPath, bearerToken);
  console.log(`[deepseek] Saved ${zipPath}`);

  const extractDir = join(dataDir, `extracted-${ts}`);
  ensureDir(extractDir);

  try {
    execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: "pipe", timeout: 30_000 });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message;
    throw new Error(`Failed to extract zip: ${msg}`);
  }

  const csvFilename = `amount-${year}-${month}.csv`;
  const csvPath = join(extractDir, csvFilename);
  if (!existsSync(csvPath)) {
    throw new Error(`${csvFilename} not found in the zip archive`);
  }

  const csvContent = readFileSync(csvPath, "utf-8");

  // Clean up the extraction directory
  rmSync(extractDir, { recursive: true, force: true });

  return csvContent;
}

// --- User summary (balance) ------------------------------------------------

/**
 * Fetch the user summary from DeepSeek.
 *
 * GET https://platform.deepseek.com/api/v0/users/get_user_summary
 * Auth: Bearer <token>
 *
 * Returns the full raw response unchanged (including code, msg, data).
 * All formatting/parsing is done on the frontend.
 */
export async function fetchUserSummary(token) {
  const url = 'https://platform.deepseek.com/api/v0/users/get_user_summary';
  return await fetchJSON(url, token);
}
