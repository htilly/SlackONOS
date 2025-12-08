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

  // Discord bot tokens typically start with specific patterns
  // Format: [number].[alphanumeric]-[alphanumeric]
  if (!/^[\w-]{24}\.[\w-]{6}\.[\w-]{27}$/.test(token) && 
      !/^mfa\.[\w-]{84}$/.test(token)) {
    return { valid: false, error: 'Invalid Discord token format' };
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

