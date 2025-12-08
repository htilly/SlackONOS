const API_BASE = '/api/admin';

// Auto-refresh interval (30 seconds)
let refreshInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupLogout();
  setupPasswordChange();
  setupWebAuthn();
  loadAllData();
  setupRefreshButton();
  setupLogViewer();
  startAutoRefresh();
});

/**
 * Load all data (status, now playing, config)
 */
async function loadAllData() {
  await Promise.all([
    loadStatus(),
    loadNowPlaying(),
    loadConfig()
  ]);
}

/**
 * Load integration status
 */
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
    
    // Create status cards for each integration
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

/**
 * Create a status card for an integration
 */
function createStatusCard(integration, status) {
  const card = document.createElement('div');
  card.className = 'status-card';
  
  let statusHTML = `<h3>${integration.icon} ${integration.name}</h3>`;
  
  if (!status.configured) {
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
  }
  
  card.innerHTML = statusHTML;
  return card;
}

/**
 * Load now playing information
 */
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
    
    content.innerHTML = html;
  } catch (err) {
    console.error('Error loading now playing:', err);
    document.getElementById('now-playing-content').innerHTML = 
      '<p class="error-message">Error loading: ' + err.message + '</p>';
  }
}

/**
 * Load configuration
 */
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
    
    // Define config items that can be edited
    const editableConfig = [
      { key: 'adminChannel', label: 'Admin Channel', type: 'text' },
      { key: 'standardChannel', label: 'Standard Channel', type: 'text' },
      { key: 'maxVolume', label: 'Max Volume', type: 'number', min: 1, max: 100 },
      { key: 'market', label: 'Market', type: 'select', options: ['US', 'EU', 'SE', 'NO', 'DK', 'FI'] },
      { key: 'gongLimit', label: 'Gong Limit', type: 'number', min: 1 },
      { key: 'voteLimit', label: 'Vote Limit', type: 'number', min: 1 },
      { key: 'voteImmuneLimit', label: 'Vote Immune Limit', type: 'number', min: 1 },
      { key: 'flushVoteLimit', label: 'Flush Vote Limit', type: 'number', min: 1 },
      { key: 'ttsEnabled', label: 'TTS Enabled', type: 'select', options: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] },
      { key: 'logLevel', label: 'Log Level', type: 'select', options: ['debug', 'info', 'warn', 'error'] }
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

/**
 * Create a config item input
 */
function createConfigItem(item, value) {
  const div = document.createElement('div');
  div.className = 'config-item';
  div.dataset.key = item.key;
  
  let inputHTML = '';
  
  if (item.type === 'select') {
    inputHTML = `<select id="config-${item.key}">`;
    if (Array.isArray(item.options) && item.options[0] && typeof item.options[0] === 'object') {
      // Options with value/label objects
      item.options.forEach(opt => {
        inputHTML += `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`;
      });
    } else {
      // Simple string options
      item.options.forEach(opt => {
        inputHTML += `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`;
      });
    }
    inputHTML += '</select>';
  } else {
    const inputType = item.type === 'number' ? 'number' : 'text';
    const attrs = [];
    if (item.min !== undefined) attrs.push(`min="${item.min}"`);
    if (item.max !== undefined) attrs.push(`max="${item.max}"`);
    inputHTML = `<input type="${inputType}" id="config-${item.key}" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
  }
  
  div.innerHTML = `
    <label for="config-${item.key}">${item.label}:</label>
    ${inputHTML}
    <button class="btn-save" onclick="saveConfig('${item.key}')">Save</button>
    <div id="config-${item.key}-message"></div>
  `;
  
  return div;
}

/**
 * Save a config value
 */
async function saveConfig(key) {
  const input = document.getElementById(`config-${key}`);
  const messageDiv = document.getElementById(`config-${key}-message`);
  const btn = input.parentElement.querySelector('.btn-save');
  
  if (!input) return;
  
  let value = input.value;
  
  // Convert to appropriate type
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
  }
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  messageDiv.innerHTML = '';
  
  try {
    const response = await fetch(`${API_BASE}/config/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key, value })
    });
    
    if (response.status === 401) {
      window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      messageDiv.innerHTML = '<span class="success-message">✓ Saved!</span>';
      setTimeout(() => {
        messageDiv.innerHTML = '';
      }, 3000);
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

/**
 * Setup refresh button
 */
function setupRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  btn.addEventListener('click', () => {
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => {
      btn.style.transform = '';
    }, 500);
    loadAllData();
  });
}

/**
 * Start auto-refresh
 */
function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    loadAllData();
  }, 30000); // Refresh every 30 seconds
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/**
 * Setup log viewer
 */
let logEventSource = null;
let logsVisible = false;

function setupLogViewer() {
  const toggleBtn = document.getElementById('btn-toggle-logs');
  const clearBtn = document.getElementById('btn-clear-logs');
  const logsContainer = document.getElementById('logs-container');
  const logsContent = document.getElementById('logs-content');
  
  if (!toggleBtn || !logsContainer) return;
  
  // Toggle logs visibility
  toggleBtn.addEventListener('click', () => {
    logsVisible = !logsVisible;
    logsContainer.style.display = logsVisible ? 'block' : 'none';
    toggleBtn.textContent = logsVisible ? 'Hide Logs' : 'Show Logs';
    
    if (logsVisible) {
      startLogStream();
    } else {
      stopLogStream();
    }
  });
  
  // Clear logs
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      logsContent.innerHTML = '';
    });
  }
}

/**
 * Start log stream via Server-Sent Events
 */
function startLogStream() {
  // Load existing logs first
  fetch(`${API_BASE}/logs/buffer`)
    .then(response => {
      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return null;
      }
      return response.json();
    })
    .then(data => {
      const logsContent = document.getElementById('logs-content');
      logsContent.innerHTML = '';
      if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
          addLogEntry(log);
        });
      }
    })
    .catch(err => {
      console.error('Error loading log buffer:', err);
    });
  
  // Start SSE stream
  logEventSource = new EventSource(`${API_BASE}/logs`);
  
  logEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        addLogEntry(data);
      }
    } catch (err) {
      console.error('Error parsing log event:', err);
    }
  };
  
  logEventSource.onerror = (err) => {
    console.error('Log stream error:', err);
    // Try to reconnect after a delay
    setTimeout(() => {
      if (logsVisible && !logEventSource || logEventSource.readyState === EventSource.CLOSED) {
        startLogStream();
      }
    }, 5000);
  };
}

/**
 * Stop log stream
 */
function stopLogStream() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
}

/**
 * Add a log entry to the viewer
 */
function addLogEntry(log) {
  const logsContent = document.getElementById('logs-content');
  if (!logsContent) return;
  
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  const timestamp = new Date(log.timestamp).toLocaleTimeString();
  const level = log.level || 'info';
  
  entry.innerHTML = `
    <span class="log-timestamp">${escapeHtml(timestamp)}</span>
    <span class="log-level ${level}">${escapeHtml(level.toUpperCase())}</span>
    <span class="log-message">${escapeHtml(log.message)}</span>
  `;
  
  logsContent.appendChild(entry);
  
  // Auto-scroll to bottom
  const logsContainer = document.getElementById('logs-container');
  if (logsContainer) {
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
  
  // Limit to last 1000 entries
  while (logsContent.children.length > 1000) {
    logsContent.removeChild(logsContent.firstChild);
  }
}

/**
 * Setup logout button
 */
function setupLogout() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
          window.location.href = '/login';
        }
      } catch (err) {
        console.error('Logout error:', err);
        // Redirect anyway
        window.location.href = '/login';
      }
    });
  }
}

/**
 * Setup password change modal
 */
function setupPasswordChange() {
  const btnChangePassword = document.getElementById('btn-change-password');
  const modal = document.getElementById('password-modal');
  const btnClose = document.getElementById('close-password-modal');
  const btnCancel = document.getElementById('cancel-password-change');
  const btnSave = document.getElementById('save-password-change');
  
  // Open modal
  if (btnChangePassword) {
    btnChangePassword.addEventListener('click', () => {
      if (modal) {
        modal.style.display = 'flex';
        document.getElementById('current-password')?.focus();
      }
    });
  }
  
  // Close modal
  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
      // Clear form
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
      const messageDiv = document.getElementById('password-change-message');
      if (messageDiv) {
        messageDiv.classList.remove('show', 'success', 'error');
        messageDiv.textContent = '';
      }
    }
  };
  
  if (btnClose) {
    btnClose.addEventListener('click', closeModal);
  }
  
  if (btnCancel) {
    btnCancel.addEventListener('click', closeModal);
  }
  
  // Close on background click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }
  
  // Save password change
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const currentPassword = document.getElementById('current-password')?.value || '';
      const newPassword = document.getElementById('new-password')?.value || '';
      const confirmPassword = document.getElementById('confirm-new-password')?.value || '';
      const messageDiv = document.getElementById('password-change-message');
      
      // Validation
      if (!currentPassword || !newPassword || !confirmPassword) {
        showPasswordMessage(messageDiv, 'All fields are required', 'error');
        return;
      }
      
      if (newPassword.length < 8) {
        showPasswordMessage(messageDiv, 'New password must be at least 8 characters', 'error');
        return;
      }
      
      if (newPassword !== confirmPassword) {
        showPasswordMessage(messageDiv, 'New passwords do not match', 'error');
        return;
      }
      
      // Disable button during request
      btnSave.disabled = true;
      btnSave.textContent = 'Changing...';
      
      try {
        const response = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword
          })
        });
        
        if (response.status === 401) {
          window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
          return;
        }
        
        const data = await response.json();
        
        if (data.success) {
          showPasswordMessage(messageDiv, '✓ Password changed successfully!', 'success');
          // Close modal after 2 seconds
          setTimeout(() => {
            closeModal();
          }, 2000);
        } else {
          showPasswordMessage(messageDiv, data.error || 'Failed to change password', 'error');
          btnSave.disabled = false;
          btnSave.textContent = 'Change Password';
        }
      } catch (err) {
        showPasswordMessage(messageDiv, 'Connection error. Please try again.', 'error');
        btnSave.disabled = false;
        btnSave.textContent = 'Change Password';
      }
    });
  }
}

/**
 * Show message in password change modal
 */
function showPasswordMessage(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = `validation-message ${type} show`;
}

/**
 * Setup WebAuthn functionality
 */
async function setupWebAuthn() {
  const statusDiv = document.getElementById('webauthn-status-text');
  const enableBtn = document.getElementById('btn-enable-webauthn');
  const registerBtn = document.getElementById('btn-register-webauthn');
  const credentialsList = document.getElementById('webauthn-credentials-list');
  const messageDiv = document.getElementById('webauthn-message');

  // Try to load the WebAuthn library once on init to surface errors early
  try {
    await ensureWebAuthnLib();
  } catch (err) {
    console.error('[WebAuthn] initial load failed:', err);
    showWebAuthnMessage(messageDiv, 'WebAuthn library failed to load. Please check network/CSP and refresh.', 'error');
  }

  /**
   * Ensure WebAuthn browser library is loaded
   */
  async function ensureWebAuthnLib() {
    console.log('[WebAuthn] ensureWebAuthnLib: checking availability');
    // Already available
    if (typeof window.SimpleWebAuthnBrowser !== 'undefined') {
      console.log('[WebAuthn] library already on window');
      return;
    }
    // Global variable (non-window) available
    if (typeof SimpleWebAuthnBrowser !== 'undefined') {
      window.SimpleWebAuthnBrowser = SimpleWebAuthnBrowser;
      console.log('[WebAuthn] library found as global, assigned to window');
      return;
    }

    // Dynamically load the library from CDN as a fallback (retry once)
    console.log('[WebAuthn] loading library from CDN...');
    const cdnUrls = [
      'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@9.0.0/dist/bundle/index.umd.min.js',
      'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@9.0.0/dist/bundle/index.umd.min.js?v=2'
    ];

    let lastError;
    for (const url of cdnUrls) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.async = true;
          script.onload = () => {
            if (typeof window.SimpleWebAuthnBrowser === 'undefined' && typeof SimpleWebAuthnBrowser !== 'undefined') {
              window.SimpleWebAuthnBrowser = SimpleWebAuthnBrowser;
            }
            if (typeof window.SimpleWebAuthnBrowser !== 'undefined') {
              console.log('[WebAuthn] library loaded from CDN url:', url);
              resolve();
            } else {
              reject(new Error('WebAuthn library failed to load after onload'));
            }
          };
          script.onerror = (e) => {
            reject(new Error(`Failed to load WebAuthn library (${url})`));
          };
          document.head.appendChild(script);
        });
        // success, break loop
        return;
      } catch (err) {
        lastError = err;
        console.error('[WebAuthn] load attempt failed:', err);
      }
    }

    throw lastError || new Error('WebAuthn library failed to load');
  }

  // Load WebAuthn status
  async function loadWebAuthnStatus() {
    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/status`);
      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await response.json();
      
      if (statusDiv) {
        if (data.enabled) {
          statusDiv.textContent = 'Enabled';
          statusDiv.style.color = '#4ade80';
          if (enableBtn) enableBtn.style.display = 'none';
          if (registerBtn) registerBtn.style.display = 'block';
        } else {
          statusDiv.textContent = 'Disabled';
          statusDiv.style.color = '#f87171';
          if (enableBtn) enableBtn.style.display = 'block';
          if (registerBtn) registerBtn.style.display = 'none';
        }
      }

      // Load credentials if enabled
      if (data.enabled) {
        await loadWebAuthnCredentials();
      } else {
        if (credentialsList) credentialsList.innerHTML = '';
      }
    } catch (err) {
      console.error('Error loading WebAuthn status:', err);
      if (statusDiv) {
        statusDiv.textContent = 'Error';
        statusDiv.style.color = '#f87171';
      }
    }
  }

  // Load WebAuthn credentials
  async function loadWebAuthnCredentials() {
    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/credentials`);
      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }
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
    } catch (err) {
      console.error('Error loading WebAuthn credentials:', err);
    }
  }

  // Enable WebAuthn
  enableBtn?.addEventListener('click', async () => {
    try {
      // Update config to enable WebAuthn
      const response = await fetch(`${API_BASE}/config/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'webauthnEnabled', value: true })
      });
      
      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }
      
      const data = await response.json();
      if (data.success) {
        await loadWebAuthnStatus();
        showWebAuthnMessage(messageDiv, 'WebAuthn enabled. You can now register security keys.', 'success');
      } else {
        showWebAuthnMessage(messageDiv, data.error || 'Failed to enable WebAuthn', 'error');
      }
    } catch (err) {
      showWebAuthnMessage(messageDiv, 'Error enabling WebAuthn: ' + err.message, 'error');
    }
  });

  // Register new WebAuthn credential
  registerBtn?.addEventListener('click', async () => {
    try {
      registerBtn.disabled = true;
      registerBtn.textContent = 'Preparing...';
      showWebAuthnMessage(messageDiv, 'Preparing registration...', 'info');

      // Get registration options
      const optionsResponse = await fetch(`${API_BASE}/../auth/webauthn/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (optionsResponse.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }

      if (!optionsResponse.ok) {
        throw new Error('Failed to get registration options');
      }

      const options = await optionsResponse.json();
      showWebAuthnMessage(messageDiv, 'Touch your security key and enter PIN...', 'info');

      // Ensure library is loaded
      await ensureWebAuthnLib();

      // Start WebAuthn registration
      const registrationResponse = await window.SimpleWebAuthnBrowser.startRegistration(options);

      // Get device name (optional)
      const deviceName = prompt('Enter a name for this security key (optional):') || 'Security Key';

      // Verify registration
      const verifyResponse = await fetch(`${API_BASE}/../auth/webauthn/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...registrationResponse, deviceName })
      });

      if (verifyResponse.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }

      const verifyData = await verifyResponse.json();

      if (verifyData.verified) {
        showWebAuthnMessage(messageDiv, '✓ Security key registered successfully!', 'success');
        await loadWebAuthnCredentials();
        await loadWebAuthnStatus();
      } else {
        showWebAuthnMessage(messageDiv, 'Registration failed. Please try again.', 'error');
      }
    } catch (err) {
      console.error('[WebAuthn] registration error', err);
      showWebAuthnMessage(messageDiv, 'Registration error: ' + err.message, 'error');
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = 'Register New Security Key';
    }
  });

  // Delete credential
  window.deleteWebAuthnCredential = async (credentialID) => {
    if (!confirm('Are you sure you want to delete this security key?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/../auth/webauthn/credentials?credentialID=${encodeURIComponent(credentialID)}`, {
        method: 'DELETE'
      });

      if (response.status === 401) {
        window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
        return;
      }

      const data = await response.json();
      if (data.success) {
        showWebAuthnMessage(messageDiv, 'Security key deleted successfully', 'success');
        await loadWebAuthnCredentials();
      } else {
        showWebAuthnMessage(messageDiv, data.error || 'Failed to delete security key', 'error');
      }
    } catch (err) {
      showWebAuthnMessage(messageDiv, 'Error deleting security key: ' + err.message, 'error');
    }
  };

  // Show message helper
  function showWebAuthnMessage(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = `validation-message ${type} show`;
    if (type === 'success') {
      setTimeout(() => {
        element.classList.remove('show');
      }, 3000);
    }
  }

  // Initial load
  await loadWebAuthnStatus();
}

/**
 * Handle API errors - check for authentication failures
 */
async function handleApiError(response, error) {
  if (response && response.status === 401) {
    // Session expired or unauthorized
    window.location.href = '/login?return=' + encodeURIComponent(window.location.pathname);
    return true;
  }
  return false;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

