/**
 * Small HTTP helpers shared by the setup/admin servers.
 */

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readRequestBody(req, options = {}) {
  const limit = options.limit || DEFAULT_BODY_LIMIT_BYTES;
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > limit) {
      throw createHttpError(413, `Request body exceeds ${limit} bytes`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function getRequestOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;

  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isSameOriginRequest(req) {
  const origin = getRequestOrigin(req);
  if (!origin) return true;

  const host = req.headers.host;
  if (!host) return false;

  return origin.host === host;
}

function setSameOriginCorsHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  const origin = req.headers.origin;
  if (origin && isSameOriginRequest(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function handleCorsPreflight(req, res) {
  setSameOriginCorsHeaders(req, res);

  if (!isSameOriginRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Cross-origin requests are not allowed' }));
    return true;
  }

  res.writeHead(204);
  res.end();
  return true;
}

module.exports = {
  DEFAULT_BODY_LIMIT_BYTES,
  readRequestBody,
  setSameOriginCorsHeaders,
  handleCorsPreflight,
  isSameOriginRequest
};
