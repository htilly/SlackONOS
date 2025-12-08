/**
 * Authentication Handler
 * Handles password hashing, verification, session management, and rate limiting
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const nconf = require('nconf');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const SALT_ROUNDS = 10;
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

// In-memory session store
const sessions = new Map();

// Rate limiting: Map<ip, {attempts: number, resetTime: number}>
const rateLimitStore = new Map();

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expires < now) {
      sessions.delete(sessionId);
    }
  }
  
  // Cleanup rate limit store
  for (const [ip, data] of rateLimitStore.entries()) {
    if (data.resetTime < now) {
      rateLimitStore.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Every hour

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
async function verifyPassword(password, hash) {
  if (!hash) return false;
  return await bcrypt.compare(password, hash);
}

/**
 * Get password hash from config
 */
function getPasswordHash() {
  const config = nconf.file({ file: CONFIG_PATH });
  return config.get('adminPasswordHash') || null;
}

/**
 * Save password hash to config
 */
async function savePasswordHash(hash) {
  const config = nconf.file({ file: CONFIG_PATH });
  config.set('adminPasswordHash', hash);
  return new Promise((resolve, reject) => {
    config.save((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Check if password is set
 */
function isPasswordSet() {
  return !!getPasswordHash();
}

/**
 * Get admin username from config (defaults to 'admin')
 */
function getAdminUsername() {
  const config = nconf.file({ file: CONFIG_PATH });
  return config.get('adminUsername') || 'admin';
}

/**
 * Generate a secure random session ID
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session
 */
function createSession(userId) {
  const sessionId = generateSessionId();
  const now = Date.now();
  const session = {
    userId,
    created: now,
    expires: now + SESSION_TIMEOUT,
    lastActivity: now
  };
  sessions.set(sessionId, session);
  return sessionId;
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  const now = Date.now();
  if (session.expires < now) {
    sessions.delete(sessionId);
    return null;
  }
  
  // Update last activity
  session.lastActivity = now;
  return session;
}

/**
 * Delete a session
 */
function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Get client IP address from request
 */
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         'unknown';
}

/**
 * Check rate limiting for an IP
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const data = rateLimitStore.get(ip);
  
  if (!data || data.resetTime < now) {
    // Reset or create new entry
    rateLimitStore.set(ip, {
      attempts: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return { allowed: true, remaining: RATE_LIMIT_ATTEMPTS - 1 };
  }
  
  if (data.attempts >= RATE_LIMIT_ATTEMPTS) {
    return { 
      allowed: false, 
      remaining: 0,
      resetTime: data.resetTime 
    };
  }
  
  data.attempts++;
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_ATTEMPTS - data.attempts 
  };
}

/**
 * Reset rate limit for an IP (on successful login)
 */
function resetRateLimit(ip) {
  rateLimitStore.delete(ip);
}

/**
 * Extract session ID from cookie
 */
function getSessionIdFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'sessionId') {
      return decodeURIComponent(value);
    }
  }
  return null;
}

/**
 * Set session cookie in response
 */
function setSessionCookie(res, sessionId, secure = false) {
  const cookieOptions = [
    `sessionId=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TIMEOUT / 1000}`,
    'Path=/'
  ];
  
  if (secure) {
    cookieOptions.push('Secure');
  }
  
  res.setHeader('Set-Cookie', cookieOptions.join('; '));
}

/**
 * Clear session cookie
 */
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

/**
 * Verify authentication from request
 */
function verifyAuth(req) {
  const sessionId = getSessionIdFromCookie(req.headers.cookie);
  if (!sessionId) return { authenticated: false };
  
  const session = getSession(sessionId);
  if (!session) return { authenticated: false };
  
  return { authenticated: true, session };
}

/**
 * Handle login request (password or WebAuthn)
 */
async function handleLogin(req, res, body) {
  try {
    const data = JSON.parse(body);
    
    // Check if this is a WebAuthn authentication
    if (data.webauthn && data.webauthn === true) {
      // WebAuthn authentication is handled separately
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Use WebAuthn authentication endpoint' }));
      return;
    }
    
    const { username, password } = data;
    
    if (!username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Username and password required' }));
      return;
    }
    
    // Check if WebAuthn is enabled and user has credentials
    // Only block password login if WebAuthn is enabled AND credentials exist
    // This allows password login when WebAuthn is enabled but no credentials are registered yet
    let webauthnHandler;
    try {
      webauthnHandler = require('./webauthn-handler');
      const webauthnEnabled = webauthnHandler.isWebAuthnEnabled();
      const hasCredentials = webauthnEnabled ? await webauthnHandler.hasCredentials() : false;
      
      if (webauthnEnabled && hasCredentials) {
        // WebAuthn is enabled and user has credentials - password login not allowed
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'WebAuthn is enabled and credentials are registered. Please use your security key to login.' 
        }));
        return;
      }
      // If WebAuthn is enabled but no credentials exist, allow password login
      // This allows users to log in and register their first WebAuthn credential
    } catch (err) {
      // WebAuthn handler not available, continue with password
    }
    
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(ip);
    
    if (!rateLimit.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Too many login attempts. Please try again later.' 
      }));
      return;
    }
    
    const adminUsername = getAdminUsername();
    const passwordHash = getPasswordHash();
    
    if (!passwordHash) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Password not configured. Please complete setup first.' 
      }));
      return;
    }
    
    // Verify username and password
    if (username !== adminUsername) {
      // Don't reveal if username is correct (security best practice)
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
      return;
    }
    
    const isValid = await verifyPassword(password, passwordHash);
    
    if (!isValid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
      return;
    }
    
    // Successful login - reset rate limit and create session
    resetRateLimit(ip);
    const sessionId = createSession(username);
    
    // Detect if HTTPS (for secure cookie flag)
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || 
                     req.connection?.encrypted === true ||
                     req.socket?.encrypted === true;
    
    setSessionCookie(res, sessionId, isSecure);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
}

/**
 * Handle logout request
 */
function handleLogout(req, res) {
  const sessionId = getSessionIdFromCookie(req.headers.cookie);
  if (sessionId) {
    deleteSession(sessionId);
  }
  clearSessionCookie(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * Handle password setup (during initial setup)
 */
async function handlePasswordSetup(req, res, body) {
  try {
    const data = JSON.parse(body);
    const { password, confirmPassword } = data;
    
    if (!password || !confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Password and confirmation required' }));
      return;
    }
    
    if (password !== confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Passwords do not match' }));
      return;
    }
    
    if (password.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Password must be at least 8 characters' }));
      return;
    }
    
    const hash = await hashPassword(password);
    await savePasswordHash(hash);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
}

/**
 * Handle password change (requires current password)
 */
async function handlePasswordChange(req, res, body) {
  try {
    const data = JSON.parse(body);
    const { currentPassword, newPassword, confirmPassword } = data;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'All password fields are required' }));
      return;
    }
    
    // Verify current password
    const passwordHash = getPasswordHash();
    if (!passwordHash) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Password not configured' }));
      return;
    }
    
    const isValidCurrent = await verifyPassword(currentPassword, passwordHash);
    if (!isValidCurrent) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Current password is incorrect' }));
      return;
    }
    
    // Validate new password
    if (newPassword.length < 8) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'New password must be at least 8 characters' }));
      return;
    }
    
    if (newPassword !== confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'New passwords do not match' }));
      return;
    }
    
    // Check if new password is same as current
    const isSamePassword = await verifyPassword(newPassword, passwordHash);
    if (isSamePassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'New password must be different from current password' }));
      return;
    }
    
    // Save new password hash
    const newHash = await hashPassword(newPassword);
    await savePasswordHash(newHash);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Password changed successfully' }));
    
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  getPasswordHash,
  savePasswordHash,
  isPasswordSet,
  getAdminUsername,
  createSession,
  getSession,
  deleteSession,
  verifyAuth,
  handleLogin,
  handleLogout,
  handlePasswordSetup,
  handlePasswordChange,
  getClientIp,
  checkRateLimit,
  resetRateLimit,
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromCookie
};

