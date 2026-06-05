const crypto = require('crypto');
const { isLocalRequest } = require('./http-utils');

function getSetupBootstrapToken(config, env = process.env) {
  const value = env.SETUP_BOOTSTRAP_TOKEN || config.get('setupBootstrapToken') || '';
  return typeof value === 'string' ? value.trim() : '';
}

function timingSafeEqualString(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));

  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthorizedSetupBootstrapRequest(req, parsedUrl, options = {}) {
  const config = options.config;
  if (!config || typeof config.get !== 'function') {
    throw new Error('setup bootstrap authorization requires config');
  }

  if (isLocalRequest(req)) {
    return true;
  }

  const expectedToken = getSetupBootstrapToken(config, options.env || process.env);
  if (!expectedToken) {
    return false;
  }

  const providedToken = req.headers['x-setup-token'] ||
    (parsedUrl && parsedUrl.query && parsedUrl.query.setupToken);

  return timingSafeEqualString(providedToken, expectedToken);
}

function rejectUnauthorizedSetupBootstrap(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: false,
    error: 'Initial setup from non-local clients requires SETUP_BOOTSTRAP_TOKEN. Open /setup?setupToken=<token> or run setup locally.'
  }));
}

module.exports = {
  getSetupBootstrapToken,
  isAuthorizedSetupBootstrapRequest,
  rejectUnauthorizedSetupBootstrap,
  timingSafeEqualString
};
