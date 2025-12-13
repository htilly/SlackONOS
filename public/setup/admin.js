// admin.fixed.js - cleaned and WebAuthn-client integrated
// Based on your original admin.js (modified to use WebAuthnClient). See original for reference: fileciteturn3file0

const API_BASE = '/api/admin';

// Initialize WebAuthn client (expects webauthn-client.js to be loaded on the page)
if (window.WebAuthnClient) {
  WebAuthnClient.init({ apiBase: '/api/auth' });
} else {
  // If module isn't loaded yet, try to initialize later on setupWebAuthn
  console.warn('WebAuthnClient not present at load time; will initialize in setupWebAuthn');
}

// Auto-refresh interval (30 seconds) - kept as fallback
let refreshInterval = null;
// SSE connection for real-time updates
let eventSource = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupLogout();
  setupPasswordChange();
  setupWebAuthn();
  setupConfigCollapse();
  setupSecurityCollapse();
  setupPlayerControls();
  loadAllData();
  setupRefreshButton();
  setupLogViewer();
  loadLogLevel(); // Load log level setting
  startEventStream(); // Use real-time updates instead of polling
  // Keep auto-refresh as fallback (longer interval)
  startAutoRefresh(60000); // Fallback refresh every 60 seconds
});

/* --- Existing UI and data code preserved (only WebAuthn integration changed) --- */

async function loadAllData() {
  await Promise.all([
    loadStatus(),
    loadNowPlaying(),
    loadConfig()
  ]);
}

async function loadStatus() {
  try {
    const response = await fetch(`${API_BASE}/status`);
    if (response.status === 401) {
      window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const status = await response.json();
    const statusGrid = document.getElementById('status-grid');
    statusGrid.innerHTML = '';
    const integrations = [
      { key: 'slack', name: 'Slack', icon: '💬' },
      { key: 'discord', name: 'Discord', icon: '🎮' },
      { key: 'spotify', name: 'Spotify', icon: '🎵' },
      { key: 'sonos', name: 'Sonos', icon: '🔊' },
      { key: 'soundcraft', name: 'Soundcraft', icon: '🎚️' }
    ];
    integrations.forEach(integration => {
      const integrationStatus = status[integration.key];
      const card = createStatusCard(integration, integrationStatus);
      statusGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading status:', err);
    document.getElementById('status-grid').innerHTML = 
      '<div class="status-card"><h3>❌ Error loading status</h3><p class="error-message">' + err.message + '</p></div>';
  }
}

function createStatusCard(integration, status) {
  const card = document.createElement('div');
  card.className = 'status-card';
  let statusHTML = `<h3>${integration.icon} ${integration.name}</h3>`;
  if (!status || !status.configured) {
    statusHTML += `
      <div>
        <span class="status-badge disconnected">Not configured</span>
      </div>
      <p style="margin-top: 1rem; color: rgba(255,255,255,0.6);">
        <a href="/setup?force=true" style="color: #1e90ff;">Configure here</a>
      </p>
    `;
  } else {
    const connected = status.connected;
    statusHTML += `
      <div>
        <span class="status-badge configured">Configured</span>
        <span class="status-badge ${connected ? 'connected' : 'disconnected'}">
          ${connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
    `;
    if (status.error) {
      statusHTML += `<p class="error-message" style="margin-top: 1rem;">Error: ${status.error}</p>`;
    }
    if (status.deviceInfo) {
      statusHTML += `
        <div style="margin-top: 1rem; font-size: 0.9rem; color: rgba(255,255,255,0.7);">
          <div><strong>Model:</strong> ${status.deviceInfo.model || 'Unknown'}</div>
          <div><strong>Room:</strong> ${status.deviceInfo.room || 'Unknown'}</div>
          <div><strong>IP:</strong> ${status.deviceInfo.ip || 'Unknown'}</div>
        </div>
      `;
    }
    if (status.channels && status.channels.length > 0) {
      statusHTML += `
        <div style="margin-top: 1rem; font-size: 0.9rem; color: rgba(255,255,255,0.7);">
          <strong>Channels:</strong> ${status.channels.join(', ')}
        </div>
      `;
    }
    if (status.details) {
      const detailEntries = Object.entries(status.details)
        .map(([k,v]) => `<div><strong>${k}:</strong> ${Array.isArray(v) ? v.join(', ') : v}</div>`)
        .join('');
      statusHTML += `
        <div style="margin-top: 1rem; font-size: 0.9rem; color: rgba(255,255,255,0.7);">
          ${detailEntries}
        </div>
      `;
    }
  }
  card.innerHTML = statusHTML;
  return card;
}

async function loadNowPlaying() {
  try {
    const response = await fetch(`${API_BASE}/now-playing`);
    if (response.status === 401) {
      window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await response.json();
    const content = document.getElementById('now-playing-content');
    if (data.error) {
      content.innerHTML = `<p class="error-message">Error: ${data.error}</p>`;
      return;
    }
    let html = '';
    if (data.track && data.state === 'playing') {
      html = `
        <div class="track-info">
          <div class="track-title">${escapeHtml(data.track.title)}</div>
          <div class="track-artist">by ${escapeHtml(data.track.artist)}</div>
          ${data.track.album ? `<div style="color: rgba(255,255,255,0.6); font-size: 1rem; margin-top: 0.5rem;">${escapeHtml(data.track.album)}</div>` : ''}
        </div>
      `;
    } else {
      const stateEmoji = data.state === 'paused' ? '⏸️' : '⏹️';
      html = `
        <div class="track-info">
          <div style="font-size: 1.5rem;">${stateEmoji} ${data.state === 'paused' ? 'Paused' : 'Stopped'}</div>
        </div>
      `;
    }
    html += `
      <div class="volume-display">
        🔊 Volume: ${data.volume !== null ? data.volume : 'N/A'} / ${data.maxVolume || 75}
      </div>
      <div class="volume-bar">
        <div class="volume-fill" style="width: ${data.volume !== null ? (data.volume / (data.maxVolume || 75) * 100) : 0}%"></div>
      </div>
    `;
    const upNext = (data.nextTracks || []).slice(1, 6);
    if (upNext.length > 0) {
      html += `
        <div style="margin-top: 1.5rem; text-align: left;">
          <h4 style="margin: 0 0 0.5rem 0;">Up next (5):</h4>
          <ol style="padding-left: 1.25rem; color: rgba(255,255,255,0.85);">
            ${upNext.map(t => `<li><strong>${escapeHtml(t.title)}</strong> <span style="color: rgba(255,255,255,0.7);">— ${escapeHtml(t.artist)}</span></li>`).join('')}
          </ol>
        </div>
      `;
    }
    content.innerHTML = html;
  } catch (err) {
    console.error('Error loading now playing:', err);
    document.getElementById('now-playing-content').innerHTML = 
      '<p class="error-message">Error loading: ' + err.message + '</p>';
  }
}

function setupPlayerControls() {
  const btnPlay = document.getElementById('btn-play');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const callAction = async (endpoint, label) => {
    const btns = [btnPlay, btnPause, btnStop].filter(Boolean);
    btns.forEach(b => b.disabled = true);
    try {
      const resp = await fetch(`${API_BASE}/${endpoint}`, { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        alert(`${label} failed: ${data.error || 'Unknown error'}`);
      } else {
        await loadNowPlaying();
      }
    } catch (err) {
      alert(`${label} failed: ${err.message}`);
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  };
  btnPlay?.addEventListener('click', () => callAction('play', 'Start'));
  btnPause?.addEventListener('click', () => callAction('pause', 'Pause'));
  btnStop?.addEventListener('click', () => callAction('stop', 'Stop'));
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`);
    if (response.status === 401) {
      window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const config = await response.json();
    const configItems = document.getElementById('config-items');
    configItems.innerHTML = '';
    const editableConfig = [
      // Discord Settings (Priority)
      { key: 'discordToken', label: '🎮 Discord Bot Token', type: 'password', description: 'Discord bot token from Developer Portal (starts with Mj... or MT...)' },
      { key: 'discordChannels', label: '🎮 Discord Channels', type: 'text', description: 'Comma-separated channel IDs or names (e.g., "music, 1234567890")' },
      { key: 'discordAdminRoles', label: '🎮 Discord Admin Roles', type: 'text', description: 'Comma-separated role names or IDs for admin access (e.g., "Admin, DJ")' },
      
      // Slack Settings
      { key: 'adminChannel', label: '💬 Slack Admin Channel', type: 'text', description: 'Slack channel ID or name for admin commands' },
      { key: 'standardChannel', label: '💬 Slack Standard Channel', type: 'text', description: 'Slack channel ID or name for regular users' },
      
      // General Settings
      { key: 'maxVolume', label: 'Max Volume', type: 'number', min: 1, max: 100, description: 'Maximum volume level (1-100)' },
      { key: 'market', label: 'Market', type: 'select', options: ['US', 'EU', 'SE', 'NO', 'DK', 'FI'], description: 'Spotify market region' },
      { key: 'gongLimit', label: 'Gong Limit', type: 'number', min: 1, description: 'Number of votes needed to skip current track' },
      { key: 'voteLimit', label: 'Vote Limit', type: 'number', min: 1, description: 'Number of votes needed to move track up in queue' },
      { key: 'voteImmuneLimit', label: 'Vote Immune Limit', type: 'number', min: 1, description: 'Votes needed to make track immune to gong' },
      { key: 'flushVoteLimit', label: 'Flush Vote Limit', type: 'number', min: 1, description: 'Number of votes needed to clear entire queue' },
      { key: 'voteTimeLimitMinutes', label: 'Vote Time Limit (minutes)', type: 'number', min: 1, description: 'How long votes remain valid' },
      { key: 'ipAddress', label: 'Host IP Address', type: 'text', description: 'Server IP address (required for TTS - Sonos must be able to reach this)' },
      { key: 'webPort', label: 'HTTP Port', type: 'number', min: 1, max: 65535, description: 'Port for HTTP server' },
      { key: 'httpsPort', label: 'HTTPS Port', type: 'number', min: 1, max: 65535, description: 'Port for HTTPS server' },
      { key: 'sonos', label: 'Sonos IP Address', type: 'text', description: 'IP address of Sonos speaker' },
      { key: 'ttsEnabled', label: 'TTS Enabled', type: 'select', options: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }], description: 'Enable text-to-speech announcements' },
      { key: 'defaultTheme', label: 'Default Theme', type: 'text', description: 'Default music theme (e.g., lounge, club, office)' },
      { key: 'themePercentage', label: 'Theme Percentage', type: 'number', min: 0, max: 100, description: 'Percentage of theme tracks to mix in (0-100)' },
      { key: 'openaiApiKey', label: 'OpenAI API Key', type: 'text', description: 'OpenAI API key for natural language parsing (starts with sk-)' },
      { key: 'aiModel', label: 'AI Model', type: 'select', options: ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo'], description: 'OpenAI model for natural language parsing' },
      { key: 'soundcraftEnabled', label: 'Soundcraft Enabled', type: 'select', options: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }], description: 'Enable Soundcraft mixer integration' },
      { key: 'crossfadeEnabled', label: 'Crossfade Enabled', type: 'select', options: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }], description: 'Enable smooth transitions between tracks (requires queue playback)' }
    ];
    editableConfig.forEach(item => {
      const configItem = createConfigItem(item, config[item.key]);
      configItems.appendChild(configItem);
    });
  } catch (err) {
    console.error('Error loading config:', err);
    document.getElementById('config-items').innerHTML = 
      '<p class="error-message">Error loading: ' + err.message + '</p>';
  }
}

function createConfigItem(item, value) {
  const div = document.createElement('div');
  div.className = 'config-item';
  div.dataset.key = item.key;
  
  // Convert arrays to comma-separated strings for display
  let displayValue = value;
  if (Array.isArray(value)) {
    displayValue = value.join(', ');
  }
  
  let inputHTML = '';
  if (item.type === 'select') {
    inputHTML = `<select id="config-${item.key}">`;
    if (Array.isArray(item.options) && item.options[0] && typeof item.options[0] === 'object') {
      item.options.forEach(opt => {
        inputHTML += `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`;
      });
    } else {
      item.options.forEach(opt => {
        inputHTML += `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`;
      });
    }
    inputHTML += '</select>';
  } else {
    const inputType = item.type === 'number' ? 'number' : (item.type === 'password' ? 'password' : 'text');
    const attrs = [];
    if (item.min !== undefined) attrs.push(`min="${item.min}"`);
    if (item.max !== undefined) attrs.push(`max="${item.max}"`);
    const finalDisplayValue = displayValue !== null && displayValue !== undefined ? displayValue : '';
    const isSensitive = item.type === 'password' || item.key.includes('ApiKey') || item.key.includes('Token') || item.key.includes('Secret');
    const finalInputType = isSensitive ? 'password' : inputType;
    if (isSensitive && !finalDisplayValue) {
      attrs.push(`placeholder="Enter ${item.label.toLowerCase()}"`);
    }
    inputHTML = `<input type="${finalInputType}" id="config-${item.key}" value="${escapeHtml(finalDisplayValue)}" ${attrs.join(' ')}>`;
  }
  const description = item.description ? `<div style="font-size: 0.85rem; color: rgba(255,255,255,0.6); margin-top: 0.25rem;">${item.description}</div>` : '';
  div.innerHTML = `
    <label for="config-${item.key}">${item.label}:</label>
    ${inputHTML}
    <button class="btn-save" onclick="saveConfig('${item.key}')">Save</button>
    ${description}
    <div id="config-${item.key}-message"></div>
  `;
  return div;
}

async function saveConfig(key) {
  const input = document.getElementById(`config-${key}`);
  const messageDiv = document.getElementById(`config-${key}-message`);
  const btn = input.parentElement.querySelector('.btn-save');
  if (!input) return;
  let value = input.value;
  if (input.type === 'number') {
    value = parseFloat(value);
  } else if (input.type === 'select-one') {
    const select = input;
    if (select.options[select.selectedIndex].value === 'true') {
      value = true;
    } else if (select.options[select.selectedIndex].value === 'false') {
      value = false;
    } else {
      value = select.value;
    }
  } else if (key === 'discordChannels' || key === 'discordAdminRoles') {
    // Convert comma-separated string to array
    value = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  messageDiv.innerHTML = '';
  try {
    const response = await fetch(`${API_BASE}/config/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
    if (response.status === 401) {
      window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const result = await response.json();
    if (result.success) {
      messageDiv.innerHTML = '<span class="success-message">✓ Saved!</span>';
      setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    } else {
      messageDiv.innerHTML = `<span class="error-message">Error: ${result.error || 'Unknown error'}</span>`;
    }
  } catch (err) {
    messageDiv.innerHTML = `<span class="error-message">Error: ${err.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function setupRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  btn.addEventListener('click', () => {
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transform = ''; }, 500);
    loadAllData();
  });
}

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function startEventStream() {
  if (eventSource) eventSource.close();
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn(`Max SSE reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Falling back to polling.`);
    return;
  }
  eventSource = new EventSource(`${API_BASE}/events`);
  eventSource.onopen = () => { console.log('Connected to real-time updates'); reconnectAttempts = 0; };
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') return;
      if (data.type === 'status') updateStatusDisplay(data.data);
      else if (data.type === 'nowPlaying') updateNowPlayingDisplay(data.data);
    } catch (err) { console.error('Error parsing event data:', err); }
  };
  eventSource.onerror = (err) => {
    console.error('Event stream error:', err);
    reconnectAttempts++;
    const backoffTime = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
    setTimeout(() => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) startEventStream();
    }, backoffTime);
  };
  window.addEventListener('beforeunload', () => { if (eventSource) eventSource.close(); });
}

function updateStatusDisplay(status) {
  const statusGrid = document.getElementById('status-grid');
  if (!statusGrid) return;
  statusGrid.innerHTML = '';
  const integrations = [
    { key: 'slack', name: 'Slack', icon: '💬' },
    { key: 'discord', name: 'Discord', icon: '🎮' },
    { key: 'spotify', name: 'Spotify', icon: '🎵' },
    { key: 'sonos', name: 'Sonos', icon: '🔊' }
  ];
  integrations.forEach(integration => {
    const statusData = status[integration.key] || {};
    const isConnected = statusData.connected === true;
    const isConfigured = statusData.configured === true;
    const card = document.createElement('div');
    card.className = 'status-card';
    card.innerHTML = `
      <div class="status-icon">${integration.icon}</div>
      <div class="status-info">
        <div class="status-name">${integration.name}</div>
        <div class="status-status ${isConnected ? 'connected' : isConfigured ? 'error' : 'not-configured'}">
          ${isConnected ? 'Connected' : isConfigured ? 'Error' : 'Not Configured'}
        </div>
      </div>
    `;
    statusGrid.appendChild(card);
  });
}

function updateNowPlayingDisplay(data) {
  const nowPlayingDiv = document.getElementById('now-playing');
  if (!nowPlayingDiv) return;
  if (data.track) {
    nowPlayingDiv.innerHTML = `
      <div class="now-playing-track">
        <strong>${escapeHtml(data.track.title)}</strong>
        <span class="now-playing-artist">by ${escapeHtml(data.track.artist)}</span>
      </div>
      <div class="now-playing-state">
        <span class="state-badge ${data.state}">${data.state}</span>
        <span class="volume-info">Volume: ${data.volume}%</span>
      </div>
      ${data.nextTracks && data.nextTracks.length > 0 ? `
        <div class="up-next">
          <strong>Up Next:</strong>
          <ul>
            ${data.nextTracks.map(t => `<li><strong>${escapeHtml(t.title)}</strong> <span style="color: rgba(255,255,255,0.7);">— ${escapeHtml(t.artist)}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;
  } else {
    nowPlayingDiv.innerHTML = `
      <div class="now-playing-state">
        <span class="state-badge ${data.state}">${data.state}</span>
        <span class="volume-info">Volume: ${data.volume}%</span>
      </div>
      <p>No track currently playing</p>
    `;
  }
}

function startAutoRefresh(interval = 30000) {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => { loadAllData(); }, interval);
}

function setupConfigCollapse() {
  const toggle = document.getElementById('btn-toggle-config');
  const body = document.getElementById('config-body');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const isHidden = body.style.display === 'none' || body.style.display === '';
    body.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });
}

function setupSecurityCollapse() {
  const toggle = document.getElementById('btn-toggle-security');
  const body = document.getElementById('security-body');
  const toggleDiv = document.getElementById('security-toggle');
  if (!toggle || !body || !toggleDiv) return;
  
  // Make the entire header clickable
  toggleDiv.addEventListener('click', () => {
    const isHidden = body.style.display === 'none' || body.style.display === '';
    body.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });
  
  // Also make the button itself clickable
  toggle.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent double-trigger
    const isHidden = body.style.display === 'none' || body.style.display === '';
    body.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });
}

function stopAutoRefresh() { if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; } }

let logEventSource = null;
let logsVisible = false;

function setupLogViewer() {
  const toggleBtn = document.getElementById('btn-toggle-logs');
  const clearBtn = document.getElementById('btn-clear-logs');
  const logsContainer = document.getElementById('logs-container');
  const logsContent = document.getElementById('logs-content');
  const logLevelSelect = document.getElementById('log-level-select');
  
  if (!toggleBtn || !logsContainer) return;
  
  toggleBtn.addEventListener('click', () => {
    logsVisible = !logsVisible;
    logsContainer.style.display = logsVisible ? 'block' : 'none';
    toggleBtn.textContent = logsVisible ? 'Hide Logs' : 'Show Logs';
    if (logsVisible) startLogStream(); else stopLogStream();
  });
  
  if (clearBtn) clearBtn.addEventListener('click', () => { logsContent.innerHTML = ''; });
  
  // Handle log level change
  if (logLevelSelect) {
    logLevelSelect.addEventListener('change', async (e) => {
      const newLevel = e.target.value;
      const originalValue = logLevelSelect.value;
      try {
        const response = await fetch(`${API_BASE}/config/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'logLevel', value: newLevel })
        });
        if (response.status === 401) {
          window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
          return;
        }
        const result = await response.json();
        if (result.success) {
          // Show brief confirmation
          logLevelSelect.style.borderColor = '#4ade80';
          setTimeout(() => {
            logLevelSelect.style.borderColor = 'rgba(255,255,255,0.2)';
          }, 1000);
    } else {
          // Revert on error
          logLevelSelect.value = originalValue;
          alert(`Failed to update log level: ${result.error || 'Unknown error'}`);
    }
      } catch (err) {
        console.error('Error updating log level:', err);
        logLevelSelect.value = originalValue;
        alert(`Failed to update log level: ${err.message}`);
      }
    });
  }
}

async function loadLogLevel() {
  try {
    const response = await fetch(`${API_BASE}/config`);
      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
      }
    const config = await response.json();
    const logLevelSelect = document.getElementById('log-level-select');
    if (logLevelSelect && config.logLevel) {
      logLevelSelect.value = config.logLevel;
    }
  } catch (err) {
    console.error('Error loading log level:', err);
  }
}

function startLogStream() {
  // Close existing connection if any
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
  
  // Clear existing logs
      const logsContent = document.getElementById('logs-content');
  if (logsContent) {
      logsContent.innerHTML = '';
      }
  
  // Create EventSource - server will send buffer on connect, then stream new logs
  // Only create if we don't already have an active connection
  if (!logEventSource || logEventSource.readyState === EventSource.CLOSED) {
  logEventSource = new EventSource(`${API_BASE}/logs`);
    
    logEventSource.onopen = () => {
      // Connection opened - server will send buffer automatically
      console.log('Log stream connected');
    };
  
  logEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
        // Only process log entries, ignore 'connected' and heartbeat messages
      if (data.type === 'log') {
        addLogEntry(data);
      }
        // Ignore 'connected' type messages
    } catch (err) {
      console.error('Error parsing log event:', err);
    }
  };
  
  logEventSource.onerror = (err) => {
    console.error('Log stream error:', err);
      // Only reconnect if logs are still visible and connection is closed
      if (logsVisible && logEventSource && logEventSource.readyState === EventSource.CLOSED) {
    setTimeout(() => {
          if (logsVisible) {
        startLogStream();
      }
    }, 5000);
      }
  };
}
}

function stopLogStream() { if (logEventSource) { logEventSource.close(); logEventSource = null; } }

function addLogEntry(log) {
  const logsContent = document.getElementById('logs-content'); if (!logsContent) return;
  const entry = document.createElement('div'); entry.className = 'log-entry';
  const timestamp = new Date(log.timestamp).toLocaleTimeString(); const level = log.level || 'info';
  entry.innerHTML = `
    <span class="log-timestamp">${escapeHtml(timestamp)}</span>
    <span class="log-level ${level}">${escapeHtml(level.toUpperCase())}</span>
    <span class="log-message">${escapeHtml(log.message)}</span>
  `;
  logsContent.appendChild(entry);
  const logsContainer = document.getElementById('logs-container'); if (logsContainer) logsContainer.scrollTop = logsContainer.scrollHeight;
  while (logsContent.children.length > 1000) logsContent.removeChild(logsContent.firstChild);
  }

function setupLogout() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await response.json();
        if (data.success) window.location.href = '/login';
      } catch (err) { console.error('Logout error:', err); window.location.href = '/login'; }
    });
  }
}

function setupPasswordChange() {
  const btnChangePassword = document.getElementById('btn-change-password');
  const modal = document.getElementById('password-modal');
  const btnClose = document.getElementById('close-password-modal');
  const btnCancel = document.getElementById('cancel-password-change');
  const btnSave = document.getElementById('save-password-change');
  if (btnChangePassword) btnChangePassword.addEventListener('click', () => { if (modal) { modal.style.display = 'flex'; document.getElementById('current-password')?.focus(); } });
  const closeModal = () => { if (modal) { modal.style.display = 'none'; document.getElementById('current-password').value = ''; document.getElementById('new-password').value = ''; document.getElementById('confirm-new-password').value = ''; const messageDiv = document.getElementById('password-change-message'); if (messageDiv) { messageDiv.classList.remove('show', 'success', 'error'); messageDiv.textContent = ''; } } };
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const currentPassword = document.getElementById('current-password')?.value || '';
      const newPassword = document.getElementById('new-password')?.value || '';
      const confirmPassword = document.getElementById('confirm-new-password')?.value || '';
      const messageDiv = document.getElementById('password-change-message');
      if (!currentPassword || !newPassword || !confirmPassword) { showPasswordMessage(messageDiv, 'All fields are required', 'error'); return; }
      if (newPassword.length < 8) { showPasswordMessage(messageDiv, 'New password must be at least 8 characters', 'error'); return; }
      if (newPassword !== confirmPassword) { showPasswordMessage(messageDiv, 'New passwords do not match', 'error'); return; }
      btnSave.disabled = true; btnSave.textContent = 'Changing...';
      try {
        const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) });
        if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
        const data = await response.json();
        if (data.success) { showPasswordMessage(messageDiv, '✓ Password changed successfully!', 'success'); setTimeout(() => { closeModal(); }, 2000); } else { showPasswordMessage(messageDiv, data.error || 'Failed to change password', 'error'); btnSave.disabled = false; btnSave.textContent = 'Change Password'; }
      } catch (err) { showPasswordMessage(messageDiv, 'Connection error. Please try again.', 'error'); btnSave.disabled = false; btnSave.textContent = 'Change Password'; }
    });
  }
}

function showPasswordMessage(element, message, type) { if (!element) return; element.textContent = message; element.className = `validation-message ${type} show`; }

/* ------------------- WebAuthn integration using WebAuthnClient ------------------- */
async function setupWebAuthn() {
  // Elements
  const statusDiv = document.getElementById('webauthn-status-text');
  const enableBtn = document.getElementById('btn-enable-webauthn');
  const registerBtn = document.getElementById('btn-register-webauthn');
  const credentialsList = document.getElementById('webauthn-credentials-list');
  const messageDiv = document.getElementById('webauthn-message');

  // Simple shimbed logger (preserve existing endpoint behavior)
  const logClient = async (message, meta = {}) => {
    try {
      await fetch('/api/admin/webauthn-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, meta }) });
    } catch (e) { /* ignore */ }
  };

  // Ensure WebAuthnClient exists and initialize if needed
  // Wait a bit for scripts to load if WebAuthnClient isn't immediately available
  if (!window.WebAuthnClient) {
    // Wait for script to load (scripts load synchronously, but give it a moment)
    await new Promise(resolve => {
      if (window.WebAuthnClient) {
        resolve();
      return;
    }
      // Check every 50ms for up to 1 second
      let attempts = 0;
      const checkInterval = setInterval(() => {
        attempts++;
        if (window.WebAuthnClient || attempts >= 20) {
          clearInterval(checkInterval);
              resolve();
        }
      }, 50);
    });
  }
  
  if (window.WebAuthnClient) {
    WebAuthnClient.init({ apiBase: '/api/auth' });
  } else {
    console.error('WebAuthnClient failed to load. Please ensure webauthn-client.js is included in the page.');
    showWebAuthnMessage(messageDiv, 'WebAuthn client library failed to load. Please refresh the page.', 'error');
  }

  // Load status
  async function loadWebAuthnStatus() {
    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/status`);
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (statusDiv) {
        if (data.enabled) {
          statusDiv.textContent = 'Enabled'; statusDiv.style.color = '#4ade80'; if (enableBtn) enableBtn.style.display = 'none'; if (registerBtn) registerBtn.style.display = 'block'; const settingsDiv = document.getElementById('webauthn-settings'); if (settingsDiv) settingsDiv.style.display = 'block';
        } else {
          statusDiv.textContent = 'Disabled'; statusDiv.style.color = '#f87171'; if (enableBtn) enableBtn.style.display = 'block'; if (registerBtn) registerBtn.style.display = 'none'; const settingsDiv = document.getElementById('webauthn-settings'); if (settingsDiv) settingsDiv.style.display = 'none';
        }
      }
      if (data.enabled) {
        await loadWebAuthnCredentials();
        await loadWebAuthnUserVerificationSetting();
        await loadWebAuthnPlatformOnlySetting();
        await loadWebAuthnAdvancedSettings();
      } else { if (credentialsList) credentialsList.innerHTML = ''; }
    } catch (err) { console.error('Error loading WebAuthn status:', err); if (statusDiv) { statusDiv.textContent = 'Error'; statusDiv.style.color = '#f87171'; } }
  }

  async function loadWebAuthnUserVerificationSetting() {
    try {
      const response = await fetch(`${API_BASE}/config-values`);
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      const checkbox = document.getElementById('webauthn-require-uv');
      const statusSpan = document.getElementById('webauthn-uv-status');
      if (checkbox && statusSpan) {
        const requireUV = data.exists && data.values && data.values.webauthnRequireUserVerification === true;
        checkbox.checked = requireUV; statusSpan.textContent = requireUV ? 'Required' : 'Optional'; statusSpan.style.color = requireUV ? '#fbbf24' : '#4ade80';
      }
    } catch (err) { console.error('Error loading user verification setting:', err); const checkbox = document.getElementById('webauthn-require-uv'); const statusSpan = document.getElementById('webauthn-uv-status'); if (checkbox && statusSpan) { checkbox.checked = false; statusSpan.textContent = 'Optional'; statusSpan.style.color = '#4ade80'; } }
  }

  async function loadWebAuthnPlatformOnlySetting() {
    try {
      const response = await fetch(`${API_BASE}/config-values`);
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      const checkbox = document.getElementById('webauthn-prefer-platform-only');
      const statusSpan = document.getElementById('webauthn-platform-only-status');
      if (checkbox && statusSpan) {
        const preferPlatformOnly = data.exists && data.values && data.values.webauthnPreferPlatformOnly === true;
        checkbox.checked = preferPlatformOnly; statusSpan.textContent = preferPlatformOnly ? 'Platform Only' : 'Both Allowed'; statusSpan.style.color = preferPlatformOnly ? '#fbbf24' : '#4ade80';
      }
    } catch (err) { console.error('Error loading platform-only setting:', err); const checkbox = document.getElementById('webauthn-prefer-platform-only'); const statusSpan = document.getElementById('webauthn-platform-only-status'); if (checkbox && statusSpan) { checkbox.checked = false; statusSpan.textContent = 'Both Allowed'; statusSpan.style.color = '#4ade80'; } }
  }

  async function saveWebAuthnUserVerificationSetting(requireUV) {
    try {
      const response = await fetch(`${API_BASE}/config/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'webauthnRequireUserVerification', value: requireUV }) });
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (data.success) {
        const statusSpan = document.getElementById('webauthn-uv-status'); if (statusSpan) { statusSpan.textContent = requireUV ? 'Required' : 'Optional'; statusSpan.style.color = requireUV ? '#fbbf24' : '#4ade80'; }
        showWebAuthnMessage(messageDiv, `✓ Setting saved. ${requireUV ? 'PIN/biometric now required.' : 'Touch-only now allowed.'} Re-register keys if needed.`, 'success');
      } else throw new Error(data.error || 'Failed to save setting');
    } catch (err) { console.error('Error saving user verification setting:', err); showWebAuthnMessage(messageDiv, 'Failed to save setting: ' + err.message, 'error'); }
  }

  async function saveWebAuthnPlatformOnlySetting(preferPlatformOnly) {
    try {
      const response = await fetch(`${API_BASE}/config/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'webauthnPreferPlatformOnly', value: preferPlatformOnly }) });
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (data.success) {
        const statusSpan = document.getElementById('webauthn-platform-only-status'); if (statusSpan) { statusSpan.textContent = preferPlatformOnly ? 'Platform Only' : 'Both Allowed'; statusSpan.style.color = preferPlatformOnly ? '#fbbf24' : '#4ade80'; }
        showWebAuthnMessage(messageDiv, `✓ Setting saved. ${preferPlatformOnly ? 'Only Touch ID/Face ID allowed (reduces QR prompts).' : 'Both platform and cross-platform authenticators allowed.'} Re-register keys if needed.`, 'success');
      } else throw new Error(data.error || 'Failed to save setting');
    } catch (err) { console.error('Error saving platform-only setting:', err); showWebAuthnMessage(messageDiv, 'Failed to save setting: ' + err.message, 'error'); }
  }

  const uvCheckbox = document.getElementById('webauthn-require-uv'); if (uvCheckbox) uvCheckbox.addEventListener('change', () => { saveWebAuthnUserVerificationSetting(uvCheckbox.checked); });
  const platformOnlyCheckbox = document.getElementById('webauthn-prefer-platform-only'); if (platformOnlyCheckbox) platformOnlyCheckbox.addEventListener('change', () => { saveWebAuthnPlatformOnlySetting(platformOnlyCheckbox.checked); });

  async function loadWebAuthnAdvancedSettings() {
    try {
      const response = await fetch(`${API_BASE}/config-values`);
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (data.exists && data.values) {
        const timeoutInput = document.getElementById('webauthn-timeout'); if (timeoutInput) timeoutInput.value = data.values.webauthnTimeout || 60;
        const challengeExpInput = document.getElementById('webauthn-challenge-expiration'); if (challengeExpInput) challengeExpInput.value = data.values.webauthnChallengeExpiration || 60;
        const residentKeySelect = document.getElementById('webauthn-resident-key'); if (residentKeySelect) residentKeySelect.value = data.values.webauthnResidentKey || 'discouraged';
        const maxCredsInput = document.getElementById('webauthn-max-credentials'); if (maxCredsInput) maxCredsInput.value = data.values.webauthnMaxCredentials || 0;
      }
    } catch (err) { console.error('Error loading advanced WebAuthn settings:', err); }
  }

  async function saveWebAuthnAdvancedSettings() {
    const btn = document.getElementById('btn-save-webauthn-advanced'); if (!btn) return; btn.disabled = true; btn.textContent = 'Saving...';
    try {
      const timeout = parseInt(document.getElementById('webauthn-timeout')?.value || '60', 10);
      const challengeExpiration = parseInt(document.getElementById('webauthn-challenge-expiration')?.value || '60', 10);
      const residentKey = document.getElementById('webauthn-resident-key')?.value || 'discouraged';
      const maxCredentials = parseInt(document.getElementById('webauthn-max-credentials')?.value || '0', 10);
      if (timeout < 10 || timeout > 300) throw new Error('Timeout must be between 10 and 300 seconds');
      if (challengeExpiration < 30 || challengeExpiration > 300) throw new Error('Challenge expiration must be between 30 and 300 seconds');
      if (maxCredentials < 0 || maxCredentials > 50) throw new Error('Max credentials must be between 0 and 50');
      const settings = [
        { key: 'webauthnTimeout', value: timeout },
        { key: 'webauthnChallengeExpiration', value: challengeExpiration },
        { key: 'webauthnResidentKey', value: residentKey },
        { key: 'webauthnMaxCredentials', value: maxCredentials }
      ];
      const results = [];
      for (const setting of settings) {
        try {
          const response = await fetch(`${API_BASE}/config/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setting) });
          if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
          const contentType = response.headers.get('content-type'); if (!contentType || !contentType.includes('application/json')) { const text = await response.text(); throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`); }
          const data = await response.json(); results.push({ key: setting.key, success: data.success, error: data.error });
        } catch (err) { console.error(`Error saving ${setting.key}:`, err); results.push({ key: setting.key, success: false, error: err.message }); }
      }
      const allSuccess = results.every(r => r.success);
      if (allSuccess) showWebAuthnMessage(messageDiv, '✓ Advanced settings saved successfully!', 'success');
      else { const errors = results.filter(r => !r.success).map(r => `${r.key}: ${r.error || 'Unknown error'}`).join(', '); throw new Error(`Failed to save some settings: ${errors}`); }
    } catch (err) { console.error('Error saving advanced WebAuthn settings:', err); showWebAuthnMessage(messageDiv, 'Failed to save settings: ' + err.message, 'error'); }
    finally { const btn2 = document.getElementById('btn-save-webauthn-advanced'); if (btn2) { btn2.disabled = false; btn2.textContent = 'Save Advanced Settings'; } }
  }

  const saveAdvancedBtn = document.getElementById('btn-save-webauthn-advanced'); if (saveAdvancedBtn) saveAdvancedBtn.addEventListener('click', saveWebAuthnAdvancedSettings);

  async function loadWebAuthnCredentials() {
    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/credentials`);
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (credentialsList && data.credentials) {
        if (data.credentials.length === 0) {
          credentialsList.innerHTML = '<p style="color: rgba(255,255,255,0.6);">No security keys registered. Click "Register New Security Key" to add one.</p>';
        } else {
          credentialsList.innerHTML = data.credentials.map((cred, index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; margin-bottom: 0.5rem; background: rgba(255,255,255,0.03); border-radius: 6px;">
              <div>
                <strong>${cred.deviceName || `Security Key ${index + 1}`}</strong>
                <div style="font-size: 0.85rem; color: rgba(255,255,255,0.6); margin-top: 0.25rem;">
                  Registered: ${new Date(cred.registeredAt).toLocaleDateString()}
                </div>
              </div>
              <button class="btn btn-secondary" onclick="deleteWebAuthnCredential('${cred.credentialID}')" style="padding: 0.5rem 1rem; font-size: 0.85rem;">Delete</button>
            </div>
          `).join('');
        }
      }
    } catch (err) { console.error('Error loading WebAuthn credentials:', err); }
  }

  enableBtn?.addEventListener('click', async () => {
    try {
      const response = await fetch(`${API_BASE}/config/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'webauthnEnabled', value: true }) });
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (data.success) { await loadWebAuthnStatus(); showWebAuthnMessage(messageDiv, 'WebAuthn enabled. You can now register security keys.', 'success'); }
      else showWebAuthnMessage(messageDiv, data.error || 'Failed to enable WebAuthn', 'error');
    } catch (err) { showWebAuthnMessage(messageDiv, 'Error enabling WebAuthn: ' + err.message, 'error'); }
  });

  // REPLACED: registration flow now uses WebAuthnClient to avoid manual conversions and duplicated logic
  registerBtn?.addEventListener('click', async () => {
    try {
      registerBtn.disabled = true;
      registerBtn.textContent = 'Registering...';
      showWebAuthnMessage(messageDiv, 'Preparing registration...', 'info');

      // Ensure WebAuthnClient is available
      if (!window.WebAuthnClient) {
        // Try to wait a bit more in case it's still loading
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!window.WebAuthnClient) {
          throw new Error('WebAuthnClient missing. Please ensure webauthn-client.js is loaded. Refresh the page and try again.');
        }
      }

      showWebAuthnMessage(messageDiv, 'Touch your security key…', 'info');
      const result = await WebAuthnClient.register({ promptDeviceName: true });

        showWebAuthnMessage(messageDiv, '✓ Security key registered successfully!', 'success');
        await loadWebAuthnCredentials();
        await loadWebAuthnStatus();
    } catch (err) {
      console.error('[WebAuthn] registration error', err);
      // Safely extract error message - be very defensive
      let errorMsg = 'Unknown error';
      try {
        if (err && typeof err === 'object') {
          if ('message' in err && typeof err.message === 'string') {
            errorMsg = err.message;
          } else if ('message' in err) {
            errorMsg = String(err.message);
          } else {
            errorMsg = String(err);
          }
        } else if (err) {
          errorMsg = String(err);
        }
      } catch (e) {
        // If even extracting the error message fails, use a fallback
        errorMsg = 'Error occurred (details unavailable)';
        console.error('[WebAuthn] Failed to extract error message', e, { originalError: err });
      }
      
      // Log full error details to console for debugging
      console.error('[WebAuthn] Full error details:', {
        error: err,
        errorType: typeof err,
        errorMessage: errorMsg,
        errorStack: err && typeof err === 'object' && 'stack' in err ? err.stack : 'no stack'
      });
      
      logClient('registration-error', { 
        error: errorMsg,
        errorType: typeof err,
        hasMessage: err && typeof err === 'object' && 'message' in err
      }).catch(() => {});
      showWebAuthnMessage(messageDiv, 'Registration error: ' + errorMsg, 'error');
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Register New Security Key';
    }
  });

  window.deleteWebAuthnCredential = async (credentialID) => {
    if (!confirm('Are you sure you want to delete this security key?')) return;
    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/credentials?credentialID=${encodeURIComponent(credentialID)}`, { method: 'DELETE' });
      if (response.status === 401) { window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname); return; }
      const data = await response.json();
      if (data.success) { showWebAuthnMessage(messageDiv, 'Security key deleted successfully', 'success'); await loadWebAuthnCredentials(); }
      else showWebAuthnMessage(messageDiv, data.error || 'Failed to delete security key', 'error');
    } catch (err) { showWebAuthnMessage(messageDiv, 'Error deleting security key: ' + err.message, 'error'); }
  };

  function showWebAuthnMessage(element, message, type) {
    if (!element) return; element.textContent = message; element.className = `validation-message ${type} show`; if (type === 'success') setTimeout(() => { element.classList.remove('show'); }, 3000);
    }

  await loadWebAuthnStatus();
}

async function handleApiError(response, error) {
  if (response && response.status === 401) {
    window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
    return true;
  }
  return false;
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
