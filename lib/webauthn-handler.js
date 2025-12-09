/**
 * WebAuthn/FIDO2 Handler
 * Handles WebAuthn registration and authentication
 */

const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const nconf = require('nconf');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const WEBAUTHN_CREDENTIALS_PATH = path.join(__dirname, '..', 'config', 'webauthn-credentials.json');

function logWebAuthn(level, message, meta = {}) {
  const payload = { scope: 'webauthn', ...meta };
  try {
    // Prefer structured logging if logger is available
    if (global.logger && typeof global.logger[level] === 'function') {
      global.logger[level](`${message} ${JSON.stringify(payload)}`);
    } else {
      // Fallback to console
      console[level === 'error' ? 'error' : 'info'](`[WebAuthn] ${message}`, payload);
    }
  } catch {
    // Never throw from logging
  }
}

// In-memory challenge store (Map<challenge, {type: 'registration'|'authentication', userId: string, expires: number}>)
const challenges = new Map();

// Cleanup expired challenges every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [challenge, data] of challenges.entries()) {
    if (data.expires < now) {
      challenges.delete(challenge);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get Relying Party (RP) configuration
 */
function getRPConfig(req) {
  const config = nconf.file({ file: CONFIG_PATH });
  const rpName = config.get('webauthnRpName') || 'SlackONOS';
  let rpId = config.get('webauthnRpId') || null;
  let origin = config.get('webauthnOrigin') || null;

  if (req) {
    const xfProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const xfHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const xfPort = (req.headers['x-forwarded-port'] || '').split(',')[0].trim();

    const protocol = xfProto || (req.connection?.encrypted ? 'https' : 'http') || 'https';
    const hostHeader = xfHost || req.headers.host || '';
    let [hostname, hostPort] = hostHeader.split(':');
    hostPort = hostPort || xfPort || '';

    if (hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      hostname = 'localhost';
    }

    if (!rpId) {
      rpId = hostname;
    }

    let portSegment = '';
    if (hostPort) {
      const portNum = Number(hostPort);
      if (!Number.isNaN(portNum)) {
        const isDefault = (protocol === 'https' && portNum === 443) || (protocol === 'http' && portNum === 80);
        if (!isDefault) portSegment = `:${portNum}`;
      } else {
        const xfPortNum = Number(xfPort);
        if (!Number.isNaN(xfPortNum)) {
          const isDefault = (protocol === 'https' && xfPortNum === 443) || (protocol === 'http' && xfPortNum === 80);
          if (!isDefault) portSegment = `:${xfPortNum}`;
        }
      }
    } else if (xfPort) {
      const xfPortNum = Number(xfPort);
      if (!Number.isNaN(xfPortNum)) {
        const isDefault = (protocol === 'https' && xfPortNum === 443) || (protocol === 'http' && xfPortNum === 80);
        if (!isDefault) portSegment = `:${xfPortNum}`;
      }
    }

    origin = `${protocol}://${hostname}${portSegment}`;
  }

  if (!origin) {
    const fallbackPort = config.get('webPort') || 8181;
    origin = `https://${rpId || 'localhost'}${fallbackPort && fallbackPort !== 443 ? ':' + fallbackPort : ''}`;
    if (!rpId) rpId = origin.split('://')[1].split(':')[0];
  }

  origin = origin.replace(/\/+$/, '');
  rpId = rpId.split(':')[0];

  logWebAuthn('info', 'RP config', { rpName, rpId, origin });
  return { rpName, rpId, origin };
}

/**
 * Load WebAuthn credentials from file
 */
async function loadCredentials() {
  try {
    const data = await fs.readFile(WEBAUTHN_CREDENTIALS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, return empty credentials
      return { credentials: [] };
    }
    throw err;
  }
}

/**
 * Save WebAuthn credentials to file
 */
async function saveCredentials(credentialsData) {
  const credentialsDir = path.dirname(WEBAUTHN_CREDENTIALS_PATH);
  try {
    await fs.mkdir(credentialsDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
  await fs.writeFile(WEBAUTHN_CREDENTIALS_PATH, JSON.stringify(credentialsData, null, 2), 'utf8');
}

/**
 * Check if WebAuthn is enabled
 */
function isWebAuthnEnabled() {
  const config = nconf.file({ file: CONFIG_PATH });
  return config.get('webauthnEnabled') === true;
}

/**
 * Check if user has registered WebAuthn credentials
 */
async function hasCredentials() {
  if (!isWebAuthnEnabled()) return false;
  const credentialsData = await loadCredentials();
  return credentialsData.credentials && credentialsData.credentials.length > 0;
}

/**
 * Get user ID (for single-user system, use 'admin')
 */
function getUserId() {
  return 'admin';
}

/**
 * Generate registration options
 */
async function generateRegistrationOptionsHandler(req) {
  if (!isWebAuthnEnabled()) {
    throw new Error('WebAuthn is not enabled');
  }

  const { rpName, rpId, origin } = getRPConfig(req);
  logWebAuthn('info', 'Generating registration options', { rpId, origin });
  const userId = getUserId();
  
  // Load existing credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  // Check if user verification is required (for PIN on Yubikey, or biometrics like Touch ID/Face ID)
  // Default is true (more secure) - set to false to allow authenticators without user verification
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true; // Default: false for maximum compatibility

  // For maximum compatibility: Don't set authenticatorAttachment to allow both platform (Touch ID/Face ID) and cross-platform (USB/NFC) authenticators
  // According to WebAuthn spec, when authenticatorAttachment is not set, browsers should show both options
  // Note: Some browsers (like Chrome) may prioritize platform authenticators when userVerification is required,
  // but not setting authenticatorAttachment is the most compatible approach per spec
  const authenticatorSelection = requireUserVerification ? {
    userVerification: 'required', // Require user verification (PIN for Yubikey, biometrics for Touch ID/Face ID)
    residentKey: 'preferred', // Don't force resident keys - allows both platform (Touch ID) and roaming (Yubikey) authenticators
    // No authenticatorAttachment = browser should show both Touch ID/Face ID AND USB/NFC security keys
  } : {
    userVerification: 'preferred', // Allow authenticators without user verification
    residentKey: 'preferred',
    // No authenticatorAttachment = user can choose between Touch ID/Face ID OR USB/NFC security keys
  };

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: userId,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map(cred => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
      transports: cred.transports || [],
    })),
    authenticatorSelection,
    supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
  });

  // Store challenge
  const challenge = options.challenge;
  challenges.set(challenge, {
    type: 'registration',
    userId,
    expires: Date.now() + 60000, // 1 minute
  });

  return options;
}

/**
 * Verify registration response
 */
async function verifyRegistrationResponseHandler(req, body) {
  if (!isWebAuthnEnabled()) {
    throw new Error('WebAuthn is not enabled');
  }

  const data = JSON.parse(body);
  const { rpName, rpId, origin } = getRPConfig(req);
  const userId = getUserId();

  // Get challenge
  const challenge = data.response.clientDataJSON ?
    JSON.parse(Buffer.from(data.response.clientDataJSON, 'base64url').toString()).challenge : null;

  logWebAuthn('info', 'Verifying registration', { rpId, origin, expectedChallenge: challenge });
  
  const challengeData = challenges.get(challenge);
  if (!challengeData || challengeData.type !== 'registration' || challengeData.userId !== userId) {
    throw new Error('Invalid or expired challenge');
  }

  // Load existing credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  // Check if user verification is required
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true;

  // Verify registration
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: data,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: requireUserVerification,
    });
  } catch (err) {
    logWebAuthn('error', 'Registration verification failed', { error: err.message, stack: err.stack });
    challenges.delete(challenge);
    throw new Error(`Verification failed: ${err.message}`);
  }

  const { verified, registrationInfo } = verification;

  if (!verified || !registrationInfo) {
    challenges.delete(challenge);
    throw new Error('Registration verification failed');
  }

  // Save new credential
  const newCredential = {
    credentialID: Buffer.from(registrationInfo.credentialID).toString('base64url'),
    credentialPublicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64url'),
    counter: typeof registrationInfo.counter === 'number' ? registrationInfo.counter : 0,
    transports: data.response.transports || [],
    deviceName: data.deviceName || 'Unknown Device',
    registeredAt: new Date().toISOString(),
  };

  existingCredentials.push(newCredential);
  await saveCredentials({ credentials: existingCredentials });

  // Clean up challenge
  challenges.delete(challenge);

  return { verified: true, credential: newCredential };
}

/**
 * Generate authentication options
 */
async function generateAuthenticationOptionsHandler(req) {
  if (!isWebAuthnEnabled()) {
    throw new Error('WebAuthn is not enabled');
  }

  const { rpId, origin } = getRPConfig(req);
  const userId = getUserId();

  // Load credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  if (existingCredentials.length === 0) {
    throw new Error('No WebAuthn credentials registered');
  }

  // Check if user verification is required
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true;

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    timeout: 60000,
    allowCredentials: existingCredentials.map(cred => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
      transports: cred.transports || [],
    })),
    userVerification: requireUserVerification ? 'required' : 'preferred',
  });

  // Store challenge
  const challenge = options.challenge;
  challenges.set(challenge, {
    type: 'authentication',
    userId,
    expires: Date.now() + 60000, // 1 minute
  });

  logWebAuthn('info', 'Generated authentication options', { 
    rpId, 
    origin, 
    challenge: challenge.slice(0, 16) + '...',
    credentialCount: existingCredentials.length
  });

  return options;
}

/**
 * Verify authentication response
 */
async function verifyAuthenticationResponseHandler(req, body) {
  if (!isWebAuthnEnabled()) {
    throw new Error('WebAuthn is not enabled');
  }

  const data = JSON.parse(body);
  const { rpId, origin } = getRPConfig(req);
  const userId = getUserId();

  // Get challenge from response
  const clientDataJSON = Buffer.from(data.response.clientDataJSON, 'base64url').toString();
  const clientData = JSON.parse(clientDataJSON);
  const receivedChallenge = clientData.challenge;

  logWebAuthn('info', 'Verifying authentication', { 
    rpId, 
    origin, 
    receivedChallenge: receivedChallenge.slice(0, 16) + '...',
    credentialId: data.id?.slice(0, 8) + '...'
  });

  // Direct Map lookup - SimpleWebAuthn returns challenges in the same format
  const challengeData = challenges.get(receivedChallenge);

  if (!challengeData || challengeData.type !== 'authentication' || challengeData.userId !== userId) {
    logWebAuthn('error', 'Challenge validation failed', { 
      receivedChallenge: receivedChallenge?.slice(0, 16) + '...',
      hasMatch: !!challengeData,
      type: challengeData?.type,
      userId: challengeData?.userId,
      expectedUserId: userId,
      storedChallenges: Array.from(challenges.keys()).map(c => c.slice(0, 16) + '...')
    });
    throw new Error('Invalid or expired challenge');
  }

  const challenge = receivedChallenge;

  // Load credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  // Find credential by ID
  const credentialID = data.id;
  const credentialIDBuffer = Buffer.from(credentialID, 'base64url');

  const credential = existingCredentials.find(cred =>
    Buffer.from(cred.credentialID, 'base64url').equals(credentialIDBuffer)
  );

  if (!credential) {
    challenges.delete(challenge);
    throw new Error('Credential not found');
  }

  const credentialCounter = typeof credential.counter === 'number' ? credential.counter : 0;
  logWebAuthn('info', 'Authentication credential loaded', { rpId, origin, credentialID: credentialID.slice(0, 8) + '...', counter: credentialCounter });

  // Check if user verification is required
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true;

  // Verify authentication
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: data,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      authenticator: {
        credentialID: Buffer.from(credential.credentialID, 'base64url'),
        credentialPublicKey: Buffer.from(credential.credentialPublicKey, 'base64url'),
        counter: credentialCounter,
        transports: credential.transports || [],
      },
      requireUserVerification: requireUserVerification,
    });
  } catch (err) {
    logWebAuthn('error', 'Authentication verification failed', { error: err.message, stack: err.stack });
    challenges.delete(challenge);
    throw new Error(`Verification failed: ${err.message}`);
  }

  const { verified, authenticationInfo } = verification;

  logWebAuthn('info', 'Authenticator flags', { credentialID: credentialID.slice(0, 8) + '...', userVerified: authenticationInfo?.userVerified });

  if (!authenticationInfo) {
    challenges.delete(challenge);
    throw new Error('Authentication info missing from verification result');
  }

  if (!verified) {
    challenges.delete(challenge);
    throw new Error('Authentication verification failed');
  }

  // Update counter
  credential.counter = authenticationInfo.newCounter;
  await saveCredentials({ credentials: existingCredentials });

  // Clean up challenge
  challenges.delete(challenge);

  logWebAuthn('info', 'Authentication successful', { 
    credentialID: credentialID.slice(0, 8) + '...', 
    newCounter: authenticationInfo.newCounter 
  });

  return { verified: true };
}

/**
 * Get registered credentials
 */
async function getCredentials() {
  if (!isWebAuthnEnabled()) return [];
  const credentialsData = await loadCredentials();
  logWebAuthn('info', 'Listing credentials', { count: credentialsData.credentials?.length || 0 });
  return credentialsData.credentials || [];
}

/**
 * Delete a credential
 */
async function deleteCredential(credentialID) {
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];
  const filtered = existingCredentials.filter(
    cred => cred.credentialID !== credentialID
  );
  await saveCredentials({ credentials: filtered });
  return { success: true };
}

module.exports = {
  isWebAuthnEnabled,
  hasCredentials,
  generateRegistrationOptions: generateRegistrationOptionsHandler,
  verifyRegistrationResponse: verifyRegistrationResponseHandler,
  generateAuthenticationOptions: generateAuthenticationOptionsHandler,
  verifyAuthenticationResponse: verifyAuthenticationResponseHandler,
  getCredentials,
  deleteCredential,
  getRPConfig: (req) => getRPConfig(req),
};