/**
 * DeepSeek API client — thin proxy to the platform REST API.
 *
 * Returns raw responses without any formatting or calculations.
 * All parsing, aggregation, and currency conversion is done on the frontend.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { downloadFile, fetchJSON } from "./http.js";

// --- Helpers ----------------------------------------------------------------

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
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Usage export (CSV) ----------------------------------------------------

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
  rmSync(extractDir, { recursive: true, force: true });

  return csvContent;
}

// --- User summary ----------------------------------------------------------

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
