/**
 * Exchange rate fetcher with per-currency TTL cache.
 *
 * Uses the free Frankfurter API (no key required).
 * https://www.frankfurter.dev
 */

import { fetchJSON } from "./http.js";

const RATE_TTL = 60 * 60 * 1000; // 1 hour
const CURRENCIES_TTL = 24 * 60 * 60 * 1000; // 24 hours

const rateCache = new Map(); // currencyCode -> { rate, fetchedAt }
let currenciesCache = null;
let currenciesFetchedAt = 0;

/**
 * Get the exchange rate from USD to `targetCurrency`.
 * Returns the cached rate if still fresh, otherwise fetches a new one.
 * On fetch failure, returns the stale rate if available, or null.
 */
export async function getExchangeRate(targetCurrency = "USD") {
  const code = targetCurrency.toUpperCase();

  // USD -> USD is always 1
  if (code === "USD") return 1;

  const now = Date.now();
  const cached = rateCache.get(code);

  if (cached && now - cached.fetchedAt < RATE_TTL) {
    return cached.rate;
  }

  try {
    const data = await fetchJSON(
      `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${code}`,
    );
    const rate = data.rates?.[code];
    if (!rate) throw new Error(`Rate for ${code} not found in response`);

    rateCache.set(code, { rate, fetchedAt: now });
    return rate;
  } catch (err) {
    console.error(
      `[warn] Exchange rate fetch failed for ${code}: ${err.message}`,
    );
    return cached ? cached.rate : null;
  }
}

/**
 * Get the list of supported currencies from Frankfurter.
 * Returns an object mapping currency codes to their full names, e.g.
 * { USD: 'United States Dollar', INR: 'Indian Rupee', ... }
 */
export async function getSupportedCurrencies() {
  const now = Date.now();

  if (currenciesCache && now - currenciesFetchedAt < CURRENCIES_TTL) {
    return currenciesCache;
  }

  try {
    const data = await fetchJSON("https://api.frankfurter.dev/v1/currencies");
    currenciesCache = data;
    currenciesFetchedAt = now;
    return data;
  } catch (err) {
    console.error(
      `[warn] Failed to fetch supported currencies: ${err.message}`,
    );
    // Return stale cache or a sensible default
    return currenciesCache || { USD: "United States Dollar" };
  }
}

/**
 * Clear all cached data (useful in tests).
 */
export function clearExchangeCache() {
  rateCache.clear();
  currenciesCache = null;
  currenciesFetchedAt = 0;
}
