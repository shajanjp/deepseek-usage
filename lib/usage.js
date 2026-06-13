/**
 * Usage data aggregation utilities.
 *
 * Takes row objects (from the DeepSeek API layer in deepseek.js) and
 * produces per-day summaries and token totals.
 *
 * Token types: input_cache_hit_tokens, input_cache_miss_tokens, output_tokens
 * Cost is carried via _total_cost rows.
 */

// --- Aggregation -------------------------------------------------------

/**
 * Aggregate raw CSV rows into per-day usage grouped by (date, model, key).
 * All amounts are returned in USD (no currency conversion).
 * Currency conversion is handled on the frontend.
 *
 * Returns an object keyed by date string (yyyy-mm-dd), where each value
 * is an array of { model, api_key_name, input_cache_hit_tokens_total,
 * input_cache_miss_tokens_total, output_tokens, bill_amount }.
 *
 * Skips 'request_count' rows since they carry no cost.
 */
export function aggregateByDay(rows) {
  const groups = new Map();

  for (const row of rows) {
    const { utc_date: date, model, api_key_name: keyName, type, price, amount } = row;
    if (type === "request_count") continue;

    const groupKey = `${date}||${model}||${keyName}`;
    let g = groups.get(groupKey);
    if (!g) {
      g = { date, model, api_key_name: keyName, input_cache_hit_tokens_total: 0, input_cache_miss_tokens_total: 0, output_tokens: 0, bill_amount_usd: 0 };
      groups.set(groupKey, g);
    }

    const amt = parseFloat(amount) || 0;

    switch (type) {
      case "output_tokens": g.output_tokens += amt; break;
      case "input_cache_hit_tokens": g.input_cache_hit_tokens_total += amt; break;
      case "input_cache_miss_tokens": g.input_cache_miss_tokens_total += amt; break;
    }

    if (price && price !== "") {
      const p = parseFloat(price);
      if (!isNaN(p)) g.bill_amount_usd += p * amt;
    }
  }

  const result = {};
  for (const g of groups.values()) {
    if (!result[g.date]) result[g.date] = [];
    result[g.date].push({
      model: g.model,
      api_key_name: g.api_key_name,
      input_cache_hit_tokens_total: g.input_cache_hit_tokens_total,
      input_cache_miss_tokens_total: g.input_cache_miss_tokens_total,
      output_tokens: g.output_tokens,
      bill_amount: Math.round(g.bill_amount_usd * 100) / 100,
    });
  }

  return result;
}

// --- Token summary -------------------------------------------------------

/**
 * Compute monthly token totals from raw rows.
 * Returns { input_tokens, output_tokens, total_tokens }.
 */
export function computeTokenSummary(rows) {
  let input = 0;
  let output = 0;

  for (const row of rows) {
    const { type, amount } = row;
    const amt = parseFloat(amount) || 0;

    switch (type) {
      case "output_tokens":
        output += amt;
        break;
      case "input_cache_hit_tokens":
      case "input_cache_miss_tokens":
        input += amt;
        break;
    }
  }

  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
  };
}
