/**
 * Spotify Credentials Validator
 * Validates Spotify Client ID and Secret by attempting authentication
 */

/**
 * Validate Spotify credentials
 * @param {string} clientId - Spotify Client ID
 * @param {string} clientSecret - Spotify Client Secret
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateSpotifyCredentials(clientId, clientSecret) {
  if (!clientId || clientId.trim() === '') {
    return { valid: false, error: 'Client ID is required' };
  }

  if (!clientSecret || clientSecret.trim() === '') {
    return { valid: false, error: 'Client Secret is required' };
  }

  try {
    // Attempt to get an access token using client credentials flow
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });

    const data = await response.json();

    if (response.ok && data.access_token) {
      return { valid: true };
    } else {
      return { 
        valid: false, 
        error: data.error_description || data.error || 'Invalid credentials' 
      };
    }
  } catch (err) {
    return { 
      valid: false, 
      error: err.message || 'Failed to connect to Spotify API' 
    };
  }
}

module.exports = {
  validateSpotifyCredentials
};








