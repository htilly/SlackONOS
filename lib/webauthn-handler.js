/**
 * WebAuthn/FIDO2 Handler
 * Handles WebAuthn registration and authentication
 */

const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
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

  // logWebAuthn('info', 'RP config', { rpName, rpId, origin }); // Debug: disabled
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
 * Returns false if WebAuthn is disabled, credentials file doesn't exist, or no credentials are registered
 */
async function hasCredentials() {
  if (!isWebAuthnEnabled()) return false;
  
  try {
    // Check if credentials file exists
    await fs.access(WEBAUTHN_CREDENTIALS_PATH);
    // File exists, check if it has credentials
  const credentialsData = await loadCredentials();
  return credentialsData.credentials && credentialsData.credentials.length > 0;
  } catch (err) {
    // File doesn't exist (ENOENT) or other error - no credentials available
    if (err.code === 'ENOENT') {
      logWebAuthn('info', 'Credentials file does not exist, falling back to password login');
      return false;
    }
    // Other error - log it but still return false to allow password fallback
    logWebAuthn('warn', 'Error checking credentials file', { error: err.message });
    return false;
  }
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
  // logWebAuthn('info', 'Generating registration options', { rpId, origin }); // Debug: disabled
  const userId = getUserId();
  
  // Load existing credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  // Check if user verification is required (for PIN on Yubikey, or biometrics like Touch ID/Face ID)
  // Default is false for maximum compatibility - set to true to require PIN/biometric
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true; // Default: false for maximum compatibility

  // Check if we should prefer platform authenticators only (to reduce QR code prompts on macOS/iOS)
  // Setting this to true will only allow Touch ID/Face ID, not Yubikeys
  const preferPlatformOnly = config.get('webauthnPreferPlatformOnly') === true; // Default: false to allow both

  // Get timeout (default: 60 seconds, min: 10, max: 300)
  const timeout = Math.min(Math.max(parseInt(config.get('webauthnTimeout') || 60, 10), 10), 300) * 1000;

  // Get resident key preference: 'discouraged' (default, no passkeys), 'preferred' (allow passkeys), 'required' (force passkeys)
  const residentKeyPreference = config.get('webauthnResidentKey') || 'discouraged';
  const validResidentKeyOptions = ['discouraged', 'preferred', 'required'];
  const residentKey = validResidentKeyOptions.includes(residentKeyPreference) ? residentKeyPreference : 'discouraged';

  // Get max credentials limit (default: unlimited, 0 = unlimited)
  const maxCredentials = parseInt(config.get('webauthnMaxCredentials') || '0', 10);

  // Check max credentials limit
  if (maxCredentials > 0 && existingCredentials.length >= maxCredentials) {
    throw new Error(`Maximum number of credentials (${maxCredentials}) reached. Please delete an existing credential first.`);
  }

  // Configure authenticator selection
  // Note: macOS/iOS may still show QR code prompts for platform authenticators even with residentKey: 'discouraged'
  // This is a system-level passkey feature that cannot be fully disabled via WebAuthn API
  // Users can dismiss the QR code prompt and use Touch ID/Face ID directly
  const authenticatorSelection = {
    userVerification: requireUserVerification ? 'required' : 'discouraged', // 'discouraged' allows touch-only Yubikeys
    residentKey: residentKey, // 'discouraged' (no passkeys), 'preferred' (allow passkeys), 'required' (force passkeys)
    // Set authenticatorAttachment only if user wants platform-only (reduces QR prompts but disables Yubikey)
    ...(preferPlatformOnly ? { authenticatorAttachment: 'platform' } : {}),
  };

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: userId,
    timeout: timeout,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map(cred => ({
      id: cred.credentialID, // SimpleWebAuthn v13+ expects base64url string, not Buffer
      type: 'public-key',
      transports: cred.transports || [],
    })),
    authenticatorSelection,
    // Support multiple algorithms for broader hardware compatibility
    // -7: ES256 (ECDSA w/ SHA-256), -257: RS256 (RSASSA-PKCS1-v1_5 w/ SHA-256), -8: EdDSA
    supportedAlgorithmIDs: [-7, -257, -8],
  });

  // Store challenge with configurable expiration
  const challenge = options.challenge;
  const challengeExpiration = Math.min(Math.max(parseInt(config.get('webauthnChallengeExpiration') || 60, 10), 30), 300) * 1000; // 30s to 5min, default 60s
  challenges.set(challenge, {
    type: 'registration',
    userId,
    expires: Date.now() + challengeExpiration,
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

  // logWebAuthn('info', 'Verifying registration', { rpId, origin, expectedChallenge: challenge }); // Debug: disabled
  
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
  // CRITICAL: Save credentialID EXACTLY as SimpleWebAuthn provides it (base64url string)
  // DO NOT convert, decode, or re-encode - this causes authentication to fail!
  // SimpleWebAuthn v13+ uses registrationInfo.credential.id (already base64url string)
  const credentialID = registrationInfo.credential?.id || registrationInfo.credentialID;
  const credentialPublicKey = registrationInfo.credential?.publicKey || registrationInfo.credentialPublicKey;

  // Debug: Raw credential data logging disabled

  // CRITICAL FIX: SimpleWebAuthn v13+ returns credentialID as base64url STRING
  // We MUST save it exactly as-is without any conversion
  // Converting it (even if it looks like we're "just encoding") will change the value
  // and cause authentication to fail with "Try a different key"
  let credentialIDString;
  if (typeof credentialID === 'string') {
    // Already a base64url string - use it EXACTLY as-is (NO conversion!)
    credentialIDString = credentialID;
  } else if (Buffer.isBuffer(credentialID)) {
    // If it's a Buffer (raw bytes), convert to base64url string
    credentialIDString = credentialID.toString('base64url');
  } else if (credentialID instanceof Uint8Array) {
    // If it's Uint8Array (raw bytes), convert to base64url string
    const buffer = Buffer.from(credentialID);
    credentialIDString = buffer.toString('base64url');
  } else {
    // Fallback: try to convert (but this shouldn't happen with SimpleWebAuthn v13+)
    credentialIDString = Buffer.from(credentialID).toString('base64url');
    logWebAuthn('warn', 'Credential ID is unexpected type, attempting conversion', { 
      type: typeof credentialID,
      isBuffer: Buffer.isBuffer(credentialID),
      constructor: credentialID?.constructor?.name
    });
  }

  // Convert public key to base64url string if needed
  let credentialPublicKeyString;
  if (typeof credentialPublicKey === 'string') {
    credentialPublicKeyString = credentialPublicKey;
  } else if (Buffer.isBuffer(credentialPublicKey)) {
    credentialPublicKeyString = credentialPublicKey.toString('base64url');
  } else if (credentialPublicKey instanceof Uint8Array) {
    credentialPublicKeyString = Buffer.from(credentialPublicKey).toString('base64url');
  } else {
    credentialPublicKeyString = Buffer.from(credentialPublicKey).toString('base64url');
  }

  const newCredential = {
    credentialID: credentialIDString, // Save as base64url string - EXACTLY as it should be used
    credentialPublicKey: credentialPublicKeyString,
    counter: typeof registrationInfo.counter === 'number' ? registrationInfo.counter : 0,
    transports: data.response.transports || [],
    deviceName: data.deviceName || 'Unknown Device',
    registeredAt: new Date().toISOString(),
  };

  // Debug: Detailed credential saving logs disabled
  existingCredentials.push(newCredential);
  await saveCredentials({ credentials: existingCredentials });
  logWebAuthn('info', 'Credential saved successfully', { deviceName: newCredential.deviceName });

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

  // logWebAuthn('info', 'Generating authentication options', { rpId, origin }); // Debug: disabled

  // Load credentials
  const credentialsData = await loadCredentials();
  const existingCredentials = credentialsData.credentials || [];

  // logWebAuthn('info', 'Loaded credentials for authentication', { count: existingCredentials.length }); // Debug: disabled

  if (existingCredentials.length === 0) {
    throw new Error('No WebAuthn credentials registered');
  }

  // Check if user verification is required
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true;

  // Get timeout (default: 60 seconds, min: 10, max: 300)
  const timeout = Math.min(Math.max(parseInt(config.get('webauthnTimeout') || 60, 10), 10), 300) * 1000;

  let options;
  try {
    // Map credentials with explicit transports to prevent QR code prompts
    // If transports include 'internal', it's a platform authenticator (Touch ID)
    // Setting transports explicitly helps prevent cross-device passkey prompts
    // CRITICAL: Use credentialID EXACTLY as stored (base64url string) - no conversion!
    const allowCredentials = existingCredentials.map(cred => {
      // Debug: Credential mapping logs disabled
      const credential = {
        id: cred.credentialID, // Use EXACTLY as stored - should be base64url string
        type: 'public-key',
      };
      
      // If transports are stored, use them to help prevent QR code prompts
      if (cred.transports && cred.transports.length > 0) {
        credential.transports = cred.transports;
      }
      // If no transports stored but it's a platform authenticator, explicitly set 'internal'
      // This helps prevent the browser from offering QR code options
      // Note: We can't detect this retroactively, but new registrations will have transports
      
      return credential;
    });
    
    options = await generateAuthenticationOptions({
      rpID: rpId,
      timeout: timeout,
      allowCredentials: allowCredentials,
      // Use 'discouraged' instead of 'preferred' for better Yubikey compatibility
      userVerification: requireUserVerification ? 'required' : 'discouraged',
    });

    // Debug: console.log disabled
  } catch (err) {
    logWebAuthn('error', 'Failed to generate authentication options', {
      error: err.message,
      stack: err.stack,
      credentialCount: existingCredentials.length,
      sampleCredential: existingCredentials[0] ? {
        credentialIDLength: existingCredentials[0].credentialID?.length,
        hasTransports: !!existingCredentials[0].transports
      } : null
    });
    throw err;
  }

  // Store challenge with configurable expiration
  const challenge = options.challenge;
  const challengeExpiration = Math.min(Math.max(parseInt(config.get('webauthnChallengeExpiration') || 60, 10), 30), 300) * 1000; // 30s to 5min, default 60s
  challenges.set(challenge, {
    type: 'authentication',
    userId,
    expires: Date.now() + challengeExpiration,
  });

  // logWebAuthn('info', 'Generated authentication options', { rpId, origin, credentialCount: existingCredentials.length }); // Debug: disabled

  return options;
}

/**
 * Verify authentication response
 */
async function verifyAuthenticationResponseHandler(req, body) {
  // logWebAuthn('info', 'verifyAuthenticationResponseHandler called', { bodyLength: body?.length }); // Debug: disabled

  if (!isWebAuthnEnabled()) {
    throw new Error('WebAuthn is not enabled');
  }

  let data;
  try {
    data = JSON.parse(body);
    // logWebAuthn('info', 'Request body parsed successfully', { hasId: !!data.id, hasResponse: !!data.response }); // Debug: disabled
  } catch (err) {
    logWebAuthn('error', 'Failed to parse request body', { 
      error: err.message,
      bodyPreview: body?.slice(0, 200)
    });
    throw new Error('Invalid request body');
  }

  // Validate response structure
  if (!data.response) {
    logWebAuthn('error', 'Response object missing from request', { 
      dataKeys: Object.keys(data)
    });
    throw new Error('Response object missing from request');
  }

  if (!data.response.clientDataJSON) {
    logWebAuthn('error', 'clientDataJSON missing from response', {
      responseKeys: Object.keys(data.response)
    });
    throw new Error('clientDataJSON missing from response');
  }

  const { rpId, origin } = getRPConfig(req);
  const userId = getUserId();

  // Get challenge from response
  let clientDataJSON, clientData, receivedChallenge;
  try {
    clientDataJSON = Buffer.from(data.response.clientDataJSON, 'base64url').toString();
    clientData = JSON.parse(clientDataJSON);
    receivedChallenge = clientData.challenge;

  // logWebAuthn('info', 'Client data parsed', { type: clientData.type }); // Debug: disabled
  } catch (err) {
    logWebAuthn('error', 'Failed to parse clientDataJSON', { 
      error: err.message,
      clientDataJSONPreview: data.response.clientDataJSON?.slice(0, 100)
    });
    throw new Error('Invalid clientDataJSON');
  }

  // Extract credential ID - try both 'id' and 'rawId' fields
  // SimpleWebAuthn browser library v9+ uses 'id' field
  const credentialID = data.id || data.rawId;
  if (!credentialID) {
    logWebAuthn('error', 'Credential ID missing from response', { 
      hasId: !!data.id, 
      hasRawId: !!data.rawId,
      responseKeys: Object.keys(data),
      responseType: data.response?.type
    });
    throw new Error('Credential ID missing from response');
  }

  // logWebAuthn('info', 'Verifying authentication', { rpId, origin }); // Debug: disabled

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

  // logWebAuthn('info', 'Searching for credential', { storedCredentialCount: existingCredentials.length }); // Debug: disabled

  // Find credential by ID - handle both string and buffer formats
  let credentialIDBuffer;
  let credentialIDString;
  try {
    // credentialID might already be a base64url string or might need conversion
    if (typeof credentialID === 'string') {
      credentialIDString = credentialID;
      credentialIDBuffer = Buffer.from(credentialID, 'base64url');
    } else if (Buffer.isBuffer(credentialID)) {
      credentialIDBuffer = credentialID;
      credentialIDString = credentialID.toString('base64url');
    } else {
      // Try to convert array or other format
      credentialIDBuffer = Buffer.from(credentialID);
      credentialIDString = credentialIDBuffer.toString('base64url');
    }
  } catch (err) {
    logWebAuthn('error', 'Failed to convert credential ID to buffer', { 
      error: err.message,
      credentialIdType: typeof credentialID,
      credentialIdValue: credentialID?.slice?.(0, 16) + '...'
    });
    throw new Error('Invalid credential ID format');
  }

  // Try multiple matching strategies
  const credential = existingCredentials.find(cred => {
    try {
      // Strategy 1: Compare as buffers (most reliable)
      const storedIDBuffer = Buffer.from(cred.credentialID, 'base64url');
      if (storedIDBuffer.equals(credentialIDBuffer)) {
        return true;
      }
      
      // Strategy 2: Compare as strings (in case of encoding differences)
      if (cred.credentialID === credentialIDString) {
        return true;
      }
      
      // Strategy 3: Try comparing the raw buffer if stored as buffer
      if (Buffer.isBuffer(cred.credentialID)) {
        if (cred.credentialID.equals(credentialIDBuffer)) {
          return true;
        }
      }
      
      return false;
    } catch (err) {
      logWebAuthn('warn', 'Failed to compare credential ID', { 
        error: err.message,
        storedCredentialID: cred.credentialID?.slice?.(0, 16) + '...'
      });
      return false;
    }
  });

  if (!credential) {
    logWebAuthn('error', 'Credential not found', {
      credentialIdFromClient: credentialID?.slice(0, 16) + '...',
      storedCredentialCount: existingCredentials.length,
      storedCredentialIds: existingCredentials.map(c => c.credentialID?.slice(0, 16) + '...')
    });
    challenges.delete(challenge);
    throw new Error('Credential not found');
  }

  const credentialCounter = typeof credential.counter === 'number' ? credential.counter : 0;
  // logWebAuthn('info', 'Authentication credential loaded', { counter: credentialCounter }); // Debug: disabled

  // Check if user verification is required
  const config = nconf.file({ file: CONFIG_PATH });
  const requireUserVerification = config.get('webauthnRequireUserVerification') === true;

  // CRITICAL: SimpleWebAuthn v11+ (we're using v13) uses 'credential' not 'authenticator'
  // And expects 'id' and 'publicKey' as base64url STRINGS, not Buffers!
  // Structure: { id: string, publicKey: string, counter: number, transports: string[] }
  // Debug: Detailed credential preparation logs disabled

  // Verify authentication - CRITICAL: Use SimpleWebAuthn v13 structure
  // Must pass 'credential' (not 'authenticator') with 'id' and 'publicKey' as base64url strings
  let verification;
  try {
    const credentialObject = {
      id: credential.credentialID, // base64url string (NOT Buffer!)
      publicKey: credential.credentialPublicKey, // base64url string (NOT Buffer!)
      counter: credentialCounter, // Number
      transports: credential.transports || [], // Array of transport strings
    };
    
    // Debug: Detailed verification call logs disabled

    verification = await verifyAuthenticationResponse({
      response: data, // CRITICAL: Pass the FULL response object from the browser
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.credentialID,               // base64url string
        publicKey: Buffer.from(credential.credentialPublicKey, 'base64url'), // CRITICAL: Convert from base64url string to Buffer!
        signCount: credentialCounter,                // number
        transports: credential.transports || [],   // array
      },
      requireUserVerification,
    });
    
    

    
    
    // logWebAuthn('info', 'Verification completed', { verified: verification.verified }); // Debug: disabled
  } catch (err) {
    logWebAuthn('error', 'Authentication verification failed', { 
      error: err.message, 
      stack: err.stack,
      errorName: err.name,
      rpId,
      origin,
      challengeLength: challenge?.length
    });
    challenges.delete(challenge);
    throw new Error(`Verification failed: ${err.message}`);
  }

  const { verified, authenticationInfo } = verification;

  // logWebAuthn('info', 'Authenticator flags', { userVerified: authenticationInfo?.userVerified }); // Debug: disabled

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

  // logWebAuthn('info', 'Authentication successful', { newCounter: authenticationInfo.newCounter }); // Debug: disabled

  return { verified: true };
}

/**
 * Get credentials file info (path and content) for debugging
 */
async function getCredentialsFileInfo() {
  try {
    const fileExists = await fs.access(WEBAUTHN_CREDENTIALS_PATH, fsSync.constants.F_OK).then(() => true).catch(() => false);
    let content = null;
    let fileSize = 0;
    
    if (fileExists) {
      try {
        const fileContent = await fs.readFile(WEBAUTHN_CREDENTIALS_PATH, 'utf8');
        fileSize = fileContent.length;
        content = JSON.parse(fileContent);
      } catch (err) {
        content = { error: 'Failed to read/parse file: ' + err.message };
      }
    }
    
    return {
      path: WEBAUTHN_CREDENTIALS_PATH,
      exists: fileExists,
      size: fileSize,
      content: content
    };
  } catch (err) {
    return {
      path: WEBAUTHN_CREDENTIALS_PATH,
      exists: false,
      error: err.message
    };
  }
}

/**
 * Get registered credentials
 */
async function getCredentials() {
  if (!isWebAuthnEnabled()) return [];
  const credentialsData = await loadCredentials();
  // logWebAuthn('info', 'Listing credentials', { count: credentialsData.credentials?.length || 0 }); // Debug: disabled
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
  getCredentialsFileInfo,
  generateRegistrationOptions: generateRegistrationOptionsHandler,
  verifyRegistrationResponse: verifyRegistrationResponseHandler,
  generateAuthenticationOptions: generateAuthenticationOptionsHandler,
  verifyAuthenticationResponse: verifyAuthenticationResponseHandler,
  getCredentials,
  deleteCredential,
  getRPConfig: (req) => getRPConfig(req),
};