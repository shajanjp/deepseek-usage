/**
 * CSV parsing utilities.
 * Handles quoted fields, escaped quotes, BOM in headers.
 */

/**
 * Parse a single CSV line into an array of fields,
 * respecting double-quote escaping.
 */
export function parseCSVLine(line) {
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

/**
 * Parse full CSV text into an array of row objects keyed by header.
 * Strips trailing \r and leading BOM (\uFEFF) from the header line.
 */
export function parseCSV(text) {
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
