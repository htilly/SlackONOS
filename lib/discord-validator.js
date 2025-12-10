/**
 * Discord Token Validator
 * Validates Discord bot token
 */

/**
 * Validate Discord bot token
 * @param {string} token - Discord bot token
 * @returns {Promise<{valid: boolean, error?: string, botInfo?: object}>}
 */
async function validateDiscordToken(token) {
  if (!token || token.trim() === '') {
    return { valid: false, error: 'Discord token is required' };
  }

  // Discord bot tokens have the format: [base64].[base64].[base64]
  // Each part is base64url encoded (A-Z, a-z, 0-9, -, _)
  // The parts are separated by dots (.)
  // Format can vary: typically [24 chars].[6 chars].[27-38 chars] or mfa.[84+ chars]
  // We'll be more lenient and just check for the basic structure with dots
  const trimmedToken = token.trim();
  
  // Basic format check: should have at least 2 dots separating parts
  // Allow base64url characters: A-Z, a-z, 0-9, -, _, and dots as separators
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmedToken) && 
      !/^mfa\.[A-Za-z0-9_-]+$/.test(trimmedToken)) {
    return { valid: false, error: 'Invalid Discord token format. Expected format: [part1].[part2].[part3] or mfa.[token]' };
  }
  
  // Additional length check: Discord tokens are typically 59+ characters total
  if (trimmedToken.length < 50) {
    return { valid: false, error: 'Discord token appears too short. Please check the token.' };
  }

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bot ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        botInfo: {
          id: data.id,
          username: data.username,
          discriminator: data.discriminator
        }
      };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return { 
        valid: false, 
        error: errorData.message || `HTTP ${response.status}: ${response.statusText}` 
      };
    }
  } catch (err) {
    return { 
      valid: false, 
      error: err.message || 'Failed to connect to Discord API' 
    };
  }
}

module.exports = {
  validateDiscordToken
};




