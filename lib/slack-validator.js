/**
 * Slack Token Validator
 * Validates Slack app-level and bot tokens
 */

const { WebClient } = require('@slack/web-api');

/**
 * Validate Slack app-level token (xapp-...)
 * @param {string} appToken - App-level token
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateAppToken(appToken) {
  if (!appToken || !appToken.startsWith('xapp-')) {
    return { valid: false, error: 'App token must start with xapp-' };
  }
  
  // App tokens are validated by Socket Mode connection, which happens at startup
  // For now, just check format
  return { valid: true };
}

/**
 * Validate Slack bot token (xoxb-...)
 * @param {string} botToken - Bot user OAuth token
 * @returns {Promise<{valid: boolean, error?: string, botInfo?: object}>}
 */
async function validateBotToken(botToken) {
  if (!botToken || !botToken.startsWith('xoxb-')) {
    return { valid: false, error: 'Bot token must start with xoxb-' };
  }

  try {
    const client = new WebClient(botToken);
    const response = await client.auth.test();
    
    if (response.ok) {
      return {
        valid: true,
        botInfo: {
          botId: response.bot_id,
          userId: response.user_id,
          team: response.team,
          teamId: response.team_id
        }
      };
    } else {
      return { valid: false, error: response.error || 'Token validation failed' };
    }
  } catch (err) {
    return { valid: false, error: err.message || 'Failed to validate token' };
  }
}

/**
 * Validate both Slack tokens
 * @param {string} appToken - App-level token
 * @param {string} botToken - Bot user OAuth token
 * @returns {Promise<{valid: boolean, errors?: string[], botInfo?: object}>}
 */
async function validateSlackTokens(appToken, botToken) {
  const errors = [];
  let botInfo = null;

  const appResult = await validateAppToken(appToken);
  if (!appResult.valid) {
    errors.push(`App token: ${appResult.error}`);
  }

  const botResult = await validateBotToken(botToken);
  if (!botResult.valid) {
    errors.push(`Bot token: ${botResult.error}`);
  } else {
    botInfo = botResult.botInfo;
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    botInfo
  };
}

module.exports = {
  validateAppToken,
  validateBotToken,
  validateSlackTokens
};




















