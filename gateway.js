const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const identifyClient = require('./middleware/identifyClient');
const rateLimiter = require('./middleware/rateLimiter');
const stats = require('./lib/stats');

const app = express();
const GATEWAY_PORT = 3000;
const BACKEND_URL = 'http://localhost:4000';

// ── /stats endpoint — handled directly by the gateway, not proxied ──
// Must be registered BEFORE the identify/rateLimiter middleware chain
// so that /stats itself is not rate-limited or identified.
app.get('/stats', async (req, res) => {
  try {
    const data = await stats.getAll();

    // If ?format=html, return a plain HTML table
    if (req.query.format === 'html') {
      // Escape user-controlled values to prevent XSS — client IDs come
      // from headers (X-API-Key, JWT claims, etc.) which are attacker-controlled.
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const rows = Object.entries(data.clients)
        .map(([id, s]) =>
          `<tr><td>${esc(id)}</td><td>${s.total}</td><td>${s.allowed}</td><td>${s.denied}</td></tr>`
        )
        .join('\n');

      const connectionStatus = data.redisConnected 
        ? '<span style="color: green; font-weight: bold;">CONNECTED</span>' 
        : '<span style="color: red; font-weight: bold;">OFFLINE (Showing cached/local data)</span>';

      return res.send(`<!DOCTYPE html>
<html><head><title>Gateway Stats</title></head>
<body>
<h1>Gateway Stats</h1>
<p>Strategy: <strong>${esc(data.strategy)}</strong></p>
<p>Redis Status: ${connectionStatus}</p>
<p>Fail-Open Bypasses: <strong>${data.failOpenRequests}</strong></p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Client</th><th>Total</th><th>Allowed</th><th>Denied</th></tr>
${rows || '<tr><td colspan="4">No data yet</td></tr>'}
</table>
</body></html>`);
    }

    // Default: JSON
    return res.json(data);
  } catch (err) {
    // Fallback error boundary just in case
    console.error('[Stats] Critical error fetching stats:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Middleware chain: identify client → rate-limit → proxy
app.use(identifyClient);
app.use(rateLimiter);

// Proxy all requests to the dummy backend
app.use(
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    // Log proxied requests
    on: {
      proxyReq: (proxyReq, req) => {
        console.log(`[Gateway] ${req.method} ${req.url} -> ${BACKEND_URL}${req.url}`);
      },
      error: (err, req, res) => {
        console.error(`[Gateway] Proxy error: ${err.message}`);
        res.status(502).json({ error: 'Bad Gateway — backend unreachable' });
      },
    },
  })
);

app.listen(GATEWAY_PORT, () => {
  console.log(`[Gateway] Listening on port ${GATEWAY_PORT}, proxying to ${BACKEND_URL}`);
});
