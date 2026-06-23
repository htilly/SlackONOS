const {
  readRequestBody,
  setSameOriginCorsHeaders,
  handleCorsPreflight,
  isSameOriginRequest
} = require('./http-utils');

const SPOTIFY_STATUS_CACHE_TTL = 5 * 60 * 1000;

const ALLOWED_CONFIG_KEYS = [
  'adminChannel', 'standardChannel', 'maxVolume', 'market',
  'gongLimit', 'voteLimit', 'voteImmuneLimit', 'flushVoteLimit',
  'voteTimeLimitMinutes', 'ttsEnabled', 'ttsProvider', 'ttsFallbackProvider',
  'openaiTtsModel', 'openaiTtsVoice', 'openaiTtsSpeed', 'openaiTtsInstructions', 'logLevel', 'ipAddress',
  'webPort', 'httpsPort', 'sonos', 'defaultTheme', 'themePercentage', 'queueThreadThreshold',
  'openaiApiKey', 'aiModel', 'aiMoodMirrorEnabled', 'soundcraftEnabled', 'soundcraftIp', 'soundcraftChannels', 'crossfadeEnabled',
  'webauthnEnabled', 'webauthnRpName', 'webauthnRpId', 'webauthnOrigin', 'webauthnRequireUserVerification', 'webauthnPreferPlatformOnly',
  'webauthnTimeout', 'webauthnResidentKey', 'webauthnChallengeExpiration', 'webauthnMaxCredentials'
];

const NUMERIC_CONFIG_KEYS = new Set([
  'gongLimit',
  'voteLimit',
  'voteImmuneLimit',
  'flushVoteLimit',
  'voteTimeLimitMinutes',
  'maxVolume',
  'webPort',
  'httpsPort',
  'themePercentage',
  'queueThreadThreshold',
  'openaiTtsSpeed',
  'webauthnTimeout',
  'webauthnChallengeExpiration',
  'webauthnMaxCredentials'
]);

const BOOLEAN_CONFIG_KEYS = new Set([
  'ttsEnabled',
  'telemetryEnabled',
  'aiMoodMirrorEnabled',
  'soundcraftEnabled',
  'webauthnEnabled',
  'webauthnRequireUserVerification',
  'webauthnPreferPlatformOnly',
  'crossfadeEnabled',
  'useHttps',
  'sslAutoGenerate'
]);

const RUNTIME_NUMERIC_KEYS = new Set([
  'gongLimit',
  'voteLimit',
  'voteImmuneLimit',
  'flushVoteLimit',
  'voteTimeLimitMinutes',
  'maxVolume'
]);

const VOTING_CONFIG_KEYS = new Set([
  'gongLimit',
  'voteLimit',
  'voteImmuneLimit',
  'flushVoteLimit',
  'voteTimeLimitMinutes'
]);

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function maskSensitive(value) {
  if (!value) return '';
  if (typeof value === 'string' && value.length > 6) {
    return value.slice(0, 3) + '…' + value.slice(-3);
  }
  return '••••••';
}

function createAdminApi(deps) {
  const {
    config,
    logger,
    sonos,
    spotify,
    soundcraft,
    slack,
    slackAppToken,
    slackBotToken,
    DiscordSystem,
    logBuffer,
    maxLogBufferSize = 1000,
    setRuntimeConfigValue = () => {},
    syncVotingConfig = () => {}
  } = deps;

  let spotifyStatusCache = null;
  let spotifyStatusCacheTime = 0;
  let lastTrackInfo = null;
  let statusPollInterval = null;

  function ensureClientSets() {
    if (!global.statusStreamClients) {
      global.statusStreamClients = new Set();
    }
    if (!global.logStreamClients) {
      global.logStreamClients = new Set();
    }
  }

  async function handleAdminAPI(req, res, url) {
    const urlPath = url.pathname;

    setSameOriginCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      handleCorsPreflight(req, res);
      return;
    }

    if (!isSameOriginRequest(req)) {
      writeJson(res, 403, { success: false, error: 'Cross-origin requests are not allowed' });
      return;
    }

    let body = '';
    if (req.method === 'POST') {
      body = await readRequestBody(req);
    }

    try {
      if (urlPath === '/api/admin/status') {
        writeJson(res, 200, await getAdminStatus());
        return;
      }

      if (urlPath === '/api/admin/now-playing') {
        writeJson(res, 200, await getNowPlaying());
        return;
      }

      if (urlPath === '/api/admin/play' && req.method === 'POST') {
        await handlePlaybackControl(res, () => sonos.play());
        return;
      }

      if (urlPath === '/api/admin/pause' && req.method === 'POST') {
        await handlePlaybackControl(res, () => sonos.pause());
        return;
      }

      if (urlPath === '/api/admin/stop' && req.method === 'POST') {
        await handlePlaybackControl(res, () => sonos.stop());
        return;
      }

      if (urlPath === '/api/admin/config') {
        writeJson(res, 200, getConfigForAdmin());
        return;
      }

      if (urlPath === '/api/admin/config-values' && req.method === 'GET') {
        writeJson(res, 200, getWebAuthnConfigValues());
        return;
      }

      if (urlPath === '/api/admin/config/update') {
        try {
          const data = JSON.parse(body);
          const result = await updateConfigValue(data.key, data.value);
          writeJson(res, 200, result);
        } catch (err) {
          logger.error('Error updating config:', err);
          writeJson(res, 500, { success: false, error: err.message || 'Failed to update config' });
        }
        return;
      }

      if (urlPath === '/api/admin/events') {
        handleStatusStream(req, res);
        return;
      }

      if (urlPath === '/api/admin/logs') {
        handleLogStream(req, res);
        return;
      }

      if (urlPath === '/api/admin/webauthn-log' && req.method === 'POST') {
        handleWebAuthnClientLog(res, body);
        return;
      }

      if (urlPath === '/api/admin/logs/buffer') {
        writeJson(res, 200, { logs: logBuffer });
        return;
      }

      writeJson(res, 404, { error: 'Not found' });
    } catch (err) {
      writeJson(res, err.statusCode || 500, { error: err.message });
    }
  }

  async function handlePlaybackControl(res, action) {
    try {
      await action();
      writeJson(res, 200, { success: true });
    } catch (err) {
      writeJson(res, 500, { success: false, error: err.message });
    }
  }

  function getWebAuthnConfigValues() {
    try {
      return {
        exists: true,
        values: {
          webauthnRequireUserVerification: config.get('webauthnRequireUserVerification') === true,
          webauthnPreferPlatformOnly: config.get('webauthnPreferPlatformOnly') === true,
          webauthnTimeout: parseInt(config.get('webauthnTimeout') || '60', 10),
          webauthnResidentKey: config.get('webauthnResidentKey') || 'discouraged',
          webauthnChallengeExpiration: parseInt(config.get('webauthnChallengeExpiration') || '60', 10),
          webauthnMaxCredentials: parseInt(config.get('webauthnMaxCredentials') || '0', 10)
        }
      };
    } catch {
      return { exists: false, values: null };
    }
  }

  function handleWebAuthnClientLog(res, body) {
    try {
      const payload = JSON.parse(body || '{}');
      const msg = payload.message || 'WebAuthn client log';
      const meta = payload.meta || {};
      if (logger && typeof logger.info === 'function') {
        logger.info(`[WEBAUTHN_CLIENT] ${msg} ${JSON.stringify(meta)}`);
      } else {
        console.log('[WEBAUTHN_CLIENT]', msg, meta);
      }
      writeJson(res, 200, { success: true });
    } catch (err) {
      if (logger) logger.error('Failed to record WebAuthn client log: ' + err.message);
      writeJson(res, 500, { success: false, error: err.message });
    }
  }

  async function getAdminStatus() {
    const status = {
      slack: { configured: false, connected: false },
      discord: { configured: false, connected: false },
      spotify: { configured: false, connected: false },
      sonos: { configured: false, connected: false },
      soundcraft: { configured: false, connected: false }
    };

    if (slackAppToken && slackBotToken) {
      status.slack.configured = true;
      try {
        if (slack && typeof slack.isConnected === 'function') {
          status.slack.connected = slack.isConnected();
        } else if (slack && slack.socket) {
          status.slack.connected = false;
        }
        status.slack.details = {
          adminChannel: config.get('adminChannel') || 'N/A',
          standardChannel: config.get('standardChannel') || 'N/A'
        };
      } catch (err) {
        status.slack.error = err.message;
      }
    }

    if (config.get('discordToken')) {
      status.discord.configured = true;
      try {
        const discordClient = DiscordSystem.getDiscordClient();
        if (discordClient) {
          const channels = config.get('discordChannels') || [];
          const adminRoles = config.get('discordAdminRoles') || [];
          status.discord.connected = discordClient.isReady() || false;
          status.discord.details = {
            botUserId: discordClient.user?.id || 'Unknown',
            guilds: discordClient.guilds?.cache?.size || 0,
            channels: Array.isArray(channels) ? channels.join(', ') : (channels || 'All channels'),
            adminRoles: Array.isArray(adminRoles) ? adminRoles.join(', ') : (adminRoles || 'None configured')
          };
        }
      } catch (err) {
        status.discord.error = err.message;
      }
    }

    const spotifyClientId = config.get('spotifyClientId');
    const spotifyClientSecret = config.get('spotifyClientSecret');
    if (spotifyClientId && spotifyClientSecret) {
      status.spotify.configured = true;
      const now = Date.now();
      if (spotifyStatusCache && (now - spotifyStatusCacheTime) < SPOTIFY_STATUS_CACHE_TTL) {
        status.spotify = { ...spotifyStatusCache };
      } else {
        try {
          await spotify.searchTrackList('test', 1);
          status.spotify.connected = true;
          status.spotify.details = {
            market: config.get('market') || 'N/A',
            clientId: spotifyClientId ? spotifyClientId.slice(0, 6) + '…' : 'N/A'
          };
          spotifyStatusCache = { ...status.spotify };
          spotifyStatusCacheTime = now;
        } catch (err) {
          status.spotify.connected = false;
          status.spotify.error = err.message;
          spotifyStatusCache = { ...status.spotify };
          spotifyStatusCacheTime = now;
        }
      }
    }

    const sonosIp = config.get('sonos');
    if (sonosIp && sonosIp !== 'IP_TO_SONOS') {
      status.sonos.configured = true;
      try {
        const deviceInfo = await sonos.deviceDescription();
        status.sonos.connected = true;
        status.sonos.deviceInfo = {
          model: deviceInfo.modelDescription || 'Unknown',
          room: deviceInfo.roomName || 'Unknown',
          ip: sonosIp
        };
        status.sonos.details = {
          softwareVersion: deviceInfo.softwareVersion || 'Unknown',
          hardwareVersion: deviceInfo.hardwareVersion || 'Unknown'
        };
      } catch (err) {
        status.sonos.connected = false;
        status.sonos.error = err.message;
      }
    }

    if (config.get('soundcraftEnabled')) {
      status.soundcraft.configured = true;
      try {
        if (soundcraft && soundcraft.isEnabled()) {
          status.soundcraft.connected = true;
          status.soundcraft.channels = soundcraft.getChannelNames();
          status.soundcraft.details = {
            ip: config.get('soundcraftIp') || 'N/A',
            channels: soundcraft.getChannelNames()
          };
        } else {
          status.soundcraft.connected = false;
        }
      } catch (err) {
        status.soundcraft.connected = false;
        status.soundcraft.error = err.message;
      }
    }

    return status;
  }

  async function getNowPlaying(options = {}) {
    try {
      const { skipQueue = false } = options;
      const promises = [
        sonos.getCurrentState(),
        sonos.getVolume()
      ];

      if (!skipQueue) {
        promises.push(sonos.getQueue().catch(() => null));
      } else {
        promises.push(Promise.resolve(null));
      }

      const [state, volume, queue] = await Promise.all(promises);

      let nextTracks = [];
      if (queue && queue.items) {
        nextTracks = queue.items.slice(0, 5).map(item => ({
          title: item.title || 'Unknown',
          artist: item.artist || item.creator || 'Unknown'
        }));
      }

      let track = null;
      if (state === 'playing') {
        track = await sonos.currentTrack().catch(() => null);
      }

      return {
        state,
        volume,
        maxVolume: config.get('maxVolume') || 75,
        nextTracks,
        track: track ? {
          title: track.title || 'Unknown',
          artist: track.artist || 'Unknown',
          album: track.album || 'Unknown',
          position: track.position || 0,
          duration: track.duration || 0
        } : null
      };
    } catch (err) {
      return {
        error: err.message,
        state: 'unknown',
        volume: null,
        track: null
      };
    }
  }

  function getConfigForAdmin() {
    const openaiApiKey = config.get('openaiApiKey');
    const telemetryInstanceId = config.get('telemetryInstanceId');
    const adminPasswordHash = config.get('adminPasswordHash');
    const discordToken = config.get('discordToken');

    return {
      discordToken: discordToken ? maskSensitive(discordToken) : '',
      discordChannels: config.get('discordChannels') || [],
      discordAdminRoles: config.get('discordAdminRoles') || [],
      adminChannel: config.get('adminChannel') || 'music-admin',
      standardChannel: config.get('standardChannel') || 'music',
      maxVolume: config.get('maxVolume') || 75,
      market: config.get('market') || 'US',
      gongLimit: config.get('gongLimit') || 3,
      voteLimit: config.get('voteLimit') || 6,
      voteImmuneLimit: config.get('voteImmuneLimit') || 6,
      flushVoteLimit: config.get('flushVoteLimit') || 6,
      voteTimeLimitMinutes: config.get('voteTimeLimitMinutes') || 2,
      ttsEnabled: config.get('ttsEnabled') !== false,
      ttsProvider: config.get('ttsProvider') || 'google',
      ttsFallbackProvider: config.get('ttsFallbackProvider') || 'google',
      openaiTtsModel: config.get('openaiTtsModel') || 'gpt-4o-mini-tts',
      openaiTtsVoice: config.get('openaiTtsVoice') || 'alloy',
      openaiTtsSpeed: Number(config.get('openaiTtsSpeed') || 1),
      openaiTtsInstructions: config.get('openaiTtsInstructions') || '',
      logLevel: config.get('logLevel') || 'info',
      ipAddress: config.get('ipAddress') || '',
      webPort: config.get('webPort') || 8080,
      httpsPort: config.get('httpsPort') || 8443,
      sonos: config.get('sonos') || '',
      defaultTheme: config.get('defaultTheme') || '',
      themePercentage: config.get('themePercentage') || 0,
      queueThreadThreshold: config.get('queueThreadThreshold') || 20,
      openaiApiKey: openaiApiKey ? maskSensitive(openaiApiKey) : '',
      aiModel: config.get('aiModel') || 'gpt-4o-mini',
      aiMoodMirrorEnabled: config.get('aiMoodMirrorEnabled') === true,
      soundcraftEnabled: config.get('soundcraftEnabled') || false,
      soundcraftIp: config.get('soundcraftIp') || '',
      soundcraftChannels: config.get('soundcraftChannels') || [],
      crossfadeEnabled: config.get('crossfadeEnabled') === true,
      slackAlwaysThread: config.get('slackAlwaysThread') === true,
      webauthnRequireUserVerification: config.get('webauthnRequireUserVerification') === true,
      webauthnPreferPlatformOnly: config.get('webauthnPreferPlatformOnly') === true,
      webauthnTimeout: parseInt(config.get('webauthnTimeout') || '60', 10),
      webauthnResidentKey: config.get('webauthnResidentKey') || 'discouraged',
      webauthnChallengeExpiration: parseInt(config.get('webauthnChallengeExpiration') || '60', 10),
      webauthnMaxCredentials: parseInt(config.get('webauthnMaxCredentials') || '0', 10),
      telemetryInstanceId: telemetryInstanceId ? maskSensitive(telemetryInstanceId) : '',
      adminPasswordHash: adminPasswordHash ? '[REDACTED]' : ''
    };
  }

  function broadcastLog(logEntry) {
    ensureClientSets();
    logBuffer.push(logEntry);

    if (logBuffer.length > maxLogBufferSize) {
      logBuffer.shift();
    }

    if (global.logStreamClients && global.logStreamClients.size > 0) {
      const message = `data: ${JSON.stringify({ type: 'log', ...logEntry })}\n\n`;
      global.logStreamClients.forEach(client => {
        try {
          client.write(message);
        } catch {
          global.logStreamClients.delete(client);
        }
      });
    }
  }

  function broadcastStatusUpdate(type, data) {
    ensureClientSets();
    if (global.statusStreamClients && global.statusStreamClients.size > 0) {
      const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
      global.statusStreamClients.forEach(client => {
        try {
          client.write(message);
        } catch {
          global.statusStreamClients.delete(client);
        }
      });
    }
  }

  function startStatusPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
    }

    const sonosIp = config.get('sonos');
    if (!sonosIp || sonosIp === 'IP_TO_SONOS') {
      logger.debug('Status polling not started - Sonos not configured');
      return;
    }

    statusPollInterval = setInterval(async () => {
      try {
        const nowPlaying = await getNowPlaying({ skipQueue: true });
        const currentTrackId = nowPlaying.track
          ? `${nowPlaying.track.title}|${nowPlaying.track.artist}|${nowPlaying.track.queuePosition || 0}`
          : null;

        if (currentTrackId !== lastTrackInfo) {
          lastTrackInfo = currentTrackId;
          broadcastStatusUpdate('nowPlaying', { data: nowPlaying });
        }

        if (!global.lastStatusCheck || Date.now() - global.lastStatusCheck > 30000) {
          global.lastStatusCheck = Date.now();
          const status = await getAdminStatus();
          broadcastStatusUpdate('status', { data: status });
        }
      } catch (err) {
        if (logger && logger.debug) {
          logger.debug('Status polling error (non-critical):', err.message);
        }
      }
    }, 2000);

    if (statusPollInterval && statusPollInterval.unref) {
      statusPollInterval.unref();
    }
  }

  function stopStatusPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
  }

  function handleStatusStream(req, res) {
    ensureClientSets();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('data: {"type":"connected"}\n\n');

    (async () => {
      try {
        const status = await getAdminStatus();
        res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);

        const nowPlaying = await getNowPlaying();
        res.write(`data: ${JSON.stringify({ type: 'nowPlaying', data: nowPlaying })}\n\n`);
      } catch (err) {
        logger.error('Error sending initial status data:', err);
      }
    })();

    global.statusStreamClients.add(res);
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeatInterval);
        global.statusStreamClients.delete(res);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      global.statusStreamClients.delete(res);
    });
  }

  function handleLogStream(req, res) {
    ensureClientSets();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('data: {"type":"connected"}\n\n');
    logBuffer.forEach(log => {
      res.write(`data: ${JSON.stringify({ type: 'log', ...log })}\n\n`);
    });

    global.logStreamClients.add(res);
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeatInterval);
        global.logStreamClients.delete(res);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      global.logStreamClients.delete(res);
    });
  }

  async function updateConfigValue(key, value) {
    try {
      if (!ALLOWED_CONFIG_KEYS.includes(key)) {
        return { success: false, error: 'Key not allowed to be updated via admin' };
      }

      if (key === 'logLevel') {
        const validLevels = ['error', 'warn', 'info', 'debug'];
        if (!validLevels.includes(value)) {
          return { success: false, error: `Invalid log level. Must be one of: ${validLevels.join(', ')}` };
        }
        if (logger && typeof logger.setLevel === 'function') {
          logger.setLevel(value);
          logger.warn(`Log level changed to: ${value}`);
        }
      }

      let coercedValue = value;
      if (NUMERIC_CONFIG_KEYS.has(key)) {
        const numValue = Number(value);
        if (Number.isNaN(numValue)) {
          return { success: false, error: `Invalid value for "${key}". Must be a number.` };
        }
        coercedValue = numValue;
      }

      if (BOOLEAN_CONFIG_KEYS.has(key)) {
        if (typeof value === 'string') {
          const v = value.trim().toLowerCase();
          coercedValue = (v === 'true' || v === '1' || v === 'yes' || v === 'on');
        } else {
          coercedValue = Boolean(value);
        }
      }

      if (RUNTIME_NUMERIC_KEYS.has(key)) {
        setRuntimeConfigValue(key, coercedValue);
      }

      if (VOTING_CONFIG_KEYS.has(key)) {
        try {
          syncVotingConfig();
        } catch (e) {
          logger.warn('Failed to sync voting config after admin update: ' + (e && e.message ? e.message : e));
        }
      }

      config.set(key, coercedValue);
      config.save((err) => {
        if (err) {
          logger.error('Failed to save config:', err);
        } else {
          logger.info(`Config updated via admin: ${key} = ${coercedValue}`);
        }
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    handleAdminAPI,
    getAdminStatus,
    getNowPlaying,
    getConfigForAdmin,
    updateConfigValue,
    broadcastLog,
    startStatusPolling,
    stopStatusPolling
  };
}

module.exports = createAdminApi;
