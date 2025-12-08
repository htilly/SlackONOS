/**
 * Setup Wizard - Clean Implementation
 */

const API_BASE = '/api/setup';
let configData = {};
let selectedPlatforms = new Set(['slack']); // Default to Slack
let currentPage = 'welcome';
let configValues = null; // Cache for config values

const pageOrder = [
  'welcome',
  'platform',
  'slack',      // Conditional
  'discord',    // Conditional
  'sonos',
  'spotify',
  'password',
  'success'
];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadConfigValues(); // Load config values on startup
  showPage('welcome');
  checkSetupStatus();
});

async function checkSetupStatus() {
  try {
    // FIRST: Always check if password is set
    const response = await fetch(`${API_BASE}/status`);
    const data = await response.json();
    
    // If password is not set, force password setup first
    if (!data.passwordSet) {
      // No password set - must set password first
      showPage('password');
      // Disable back button on password page when forced
      const backBtn = document.getElementById('btn-back-password');
      if (backBtn) {
        backBtn.style.display = 'none';
      }
      // Show required notice
      const requiredNotice = document.getElementById('password-required-notice');
      const optionalNotice = document.getElementById('password-optional-notice');
      const description = document.getElementById('password-page-description');
      if (requiredNotice) requiredNotice.style.display = 'block';
      if (optionalNotice) optionalNotice.style.display = 'none';
      if (description) description.textContent = 'You must set an admin password before continuing';
      return;
    }
    
    // Password is set, continue with normal flow
    // Check if force parameter is present - if so, always show setup wizard
    const urlParams = new URLSearchParams(window.location.search);
    const force = urlParams.get('force') === 'true';
    
    if (force) {
      // Force mode - password is set, show welcome page
      showPage('welcome');
      return;
    }
    
    // Check if bot is configured and connected - if so, redirect to admin
    if (data.needed === false && 
        data.config && 
        ((data.config.hasSlack || data.config.hasDiscord) && 
         data.config.hasSpotify && 
         data.config.hasSonos)) {
      // Check if bot is actually connected by checking admin status
      try {
        const adminResponse = await fetch('/api/admin/status');
        const adminStatus = await adminResponse.json();
        
        // Check if at least one platform is connected
        const isConnected = (adminStatus.slack && adminStatus.slack.connected) ||
                           (adminStatus.discord && adminStatus.discord.connected);
        
        if (isConnected) {
          // Bot is connected, redirect to admin page (will require login)
          window.location.href = '/admin';
          return;
        }
      } catch (adminErr) {
        // If admin check fails, continue to show setup wizard
        console.warn('Could not check admin status:', adminErr);
      }
      
      // Setup is complete but not connected, show success page
      showPage('success');
    } else {
      // Setup is needed or incomplete, show welcome page
      showPage('welcome');
    }
  } catch (err) {
    console.error('Error checking setup status:', err);
    // On error, show welcome page
    showPage('welcome');
  }
}

function setupEventListeners() {
  // Welcome
  document.getElementById('btn-start')?.addEventListener('click', () => showPage('platform'));

  // Platform selection
  document.querySelectorAll('.platform-card').forEach(card => {
    card.addEventListener('click', () => {
      const platform = card.dataset.platform;
      if (platform === 'both') {
        selectedPlatforms = new Set(['slack', 'discord']);
      } else if (platform === 'slack') {
        selectedPlatforms = new Set(['slack']);
      } else if (platform === 'discord') {
        selectedPlatforms = new Set(['discord']);
      }
      updatePlatformSelection();
    });
  });

  document.getElementById('btn-back-platform')?.addEventListener('click', () => showPage('welcome'));
  document.getElementById('btn-next-platform')?.addEventListener('click', () => {
    if (selectedPlatforms.size === 0) {
      alert('Välj minst en plattform');
      return;
    }
    if (selectedPlatforms.has('slack')) {
      showPage('slack');
    } else if (selectedPlatforms.has('discord')) {
      showPage('discord');
    } else {
      showPage('sonos');
    }
  });

  // Slack
  document.getElementById('btn-back-slack')?.addEventListener('click', () => showPage('platform'));
  document.getElementById('btn-next-slack')?.addEventListener('click', () => {
    if (validateSlack()) {
      saveSlackData();
      if (selectedPlatforms.has('discord')) {
        showPage('discord');
      } else {
        showPage('sonos');
      }
    }
  });
  document.getElementById('btn-validate-slack')?.addEventListener('click', validateSlackTokens);

  // Discord
  document.getElementById('btn-back-discord')?.addEventListener('click', () => {
    if (selectedPlatforms.has('slack')) {
      showPage('slack');
    } else {
      showPage('platform');
    }
  });
  document.getElementById('btn-skip-discord')?.addEventListener('click', () => {
    showPage('sonos');
  });
  document.getElementById('btn-next-discord')?.addEventListener('click', () => {
    saveDiscordData();
    showPage('sonos');
  });
  document.getElementById('btn-validate-discord')?.addEventListener('click', validateDiscordToken);

  // Sonos
  document.getElementById('btn-back-sonos')?.addEventListener('click', () => {
    if (selectedPlatforms.has('discord')) {
      showPage('discord');
    } else if (selectedPlatforms.has('slack')) {
      showPage('slack');
    } else {
      showPage('platform');
    }
  });
  document.getElementById('btn-next-sonos')?.addEventListener('click', () => {
    if (validateSonos()) {
      saveSonosData();
      showPage('spotify');
    }
  });
  document.getElementById('btn-discover-sonos')?.addEventListener('click', discoverSonos);
  document.getElementById('btn-validate-sonos')?.addEventListener('click', validateSonosConnection);

  // Spotify
  document.getElementById('btn-back-spotify')?.addEventListener('click', () => showPage('sonos'));
  document.getElementById('btn-finish')?.addEventListener('click', async () => {
    if (validateSpotify()) {
      saveSpotifyData();
      // Check if password is already set - if so, skip password step
      try {
        const statusResponse = await fetch(`${API_BASE}/status`);
        const statusData = await statusResponse.json();
        if (statusData.passwordSet) {
          // Password already set, skip to success
          await finishSetup();
          showPage('success');
        } else {
          // No password set, go to password setup
          showPage('password');
        }
      } catch (err) {
        // On error, go to password step
        showPage('password');
      }
    }
  });
  document.getElementById('btn-validate-spotify')?.addEventListener('click', validateSpotifyCredentials);

  // Password Setup
  document.getElementById('btn-back-password')?.addEventListener('click', () => {
    // Check if password was required (no back button shown)
    const backBtn = document.getElementById('btn-back-password');
    if (backBtn && backBtn.style.display !== 'none') {
      showPage('spotify');
    }
  });
  document.getElementById('btn-next-password')?.addEventListener('click', async () => {
    if (await setupPassword()) {
      // Check if we're in forced password setup mode (no back button)
      const backBtn = document.getElementById('btn-back-password');
      const isForcedSetup = backBtn && backBtn.style.display === 'none';
      
      if (isForcedSetup) {
        // Password was required and now set, reload page to check setup status
        // This will now show welcome page since password is set
        window.location.reload();
      } else {
        // Normal flow - password was set during setup, finish setup
        await finishSetup();
        showPage('success');
      }
    }
  });
  
  document.getElementById('btn-restart')?.addEventListener('click', restartApp);
}

async function showPage(pageId) {
  currentPage = pageId;
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.classList.add('active');
  }
  
  // Populate form fields with existing config values when showing config pages
  if (['slack', 'discord', 'sonos', 'spotify'].includes(pageId)) {
    await populateConfigFields(pageId);
  }
}

function updatePlatformSelection() {
  document.querySelectorAll('.platform-card').forEach(card => {
    const platform = card.dataset.platform;
    let isSelected = false;
    
    if (platform === 'both' && selectedPlatforms.size === 2) {
      isSelected = true;
    } else if (platform === 'slack' && selectedPlatforms.size === 1 && selectedPlatforms.has('slack')) {
      isSelected = true;
    } else if (platform === 'discord' && selectedPlatforms.size === 1 && selectedPlatforms.has('discord')) {
      isSelected = true;
    }
    
    card.classList.toggle('selected', isSelected);
  });
}

/**
 * Load config values from server
 */
async function loadConfigValues() {
  try {
    const response = await fetch(`${API_BASE}/config-values`);
    const data = await response.json();
    if (data.exists && data.values) {
      configValues = data.values;
    }
  } catch (err) {
    console.warn('Could not load config values:', err);
    configValues = null;
  }
}

/**
 * Check if a value is masked (contains ***)
 */
function isMaskedValue(value) {
  return value && value.includes('***');
}

/**
 * Create show/hide toggle for credential fields
 */
function createCredentialToggle(inputId, originalValue) {
  const input = document.getElementById(inputId);
  if (!input || !originalValue || !isMaskedValue(originalValue)) {
    return; // No toggle needed for non-masked or empty values
  }
  
  // Store original masked value
  input.dataset.maskedValue = originalValue;
  input.dataset.isMasked = 'true';
  input.type = 'password'; // Start as password type for masked values
  
  // Create toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn-credential-toggle';
  toggleBtn.innerHTML = '👁️ Show';
  toggleBtn.style.cssText = 'margin-left: 0.5rem; padding: 0.25rem 0.75rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: white; cursor: pointer; font-size: 0.85rem;';
  
  let isShowing = false;
  toggleBtn.addEventListener('click', () => {
    isShowing = !isShowing;
    if (isShowing) {
      // Show placeholder indicating it's masked
      input.type = 'text';
      input.value = '';
      input.placeholder = 'Enter new value (current value is masked)';
      toggleBtn.innerHTML = '🙈 Hide';
    } else {
      // Restore masked value
      input.type = 'password';
      input.value = originalValue;
      input.placeholder = '';
      toggleBtn.innerHTML = '👁️ Show';
    }
  });
  
  // Insert toggle button after input
  const formGroup = input.closest('.form-group');
  if (formGroup) {
    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'display: flex; align-items: center;';
    input.parentNode.insertBefore(inputWrapper, input);
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(toggleBtn);
  }
}

/**
 * Populate form fields with existing config values
 */
async function populateConfigFields(pageId) {
  // Ensure we have config values
  if (!configValues) {
    await loadConfigValues();
  }
  
  if (!configValues) {
    return; // No config values available
  }
  
  switch (pageId) {
    case 'slack':
      const slackAppTokenInput = document.getElementById('slack-app-token');
      const slackBotTokenInput = document.getElementById('slack-bot-token');
      const adminChannelInput = document.getElementById('admin-channel');
      const standardChannelInput = document.getElementById('standard-channel');
      
      if (slackAppTokenInput && configValues.slackAppToken) {
        slackAppTokenInput.value = configValues.slackAppToken;
        createCredentialToggle('slack-app-token', configValues.slackAppToken);
      }
      if (slackBotTokenInput && configValues.slackBotToken) {
        slackBotTokenInput.value = configValues.slackBotToken;
        createCredentialToggle('slack-bot-token', configValues.slackBotToken);
      }
      if (adminChannelInput && configValues.adminChannel) {
        adminChannelInput.value = configValues.adminChannel;
      }
      if (standardChannelInput && configValues.standardChannel) {
        standardChannelInput.value = configValues.standardChannel;
      }
      break;
      
    case 'discord':
      const discordTokenInput = document.getElementById('discord-token');
      const discordChannelsInput = document.getElementById('discord-channels');
      const discordAdminRolesInput = document.getElementById('discord-admin-roles');
      
      if (discordTokenInput && configValues.discordToken) {
        discordTokenInput.value = configValues.discordToken;
        createCredentialToggle('discord-token', configValues.discordToken);
      }
      if (discordChannelsInput && configValues.discordChannels) {
        discordChannelsInput.value = configValues.discordChannels;
      }
      if (discordAdminRolesInput && configValues.discordAdminRoles) {
        discordAdminRolesInput.value = configValues.discordAdminRoles;
      }
      break;
      
    case 'sonos':
      const sonosIpInput = document.getElementById('sonos-ip');
      if (sonosIpInput && configValues.sonosIp) {
        sonosIpInput.value = configValues.sonosIp;
      }
      break;
      
    case 'spotify':
      const spotifyClientIdInput = document.getElementById('spotify-client-id');
      const spotifyClientSecretInput = document.getElementById('spotify-client-secret');
      
      if (spotifyClientIdInput && configValues.spotifyClientId) {
        spotifyClientIdInput.value = configValues.spotifyClientId;
        createCredentialToggle('spotify-client-id', configValues.spotifyClientId);
      }
      if (spotifyClientSecretInput && configValues.spotifyClientSecret) {
        spotifyClientSecretInput.value = configValues.spotifyClientSecret;
        createCredentialToggle('spotify-client-secret', configValues.spotifyClientSecret);
      }
      break;
  }
}

function validateSlack() {
  const appTokenInput = document.getElementById('slack-app-token');
  const botTokenInput = document.getElementById('slack-bot-token');
  
  const appToken = appTokenInput?.value?.trim();
  const botToken = botTokenInput?.value?.trim();
  
  // If values are masked, they're valid (existing config)
  if (isMaskedValue(appToken) && isMaskedValue(botToken)) {
    return true;
  }
  
  if (!appToken || !botToken) {
    alert('Fill in both App-Level token and Bot token');
      return false;
    }
  
  if (!appToken.startsWith('xapp-') || !botToken.startsWith('xoxb-')) {
    alert('Slack tokens should start with xapp- and xoxb- respectively');
      return false;
  }
  
  return true;
}

function saveSlackData() {
  const slackAppTokenInput = document.getElementById('slack-app-token');
  const slackBotTokenInput = document.getElementById('slack-bot-token');
  
  // Only save if value was changed (not masked)
  if (slackAppTokenInput && !isMaskedValue(slackAppTokenInput.value)) {
    configData.slackAppToken = slackAppTokenInput.value.trim() || '';
  }
  if (slackBotTokenInput && !isMaskedValue(slackBotTokenInput.value)) {
    configData.token = slackBotTokenInput.value.trim() || '';
  }
  
  configData.adminChannel = document.getElementById('admin-channel')?.value?.trim() || 'music-admin';
  configData.standardChannel = document.getElementById('standard-channel')?.value?.trim() || 'music';
}

function saveDiscordData() {
  const discordTokenInput = document.getElementById('discord-token');
  // Only save if value was changed (not masked)
  if (discordTokenInput && !isMaskedValue(discordTokenInput.value)) {
    configData.discordToken = discordTokenInput.value.trim() || '';
  }
  const channels = document.getElementById('discord-channels')?.value || '';
  configData.discordChannels = channels.split(',').map(c => c.trim()).filter(Boolean);
  const roles = document.getElementById('discord-admin-roles')?.value || '';
  configData.discordAdminRoles = roles.split(',').map(r => r.trim()).filter(Boolean);
}

function validateSonos() {
  const sonosIp = document.getElementById('sonos-ip')?.value?.trim();
  const selectedDevice = document.querySelector('.device-item.selected');
  
  if (!sonosIp && !selectedDevice) {
    alert('Välj en Sonos-enhet eller ange IP-adress');
    return false;
  }
  
  if (sonosIp && !/^(\d{1,3}\.){3}\d{1,3}$/.test(sonosIp)) {
    alert('Ange en giltig IP-adress (ex: 192.168.1.100)');
    return false;
  }
  
  return true;
}

function saveSonosData() {
    const selectedDevice = document.querySelector('.device-item.selected');
    if (selectedDevice) {
      configData.sonos = selectedDevice.dataset.ip;
    } else {
    configData.sonos = document.getElementById('sonos-ip')?.value?.trim() || '';
  }
}

function saveSpotifyData() {
  const spotifyClientIdInput = document.getElementById('spotify-client-id');
  const spotifyClientSecretInput = document.getElementById('spotify-client-secret');
  
  // Only save if value was changed (not masked)
  if (spotifyClientIdInput && !isMaskedValue(spotifyClientIdInput.value)) {
    configData.spotifyClientId = spotifyClientIdInput.value.trim() || '';
  }
  if (spotifyClientSecretInput && !isMaskedValue(spotifyClientSecretInput.value)) {
    configData.spotifyClientSecret = spotifyClientSecretInput.value.trim() || '';
  }
  
  configData.market = document.getElementById('spotify-market')?.value || 'US';
}

function validateSpotify() {
  const clientId = document.getElementById('spotify-client-id')?.value?.trim();
  const clientSecret = document.getElementById('spotify-client-secret')?.value?.trim();
  
  if (!clientId || !clientSecret) {
    alert('Fill in both Client ID and Secret');
    return false;
  }
  
  return true;
}

async function setupPassword() {
  const password = document.getElementById('password')?.value;
  const passwordConfirm = document.getElementById('password-confirm')?.value;
  const validationDiv = document.getElementById('password-validation');
  
  if (!password || !passwordConfirm) {
    showError(validationDiv, 'Please enter both password and confirmation');
    return false;
  }
  
  if (password.length < 8) {
    showError(validationDiv, 'Password must be at least 8 characters');
    return false;
  }
  
  if (password !== passwordConfirm) {
    showError(validationDiv, 'Passwords do not match');
    return false;
  }
  
  showLoading(validationDiv, 'Setting up password...');
  
  try {
    const response = await fetch(`${API_BASE}/password-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword: passwordConfirm })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showSuccess(validationDiv, '✓ Password set successfully');
      return true;
    } else {
      showError(validationDiv, data.error || 'Failed to set password');
      return false;
    }
  } catch (err) {
    showError(validationDiv, `Error: ${err.message}`);
    return false;
  }
}

async function discoverSonos() {
  const btn = document.getElementById('btn-discover-sonos');
  const list = document.getElementById('sonos-devices');
  const errorDiv = document.getElementById('sonos-error');
  
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = 'Söker... <span class="loading"></span>';
  if (list) list.innerHTML = '';
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.className = 'validation-message';
  }

  try {
    const response = await fetch(`${API_BASE}/discover-sonos`);
    const data = await response.json();

    if (data.success && data.devices.length > 0) {
      list.innerHTML = data.devices.map(device => `
        <div class="device-item" data-ip="${device.ip}">
          <strong>${device.name}</strong>
          <small>${device.model} - ${device.ip}</small>
        </div>
      `).join('');

      document.querySelectorAll('.device-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.device-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          const ipInput = document.getElementById('sonos-ip');
          if (ipInput) ipInput.value = item.dataset.ip;
        });
      });
    } else {
      if (errorDiv) {
        errorDiv.textContent = 'Inga Sonos-enheter hittades. Kontrollera att de är på och på samma nätverk.';
        errorDiv.classList.add('error');
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.textContent = `Fel: ${err.message}`;
      errorDiv.classList.add('error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🔍</span> Upptäck Sonos-enheter';
  }
}

async function validateSlackTokens() {
  const appTokenInput = document.getElementById('slack-app-token');
  const botTokenInput = document.getElementById('slack-bot-token');
  const resultDiv = document.getElementById('slack-validation');
  
  let appToken = appTokenInput?.value?.trim();
  let botToken = botTokenInput?.value?.trim();
  
  // If values are masked or empty, try to get actual values from server
  if (!appToken || !botToken || isMaskedValue(appToken) || isMaskedValue(botToken)) {
    showLoading(resultDiv, 'Fetching credentials for validation...');
    try {
      const credResponse = await fetch(`${API_BASE}/actual-credentials`);
      const credData = await credResponse.json();
      
      if (credData.exists && credData.values) {
        // Use actual values if input is masked/empty
        if (!appToken || isMaskedValue(appToken)) {
          appToken = credData.values.slackAppToken || '';
        }
        if (!botToken || isMaskedValue(botToken)) {
          botToken = credData.values.slackBotToken || '';
        }

  if (!appToken || !botToken) {
          showError(resultDiv, 'No tokens found to validate. Please enter token values.');
          return;
        }
      } else {
        showError(resultDiv, 'Please enter token values to validate.');
        return;
      }
    } catch (err) {
      showError(resultDiv, 'Could not fetch credentials. Please enter token values to validate.');
    return;
    }
  }

  showLoading(resultDiv, 'Validating...');

  try {
    const response = await fetch(`${API_BASE}/validate-slack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appToken, botToken })
    });

    const data = await response.json();

    if (data.valid) {
      showSuccess(resultDiv, '✓ Tokens are valid!');
    } else {
      showError(resultDiv, data.errors?.join(', ') || 'Validation failed');
    }
  } catch (err) {
    showError(resultDiv, `Error: ${err.message}`);
  }
}

async function validateDiscordToken() {
  const tokenInput = document.getElementById('discord-token');
  const resultDiv = document.getElementById('discord-validation');
  
  let token = tokenInput?.value?.trim();
  
  // If value is masked or empty, try to get actual value from server
  if (!token || isMaskedValue(token)) {
    showLoading(resultDiv, 'Fetching credential for validation...');
    try {
      const credResponse = await fetch(`${API_BASE}/actual-credentials`);
      const credData = await credResponse.json();
      
      if (credData.exists && credData.values) {
        // Use actual value if input is masked/empty
        if (!token || isMaskedValue(token)) {
          token = credData.values.discordToken || '';
        }
        
        if (!token) {
          showError(resultDiv, 'No token found to validate. Please enter a token value.');
          return;
        }
      } else {
        showError(resultDiv, 'Please enter a token value to validate.');
        return;
      }
    } catch (err) {
      showError(resultDiv, 'Could not fetch credential. Please enter a token value to validate.');
      return;
    }
  }
  
  showLoading(resultDiv, 'Validating...');
  
  try {
    const response = await fetch(`${API_BASE}/validate-discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    
    const data = await response.json();
    
    if (data.valid) {
      showSuccess(resultDiv, `✓ Token is valid! Bot: ${data.botInfo?.username || 'Unknown'}`);
    } else {
      showError(resultDiv, data.error || 'Validation failed');
    }
  } catch (err) {
    showError(resultDiv, `Error: ${err.message}`);
  }
}

async function validateSpotifyCredentials() {
  const clientIdInput = document.getElementById('spotify-client-id');
  const clientSecretInput = document.getElementById('spotify-client-secret');
  const resultDiv = document.getElementById('spotify-validation');
  
  let clientId = clientIdInput?.value?.trim();
  let clientSecret = clientSecretInput?.value?.trim();
  
  // If values are masked or empty, try to get actual values from server
  if (!clientId || !clientSecret || isMaskedValue(clientId) || isMaskedValue(clientSecret)) {
    showLoading(resultDiv, 'Fetching credentials for validation...');
    try {
      const credResponse = await fetch(`${API_BASE}/actual-credentials`);
      const credData = await credResponse.json();
      
      if (credData.exists && credData.values) {
        // Use actual values if input is masked/empty
        if (!clientId || isMaskedValue(clientId)) {
          clientId = credData.values.spotifyClientId || '';
        }
        if (!clientSecret || isMaskedValue(clientSecret)) {
          clientSecret = credData.values.spotifyClientSecret || '';
        }

  if (!clientId || !clientSecret) {
          showError(resultDiv, 'No credentials found to validate. Please enter credential values.');
          return;
        }
      } else {
        showError(resultDiv, 'Please enter credentials to validate.');
        return;
      }
    } catch (err) {
      showError(resultDiv, 'Could not fetch credentials. Please enter credential values to validate.');
    return;
    }
  }

  showLoading(resultDiv, 'Validating...');

  try {
    const response = await fetch(`${API_BASE}/validate-spotify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });

    const data = await response.json();

    if (data.valid) {
      showSuccess(resultDiv, '✓ Credentials are valid!');
    } else {
      showError(resultDiv, data.error || 'Validation failed');
    }
  } catch (err) {
    showError(resultDiv, `Error: ${err.message}`);
  }
}

async function validateSonosConnection() {
  const sonosIp = document.getElementById('sonos-ip')?.value?.trim();
  const selectedDevice = document.querySelector('.device-item.selected');
  const resultDiv = document.getElementById('sonos-validation');
  
  // Use selected device IP if available, otherwise use manual input
  const ipToValidate = selectedDevice ? selectedDevice.dataset.ip : sonosIp;
  
  if (!ipToValidate) {
    showError(resultDiv, 'Välj en Sonos-enhet eller ange IP-adress');
    return;
  }
  
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ipToValidate)) {
    showError(resultDiv, 'Ange en giltig IP-adress (ex: 192.168.1.100)');
    return;
  }

  showLoading(resultDiv, 'Validerar anslutning...');

  try {
    const response = await fetch(`${API_BASE}/validate-sonos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipAddress: ipToValidate })
    });

    const data = await response.json();

    if (data.valid) {
      const deviceInfo = data.deviceInfo || {};
      const deviceName = deviceInfo.roomName || deviceInfo.model || 'Sonos-enhet';
      showSuccess(resultDiv, `✓ Anslutning lyckades! ${deviceName} (${ipToValidate})`);
    } else {
      showError(resultDiv, data.error || 'Kunde inte ansluta till Sonos-enheten');
    }
  } catch (err) {
    showError(resultDiv, `Fel: ${err.message}`);
  }
}

async function finishSetup() {
  saveSpotifyData();
  
  // Clear Discord data if not selected
  if (!selectedPlatforms.has('discord')) {
    configData.discordToken = '';
    configData.discordChannels = [];
    configData.discordAdminRoles = [];
  }

  try {
    const response = await fetch(`${API_BASE}/save-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configData })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }
    
    return true;
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
    return false;
  }
}

function showSuccess(element, message) {
  if (!element) return;
  element.textContent = message;
  element.className = 'validation-message success';
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.className = 'validation-message error';
}

function showLoading(element, message) {
  if (!element) return;
  element.textContent = message;
  element.className = 'validation-message';
}

async function restartApp() {
  const btn = document.getElementById('btn-restart');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Startar om... <span class="loading"></span>';
  }

  try {
    const response = await fetch(`${API_BASE}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    
    if (data.success) {
      // Show message and wait a bit before redirecting
      if (btn) {
        btn.innerHTML = '✓ Startar om appen...';
      }
      
      // Wait a moment, then redirect to root (which will show setup or main page)
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } else {
      alert(`Kunde inte starta om: ${data.error || 'Okänt fel'}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Starta om appen';
      }
    }
  } catch (err) {
    alert(`Fel vid omstart: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Starta om appen';
    }
  }
}
