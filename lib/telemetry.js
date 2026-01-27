'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PostHog } = require('posthog-node');

/**
 * Simple telemetry module using PostHog (privacy-focused, backend analytics)
 */

class Telemetry {
  constructor(config) {
    // Store the config object for runtime lookups
    this.config = config;
    this.enabled = config.telemetryEnabled !== false; // Enabled by default
    this.apiKey = config.telemetryApiKey || 'phc_dkh7jm9oxMh7lLKr8TRBY0eKQ5Jn708pXk9McRC0qlO';
    this.logger = config.logger;
    
    // Initialize PostHog client
    this.client = new PostHog(this.apiKey, {
      host: 'https://us.i.posthog.com',
      disableGeoip: false,
    });
    
    // Generate or retrieve a stable persistent instance ID
    this.instanceId = this._getOrCreateInstanceId();
    
    // Track startup time for uptime calculations
    this.startTime = Date.now();
    
    // Heartbeat interval (default: 24 hours)
    this.heartbeatInterval = null;
  }

  /**
   * Get or create a persistent anonymous instance ID
   * Stored in config/config.json as 'telemetryInstanceId'
   * This allows tracking unique instances without PII, persisted across restarts
   */
  _getOrCreateInstanceId() {
    const configPath = path.join(process.cwd(), 'config', 'config.json');
    
    try {
      // Read existing config
      const configData = fs.readFileSync(configPath, 'utf8');
      const configJson = JSON.parse(configData);
      
      // Check if instance ID already exists
      if (configJson.telemetryInstanceId) {
        if (this.logger) {
          this.logger.info(`📊 Using existing telemetry instance ID: ${configJson.telemetryInstanceId.substring(0, 8)}...`);
        }
        return configJson.telemetryInstanceId;
      }
      
      // Generate new instance ID
      const newId = crypto.randomUUID();
      configJson.telemetryInstanceId = newId;
      
      // Write back to config file
      fs.writeFileSync(configPath, JSON.stringify(configJson, null, 4), 'utf8');
      
      if (this.logger) {
        this.logger.info(`📊 Generated new telemetry instance ID: ${newId.substring(0, 8)}...`);
      }
      
      return newId;
    } catch (err) {
      // Fallback to hostname-based ID if config file can't be read/written
      if (this.logger) {
        this.logger.warn(`📊 Could not persist instance ID to config: ${err.message}. Using hostname-based ID.`);
      }
      const hostname = os.hostname();
      return crypto.createHash('sha256').update(hostname).digest('hex').substring(0, 16);
    }
  }

  /**
   * Calculate uptime in hours and days
   * @returns {object} { hours, days }
   */
  _getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    return { hours, days };
  }

  /**
   * Send a telemetry event
   * @param {string} name - Event name (e.g., 'startup', 'command')
   * @param {object} props - Additional properties
   */
  async sendEvent(name, props = {}) {
    // Check runtime config for telemetryEnabled
    const runtimeEnabled = this.config.get ? this.config.get('telemetryEnabled') : this.enabled;
    
    if (runtimeEnabled === false) {
      if (this.logger) {
        this.logger.info(`📊 Telemetry disabled, skipping event: ${name}`);
      }
      return;
    }

    if (this.logger) {
      this.logger.info(`📊 Sending telemetry event: ${name}`);
    }

    try {
      // Capture event using PostHog SDK
      this.client.capture({
        distinctId: this.instanceId,
        event: name,
        properties: {
          instance_id: this.instanceId,
          os_platform: os.platform(),
          os_release: os.release(),
          node_version: process.version,
          ...props
        }
      });

      if (this.logger) {
        this.logger.info(`✓ Telemetry sent: ${name}`);
      }
    } catch (err) {
      // Fail silently
      if (this.logger) {
        this.logger.debug(`Telemetry exception: ${err.message}`);
      }
    }
  }

  /**
   * Send startup event
   */
  async trackStartup(appVersion, releaseVersion) {
    await this.sendEvent('startup', {
      app_version: appVersion,
      release: releaseVersion
    });
  }

  /**
   * Send heartbeat event with uptime
   */
  async trackHeartbeat(appVersion, releaseVersion) {
    const uptime = this._getUptime();
    await this.sendEvent('heartbeat', {
      app_version: appVersion,
      release: releaseVersion,
      uptime_hours: uptime.hours,
      uptime_days: uptime.days
    });
  }

  /**
   * Send shutdown event with total runtime
   */
  async trackShutdown(appVersion, releaseVersion) {
    const uptime = this._getUptime();
    await this.sendEvent('shutdown', {
      app_version: appVersion,
      release: releaseVersion,
      total_runtime_hours: uptime.hours,
      total_runtime_days: uptime.days
    });
  }

  /**
   * Start heartbeat interval (24 hours)
   */
  startHeartbeat(appVersion, releaseVersion) {
    // Check runtime config for telemetryEnabled
    const runtimeEnabled = this.config.get ? this.config.get('telemetryEnabled') : this.enabled;
    
    if (runtimeEnabled === false) {
      if (this.logger) {
        this.logger.info('📊 Telemetry disabled, not starting heartbeat');
      }
      return;
    }

    // Clear existing interval if any
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send heartbeat every 24 hours
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.heartbeatInterval = setInterval(() => {
      this.trackHeartbeat(appVersion, releaseVersion);
    }, TWENTY_FOUR_HOURS);

    if (this.logger) {
      this.logger.info('📊 Telemetry heartbeat started (24-hour interval)');
    }
  }

  /**
   * Stop heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Shutdown telemetry and flush pending events
   */
  async shutdown() {
    this.stopHeartbeat();
    await this.client.shutdown();
  }

  /**
   * Send command usage event
   */
  async trackCommand(commandName) {
    await this.sendEvent('command', {
      command: commandName
    });
  }
}

module.exports = Telemetry;
