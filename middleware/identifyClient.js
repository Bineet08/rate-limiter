const jwt = require('jsonwebtoken');

/**
 * Client identification middleware.
 *
 * Resolves a client identifier from the incoming request in this priority:
 *   1. JWT — if `Authorization: Bearer <token>` is present, decode (without
 *      verification — this gateway does not issue credentials) and use the
 *      `sub` or `userId` claim.
 *   2. API key — if the `X-API-Key` header is present, use it directly.
 *   3. IP address — fallback to the requesting client's IP.
 *
 * The resolved identifier is attached to `req.clientId` and the identification
 * method to `req.clientIdSource` for observability.
 */
function identifyClient(req, res, next) {
  let clientId = null;
  let clientIdSource = null;

  // Priority 1 — JWT
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Decode only — we don't verify the signature because this gateway
      // does not issue or manage credentials.
      const decoded = jwt.decode(token);
      if (decoded) {
        const claim = decoded.sub || decoded.userId;
        if (claim) {
          clientId = `jwt:${claim}`;
          clientIdSource = 'jwt';
        }
      }
    } catch (err) {
      // Malformed token — fall through to next strategy
    }
  }

  // Priority 2 — API key header
  if (!clientId) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      clientId = `apikey:${apiKey}`;
      clientIdSource = 'api-key';
    }
  }

  // Priority 3 — client IP fallback
  if (!clientId) {
    const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
    clientId = `ip:${ip}`;
    clientIdSource = 'ip';
  }

  // ── Client ID Validation ───────────────────────────────────────────
  // Ensure the client ID is of safe length and contains no control
  // characters, spaces, or newlines to prevent Redis injection/DoS.
  const isValid = typeof clientId === 'string' &&
                  clientId.length <= 256 &&
                  !/[\s\r\n\t\x00-\x1F\x7F-\x9F]/.test(clientId);

  if (!isValid) {
    console.warn(`[Identify] Blocked invalid client identifier payload: "${clientId}"`);
    return res.status(400).json({ error: 'Bad Request — Invalid client identifier' });
  }

  req.clientId = clientId;
  req.clientIdSource = clientIdSource;
  console.log(`[Identify] ${req.method} ${req.url} — clientId=${req.clientId} (from ${req.clientIdSource})`);
  next();
}

module.exports = identifyClient;
