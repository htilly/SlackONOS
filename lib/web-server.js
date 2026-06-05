const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { parse: parseUrl } = require('url');
const selfsigned = require('selfsigned');

const { readRequestBody } = require('./http-utils');
const {
  isAuthorizedSetupBootstrapRequest,
  rejectUnauthorizedSetupBootstrap
} = require('./setup-bootstrap');

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendStaticFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(fs.readFileSync(filePath, 'utf8'));
  return true;
}

function sendNotFound(res, message) {
  res.writeHead(404);
  res.end(message);
}

function getWebAuthnHandler() {
  return require('./webauthn-handler');
}

function createWebServer({
  config,
  logger,
  rootDir,
  ipAddress,
  webPort,
  authHandler,
  setupHandler,
  adminApi,
  slack,
  slackBotToken,
  slackAppToken,
  DiscordSystem
}) {
  const ttsEnabled = config.get('ttsEnabled') !== false;
  const sslCertPath = config.get('sslCertPath');
  const sslKeyPath = config.get('sslKeyPath');
  const sslAutoGenerate = config.get('sslAutoGenerate') !== false;
  const httpsPort = () => config.get('httpsPort') || 8443;

  let useHttps = false;
  let sslOptions = null;
  let httpsServer = null;

  const defaultCertPath = path.join(rootDir, 'config', 'ssl', 'cert.pem');
  const defaultKeyPath = path.join(rootDir, 'config', 'ssl', 'key.pem');
  let finalCertPath = sslCertPath || defaultCertPath;
  let finalKeyPath = sslKeyPath || defaultKeyPath;

  async function generateSelfSignedCert(certPath, keyPath) {
    try {
      const sslDir = path.dirname(certPath);
      await fs.promises.mkdir(sslDir, { recursive: true });

      let hostname = 'localhost';
      if (ipAddress && typeof ipAddress === 'string') {
        const trimmed = ipAddress.trim();
        if (trimmed !== '' && trimmed !== 'IP_HOST') {
          hostname = trimmed;
        }
      }

      if (!hostname || typeof hostname !== 'string' || hostname.trim() === '') {
        hostname = 'localhost';
      }

      const attrs = [{ name: 'commonName', value: hostname }];
      const pems = await selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'basicConstraints',
            cA: true,
          },
          {
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true,
          },
          {
            name: 'subjectAltName',
            altNames: [
              {
                type: 2,
                value: hostname,
              },
              ...(hostname !== 'localhost' && /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ? [{
                type: 7,
                ip: hostname,
              }] : []),
              {
                type: 2,
                value: 'localhost',
              },
              {
                type: 7,
                ip: '127.0.0.1',
              },
            ],
          },
        ],
      });

      await Promise.all([
        fs.promises.writeFile(certPath, pems.cert, 'utf8'),
        fs.promises.writeFile(keyPath, pems.private, 'utf8')
      ]);

      config.set('sslCertPath', certPath);
      config.set('sslKeyPath', keyPath);
      config.save((err) => {
        if (err && logger) {
          logger.warn(`Failed to save SSL paths to config: ${err.message}`);
        }
      });

      return { cert: pems.cert, key: pems.private };
    } catch (err) {
      throw new Error(`Failed to generate SSL certificate: ${err.message}`);
    }
  }

  function createHttpsServer(options) {
    httpsServer = https.createServer(options, async (req, res) => {
      await handleHttpRequest(req, res);
    });
    return httpsServer;
  }

  function startHttpsServer() {
    if (!useHttps || !httpsServer || httpsServer.listening) {
      return;
    }

    const port = httpsPort();
    httpsServer.listen(port, () => {
      logger.info(`🔒 HTTPS server listening on port ${port}`);
      if (ttsEnabled) {
        logger.info(`   TTS endpoint: https://${ipAddress || 'localhost'}:${port}/tts.mp3`);
      }
      logger.info(`   Setup wizard: https://${ipAddress || 'localhost'}:${port}/setup`);
    });
  }

  function configureSsl() {
    if (sslAutoGenerate && (!fs.existsSync(finalCertPath) || !fs.existsSync(finalKeyPath))) {
      logger.info('🔒 Auto-generating self-signed SSL certificate...');

      generateSelfSignedCert(finalCertPath, finalKeyPath)
        .then((generated) => {
          sslOptions = {
            cert: generated.cert,
            key: generated.key
          };
          useHttps = true;

          logger.info(`✅ SSL certificate generated: ${finalCertPath}`);
          logger.info('   ⚠️  This is a self-signed certificate. Browsers will show a security warning.');
          logger.info("   For production, use a certificate from a trusted CA (Let's Encrypt, etc.)");

          if (useHttps && sslOptions && !httpsServer) {
            createHttpsServer(sslOptions);
            startHttpsServer();
          }
        })
        .catch((err) => {
          logger.error(`Failed to auto-generate SSL certificate: ${err.message}. Falling back to HTTP.`);
        });
      return;
    }

    if (finalCertPath && finalKeyPath) {
      try {
        if (fs.existsSync(finalCertPath) && fs.existsSync(finalKeyPath)) {
          sslOptions = {
            cert: fs.readFileSync(finalCertPath, 'utf8'),
            key: fs.readFileSync(finalKeyPath, 'utf8')
          };
          useHttps = true;
        } else {
          logger.warn(`SSL certificate files not found. Cert: ${finalCertPath}, Key: ${finalKeyPath}. Falling back to HTTP.`);
        }
      } catch (err) {
        logger.error(`Error loading SSL certificates: ${err.message}. Falling back to HTTP.`);
      }
    }
  }

  async function handleAuthRoutes(req, res, urlPath) {
    if (urlPath === '/api/auth/login' && req.method === 'POST') {
      if (authHandler) {
        const body = await readRequestBody(req);
        await authHandler.handleLogin(req, res, body);
      } else {
        writeJson(res, 500, { success: false, error: 'Auth handler not available' });
      }
      return true;
    }

    if (urlPath === '/api/auth/logout' && req.method === 'POST') {
      if (authHandler) {
        authHandler.handleLogout(req, res);
      } else {
        writeJson(res, 500, { success: false, error: 'Auth handler not available' });
      }
      return true;
    }

    if (urlPath === '/api/auth/change-password' && req.method === 'POST') {
      if (authHandler) {
        const authResult = authHandler.verifyAuth(req);
        if (!authResult.authenticated) {
          writeJson(res, 401, { success: false, error: 'Authentication required' });
          return true;
        }

        const body = await readRequestBody(req);
        await authHandler.handlePasswordChange(req, res, body);
      } else {
        writeJson(res, 500, { success: false, error: 'Auth handler not available' });
      }
      return true;
    }

    return false;
  }

  async function requireAuthenticatedRequest(req, res) {
    if (!authHandler) {
      writeJson(res, 500, { success: false, error: 'Auth handler not available' });
      return false;
    }

    const authResult = authHandler.verifyAuth(req);
    if (!authResult.authenticated) {
      writeJson(res, 401, { success: false, error: 'Authentication required' });
      return false;
    }

    return true;
  }

  async function handleWebAuthnRoutes(req, res, urlPath, parsedUrl) {
    if (urlPath === '/api/auth/webauthn/register/options' && req.method === 'POST') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        if (!(await requireAuthenticatedRequest(req, res))) return true;

        if (!webauthnHandler.isWebAuthnEnabled()) {
          writeJson(res, 403, { success: false, error: 'WebAuthn is not enabled' });
          return true;
        }

        const options = await webauthnHandler.generateRegistrationOptions(req);
        writeJson(res, 200, options);
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/register/verify' && req.method === 'POST') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        if (!(await requireAuthenticatedRequest(req, res))) return true;

        const body = await readRequestBody(req);
        const result = await webauthnHandler.verifyRegistrationResponse(req, body);
        writeJson(res, 200, result);
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/authenticate/options' && req.method === 'POST') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        const options = await webauthnHandler.generateAuthenticationOptions(req);
        writeJson(res, 200, options);
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/authenticate/verify' && req.method === 'POST') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        const body = await readRequestBody(req);
        const result = await webauthnHandler.verifyAuthenticationResponse(req, body);

        if (result.verified) {
          const sessionId = authHandler.createSession('admin');
          const isSecure = req.headers['x-forwarded-proto'] === 'https' ||
            req.connection?.encrypted === true ||
            req.socket?.encrypted === true;
          authHandler.setSessionCookie(res, sessionId, isSecure);
        }

        writeJson(res, 200, result);
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/credentials' && req.method === 'GET') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        if (authHandler) {
          const authResult = authHandler.verifyAuth(req);
          if (!authResult.authenticated) {
            writeJson(res, 401, { success: false, error: 'Authentication required' });
            return true;
          }
        }
        const credentials = await webauthnHandler.getCredentials();
        writeJson(res, 200, { credentials });
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/credentials' && req.method === 'DELETE') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        if (authHandler) {
          const authResult = authHandler.verifyAuth(req);
          if (!authResult.authenticated) {
            writeJson(res, 401, { success: false, error: 'Authentication required' });
            return true;
          }
        }
        const credentialID = parsedUrl.query.credentialID;
        if (!credentialID) {
          writeJson(res, 400, { success: false, error: 'credentialID required' });
          return true;
        }
        const result = await webauthnHandler.deleteCredential(credentialID);
        writeJson(res, 200, result);
      } catch (err) {
        writeJson(res, 500, { success: false, error: err.message });
      }
      return true;
    }

    if (urlPath === '/api/auth/webauthn/status' && req.method === 'GET') {
      try {
        const webauthnHandler = getWebAuthnHandler();
        const enabled = webauthnHandler.isWebAuthnEnabled();
        const hasCreds = enabled ? await webauthnHandler.hasCredentials() : false;
        const fileInfo = await webauthnHandler.getCredentialsFileInfo();
        writeJson(res, 200, {
          enabled,
          hasCredentials: hasCreds,
          credentialsFile: fileInfo
        });
      } catch (err) {
        writeJson(res, 200, { enabled: false, hasCredentials: false, error: err.message });
      }
      return true;
    }

    return false;
  }

  async function getAuthState() {
    let webauthnEnabledWithCreds = false;
    try {
      const webauthnHandler = getWebAuthnHandler();
      webauthnEnabledWithCreds = webauthnHandler.isWebAuthnEnabled() && await webauthnHandler.hasCredentials();
    } catch (err) {
      // Ignore WebAuthn errors and fall back to password state.
    }

    const passwordSet = authHandler ? authHandler.isPasswordSet() : false;
    return {
      passwordSet,
      webauthnEnabledWithCreds,
      hasAuthMethod: passwordSet || webauthnEnabledWithCreds
    };
  }

  async function handleProtectedRouteAuth(req, res, parsedUrl, urlPath, hasAuthMethod) {
    const isAdminRoute = urlPath.startsWith('/admin') || urlPath.startsWith('/api/admin/');
    const isSetupRoute = urlPath === '/setup' || urlPath === '/setup/';
    const isSetupApiRoute = urlPath.startsWith('/api/setup/');

    if (isAdminRoute && !hasAuthMethod) {
      if (urlPath.startsWith('/api/admin/')) {
        writeJson(res, 403, {
          success: false,
          error: 'Admin access blocked until a password or WebAuthn credential is configured. Visit /setup to set one.'
        });
      } else {
        res.writeHead(302, { Location: '/setup?force=true' });
        res.end();
      }
      return false;
    }

    let requiresAuth = false;
    if (isAdminRoute) {
      requiresAuth = true;
    }

    if ((isSetupRoute || isSetupApiRoute) && hasAuthMethod) {
      if (!(urlPath === '/api/setup/password-setup' && !hasAuthMethod)) {
        requiresAuth = true;
      }
    }

    if (requiresAuth) {
      const authResult = authHandler.verifyAuth(req);
      if (!authResult.authenticated) {
        const returnUrl = encodeURIComponent(urlPath + (parsedUrl.search || ''));
        res.writeHead(302, { 'Location': `/login?return=${returnUrl}` });
        res.end();
        return false;
      }
    }

    return true;
  }

  async function handleSetupApi(req, res, parsedUrl, urlPath, hasAuthMethod) {
    if (!hasAuthMethod && !isAuthorizedSetupBootstrapRequest(req, parsedUrl, { config })) {
      rejectUnauthorizedSetupBootstrap(res);
      return;
    }

    if (urlPath === '/api/setup/password-setup' && req.method === 'POST') {
      if (authHandler) {
        const body = await readRequestBody(req);
        await authHandler.handlePasswordSetup(req, res, body);
      } else {
        writeJson(res, 500, { success: false, error: 'Auth handler not available' });
      }
      return;
    }

    if (authHandler && authHandler.isPasswordSet()) {
      if (setupHandler) {
        try {
          const setupStatus = await setupHandler.isSetupNeeded();
          if (!setupStatus.needed) {
            const authResult = authHandler.verifyAuth(req);
            if (!authResult.authenticated) {
              writeJson(res, 401, { error: 'Authentication required' });
              return;
            }
          }
        } catch (err) {
          // If check fails, allow access because setup might be in progress.
        }
      }
    }

    if (setupHandler) {
      await setupHandler.handleSetupAPI(req, res, parsedUrl);
    } else {
      writeJson(res, 500, { error: 'Setup handler not available' });
    }
  }

  function isBotConnected(hasSlack, hasDiscord) {
    try {
      if (hasSlack && slack && typeof slack.isConnected === 'function' && slack.isConnected()) {
        return true;
      }
      if (hasDiscord) {
        const discordClient = DiscordSystem.getDiscordClient();
        return Boolean(discordClient && discordClient.isReady());
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  async function serveSetupPage(req, res, parsedUrl) {
    const setupHtmlPath = path.join(rootDir, 'public', 'setup', 'index.html');

    if (authHandler && !authHandler.isPasswordSet()) {
      if (!sendStaticFile(res, setupHtmlPath, 'text/html')) {
        sendNotFound(res, 'Setup wizard not found');
      }
      return;
    }

    const force = parsedUrl.query && parsedUrl.query.force === 'true';

    if (!force) {
      const hasSlack = slack && slackBotToken && slackAppToken;
      const hasDiscord = config.get('discordToken');

      if ((hasSlack || hasDiscord) && isBotConnected(hasSlack, hasDiscord)) {
        res.writeHead(302, { 'Location': '/admin' });
        res.end();
        return;
      }
    }

    if (!sendStaticFile(res, setupHtmlPath, 'text/html')) {
      sendNotFound(res, 'Setup wizard not found');
    }
  }

  function serveSetupStaticFile(res, urlPath) {
    const relativePath = urlPath.replace('/setup/', '').split('?')[0];
    const publicSetupDir = path.join(rootDir, 'public', 'setup');
    const normalizedPublicDir = path.resolve(publicSetupDir);
    const normalizedFilePath = path.resolve(normalizedPublicDir, relativePath);
    const relativeToPublicDir = path.relative(normalizedPublicDir, normalizedFilePath);
    const isWithinPublicDir = relativeToPublicDir &&
      !relativeToPublicDir.startsWith('..') &&
      !path.isAbsolute(relativeToPublicDir);

    if (isWithinPublicDir && fs.existsSync(normalizedFilePath)) {
      const ext = path.extname(normalizedFilePath).toLowerCase();
      const contentTypes = {
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
      };

      const contentType = contentTypes[ext] || 'text/plain; charset=utf-8';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext);
      try {
        const content = isImage
          ? fs.readFileSync(normalizedFilePath)
          : fs.readFileSync(normalizedFilePath, 'utf8');
        res.end(content);
      } catch (err) {
        logger.error(`Error reading setup file ${normalizedFilePath}:`, err);
        res.writeHead(500);
        res.end('Error reading file');
      }
    } else {
      logger.warn(`Setup file not found: ${normalizedFilePath} (requested: ${urlPath})`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  async function serveRoot(req, res) {
    const hasSlack = slack && slackBotToken && slackAppToken;
    const hasDiscord = config.get('discordToken');

    if ((hasSlack || hasDiscord) && isBotConnected(hasSlack, hasDiscord)) {
      res.writeHead(302, { 'Location': '/admin' });
      res.end();
      return;
    }

    if (setupHandler) {
      try {
        const setupStatus = await setupHandler.isSetupNeeded();
        if (setupStatus.needed) {
          res.writeHead(302, { 'Location': '/setup' });
          res.end();
          return;
        }
      } catch (err) {
        // If setup check fails, show the status page.
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SlackONOS is running. Visit /setup to configure or /admin to manage.');
  }

  async function handleHttpRequest(req, res) {
    try {
      const parsedUrl = parseUrl(req.url, true);
      const urlPath = parsedUrl.pathname;

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://cdn.jsdelivr.net; img-src 'self' data: https:;");

      if (await handleAuthRoutes(req, res, urlPath)) return;
      if (await handleWebAuthnRoutes(req, res, urlPath, parsedUrl)) return;

      if (urlPath === '/login' || urlPath === '/login/') {
        const loginHtmlPath = path.join(rootDir, 'public', 'setup', 'login.html');
        if (!sendStaticFile(res, loginHtmlPath, 'text/html')) {
          sendNotFound(res, 'Login page not found');
        }
        return;
      }

      const { hasAuthMethod } = await getAuthState();
      if (!(await handleProtectedRouteAuth(req, res, parsedUrl, urlPath, hasAuthMethod))) {
        return;
      }

      if (urlPath.startsWith('/api/admin/')) {
        await adminApi.handleAdminAPI(req, res, parsedUrl);
        return;
      }

      if (urlPath.startsWith('/api/setup/')) {
        await handleSetupApi(req, res, parsedUrl, urlPath, hasAuthMethod);
        return;
      }

      if (urlPath === '/admin' || urlPath === '/admin/') {
        const adminHtmlPath = path.join(rootDir, 'public', 'setup', 'admin.html');
        if (!sendStaticFile(res, adminHtmlPath, 'text/html')) {
          sendNotFound(res, 'Admin page not found');
        }
        return;
      }

      if (urlPath === '/setup' || urlPath === '/setup/') {
        await serveSetupPage(req, res, parsedUrl);
        return;
      }

      if (urlPath.startsWith('/setup/')) {
        serveSetupStaticFile(res, urlPath);
        return;
      }

      if (ttsEnabled && urlPath === '/tts.mp3') {
        const ttsFilePath = path.join(os.tmpdir(), 'sonos-tts.mp3');
        if (fs.existsSync(ttsFilePath)) {
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          const stream = fs.createReadStream(ttsFilePath);
          stream.pipe(res);
          logger.info('Serving TTS file to Sonos');
        } else {
          res.writeHead(404);
          res.end('TTS file not found');
        }
        return;
      }

      if (req.url === '/') {
        await serveRoot(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      logger.error('HTTP server error:', err);
      if (!res.headersSent) {
        res.writeHead(err.statusCode || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err.statusCode ? err.message : 'Internal server error');
      }
    }
  }

  configureSsl();

  const httpServer = http.createServer(async (req, res) => {
    if (req.url && req.url.startsWith('/tts.mp3')) {
      await handleHttpRequest(req, res);
      return;
    }

    if (useHttps && httpsServer) {
      const host = req.headers.host || `${ipAddress}:${webPort}`;
      const hostname = host.split(':')[0];
      const httpsUrl = `https://${hostname}:${httpsPort()}${req.url}`;
      res.writeHead(301, { 'Location': httpsUrl });
      res.end();
      return;
    }

    await handleHttpRequest(req, res);
  });

  if (useHttps && sslOptions && !httpsServer) {
    createHttpsServer(sslOptions);
  }

  httpServer.listen(webPort, () => {
    if (useHttps) {
      logger.info(`📻 HTTP server listening on port ${webPort} (redirecting to HTTPS)`);
    } else {
      logger.info(`📻 HTTP server listening on port ${webPort}`);
    }
    if (ttsEnabled) {
      logger.info(`   TTS endpoint: http://${ipAddress}:${webPort}/tts.mp3`);
    }
    if (useHttps) {
      logger.info(`   Setup wizard: https://${ipAddress}:${httpsPort()}/setup`);
    } else {
      logger.info(`   Setup wizard: http://${ipAddress}:${webPort}/setup`);
    }
  });

  startHttpsServer();

  return {
    httpServer,
    handleHttpRequest,
    generateSelfSignedCert,
    get httpsServer() {
      return httpsServer;
    },
    get useHttps() {
      return useHttps;
    },
    get ttsEnabled() {
      return ttsEnabled;
    }
  };
}

module.exports = {
  createWebServer
};
