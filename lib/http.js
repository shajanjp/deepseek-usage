/**
 * Low-level HTTP utilities using Node's built-in https module.
 */

import https from 'https';
import { createWriteStream } from 'fs';

/**
 * Download a file from url -> destPath with Bearer auth.
 * Expects a zip response; validates the PK magic bytes to detect
 * error pages that DeepSeek sometimes returns with HTTP 200.
 */
export function downloadFile(url, destPath, token) {
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
          // Collect error body for a helpful message
          res.on('data', (chunk) => bodyChunks.push(chunk));
          res.on('end', () => {
            file.close();
            const body = Buffer.concat(bodyChunks).toString('utf-8').slice(0, 200);
            reject(
              new Error(
                `DeepSeek API returned HTTP ${res.statusCode}${body ? `: ${body}` : ''}`
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

/**
 * Simple JSON GET request using https.
 */
export function fetchJSON(url) {
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
