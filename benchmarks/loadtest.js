/**
 * Load test script — replaces `ab` when it can't be installed.
 *
 * Fires N total requests at C concurrency, measures:
 *   - Requests/sec throughput
 *   - Latency percentiles (p50, p95, p99)
 *   - Status code distribution (200 vs 429 vs errors)
 *
 * Usage:
 *   node benchmarks/loadtest.js [total] [concurrency] [url] [api-key]
 *
 * Defaults: 10000 requests, 100 concurrency, localhost:3000/api/products
 */

const http = require('http');

const TOTAL      = parseInt(process.argv[2], 10) || 10000;
const CONCURRENCY = parseInt(process.argv[3], 10) || 100;
const targetUrl  = process.argv[4] || 'http://localhost:3000/api/products';
const API_KEY     = process.argv[5] || 'bench-client';

const parsed = new URL(targetUrl);

const latencies = [];
const statusCounts = {};
let completed = 0;
let inFlight = 0;
let sent = 0;

const startTime = Date.now();

function sendRequest() {
  if (sent >= TOTAL) return;
  sent++;
  inFlight++;

  const reqStart = process.hrtime.bigint();

  const req = http.get({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    headers: { 'X-API-Key': API_KEY },
  }, (res) => {
    const status = res.statusCode;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    res.resume();
    res.on('end', () => {
      const latencyMs = Number(process.hrtime.bigint() - reqStart) / 1e6;
      latencies.push(latencyMs);
      completed++;
      inFlight--;

      if (completed % 2000 === 0) {
        process.stderr.write(`  ${completed}/${TOTAL} completed...\n`);
      }

      if (completed === TOTAL) {
        printResults();
      } else {
        sendRequest();
      }
    });
  });

  req.on('error', (err) => {
    statusCounts['error'] = (statusCounts['error'] || 0) + 1;
    completed++;
    inFlight--;
    if (completed === TOTAL) {
      printResults();
    } else {
      sendRequest();
    }
  });

  // Set a timeout to avoid hanging
  req.setTimeout(5000, () => {
    req.destroy();
  });
}

function percentile(arr, p) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printResults() {
  const elapsed = (Date.now() - startTime) / 1000;
  const rps = (TOTAL / elapsed).toFixed(2);

  const p50 = percentile(latencies, 50).toFixed(2);
  const p95 = percentile(latencies, 95).toFixed(2);
  const p99 = percentile(latencies, 99).toFixed(2);
  const min = Math.min(...latencies).toFixed(2);
  const max = Math.max(...latencies).toFixed(2);
  const mean = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);

  const output = [
    `=== Load Test Results ===`,
    ``,
    `Configuration:`,
    `  Total requests:  ${TOTAL}`,
    `  Concurrency:     ${CONCURRENCY}`,
    `  Target URL:      ${targetUrl}`,
    `  API Key:         ${API_KEY}`,
    ``,
    `Throughput:`,
    `  Total time:      ${elapsed.toFixed(2)} s`,
    `  Requests/sec:    ${rps}`,
    ``,
    `Latency (ms):`,
    `  Min:             ${min}`,
    `  Mean:            ${mean}`,
    `  p50 (median):    ${p50}`,
    `  p95:             ${p95}`,
    `  p99:             ${p99}`,
    `  Max:             ${max}`,
    ``,
    `Status codes:`,
    ...Object.entries(statusCounts).map(([code, count]) => {
      const pct = ((count / TOTAL) * 100).toFixed(1);
      return `  ${code}:  ${count} (${pct}%)`;
    }),
    ``,
    `Total completed:   ${completed}`,
    `Errors:            ${statusCounts['error'] || 0}`,
  ].join('\n');

  console.log(output);
}

// Launch initial wave of concurrent requests
console.error(`Starting load test: ${TOTAL} requests, ${CONCURRENCY} concurrent...`);
for (let i = 0; i < Math.min(CONCURRENCY, TOTAL); i++) {
  sendRequest();
}
