/**
 * GitHub App Authentication
 * Handles JWT generation and installation token management
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Hardcoded GitHub App credentials
const GITHUB_APP_ID = '2741767';
const GITHUB_APP_INSTALLATION_ID = '106479987';
const GITHUB_APP_PRIVATE_KEY_PATH = path.join(__dirname, '..', 'keys', 'github-app-private-key.pem');

let cachedToken = null;
let tokenExpiresAt = null;

/**
 * Generate JWT for GitHub App authentication
 * @param {string} appId - GitHub App ID
 * @param {string} privateKey - Private key content (PEM format)
 * @returns {string} JWT token
 */
function generateJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued at: 60 seconds in the past
    exp: now + 600, // Expires: 10 minutes in the future
    iss: appId // Issuer: App ID
  };

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  // Encode header and payload (base64url = base64 without padding, with URL-safe chars)
  const base64url = (str) => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with private key
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  sign.end();
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Get installation access token (cached for 1 hour)
 * @param {string} appId - GitHub App ID
 * @param {string} privateKey - Private key content
 * @param {string} installationId - Installation ID
 * @returns {Promise<string>} Installation access token
 */
async function getInstallationToken(appId, privateKey, installationId) {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  try {
    // Generate JWT
    const jwt = generateJWT(appId, privateKey);

    // Request installation token
    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get installation token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    cachedToken = data.token;
    // Tokens expire after 1 hour, cache for 55 minutes to be safe
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;

    return cachedToken;
  } catch (error) {
    throw new Error(`GitHub App authentication failed: ${error.message}`);
  }
}

/**
 * Get GitHub App access token (either from cache or by generating new one)
 * @returns {Promise<string|null>} Access token or null if not configured
 */
async function getGitHubAppToken() {
  // Check if private key file exists
  if (!fs.existsSync(GITHUB_APP_PRIVATE_KEY_PATH)) {
    return null;
  }

  try {
    const privateKey = fs.readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
    return await getInstallationToken(GITHUB_APP_ID, privateKey, GITHUB_APP_INSTALLATION_ID);
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getGitHubAppToken,
  generateJWT // Exported for testing
};
