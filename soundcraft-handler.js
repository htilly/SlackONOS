const { SoundcraftUI } = require('soundcraft-ui-connection');

class SoundcraftHandler {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.connection = null;
        this.connected = false;
        this.reconnectTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
    }

    /**
     * Convert dB value to fader level (0-1)
     * Uses the fader curve from the Soundcraft library
     * @param {number} db - dB value (-100 to 0)
     * @returns {number} Fader level (0 to 1)
     */
    dbToFaderLevel(db) {
        // Clamp to valid range
        db = Math.max(-100, Math.min(0, db));
        
        // Simple linear conversion for now
        // -100 dB = 0, 0 dB = 1
        return (db + 100) / 100;
    }

    /**
     * Initialize connection to Soundcraft Ui24R mixer
     */
    async connect() {
        if (!this.config.soundcraftEnabled) {
            this.logger.info('Soundcraft integration disabled in config');
            return false;
        }

        if (!this.config.soundcraftIp) {
            this.logger.error('Soundcraft IP address not configured');
            return false;
        }

        const channels = this.getChannelNames();
        if (channels.length === 0) {
            this.logger.error('No Soundcraft channels configured');
            return false;
        }

        try {
            this.logger.info(`Connecting to Soundcraft Ui24R at ${this.config.soundcraftIp}...`);

            this.connection = new SoundcraftUI(this.config.soundcraftIp);
            this.connection.connect();

            // Wait a moment for initial connection
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Mark as connected (optimistic - we'll find out if commands fail)
            this.connected = true;
            this.reconnectAttempts = 0;
            this.logger.info('✅ Successfully connected to Soundcraft Ui24R');
            this.logger.info(`   Configured channels: ${channels.join(', ')}`);

            return true;
        } catch (error) {
            this.logger.error(`Failed to connect to Soundcraft: ${error.message}`);
            this.logger.warn(`⚠️  Make sure the bot container can reach ${this.config.soundcraftIp} on the network`);
            this.scheduleReconnect();
            return false;
        }
    }

    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            return;
        }

        if (this.reconnectTimeout) {
            return; // Already scheduled
        }

        this.reconnectAttempts++;
        this.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay / 1000}s...`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, this.reconnectDelay);
    }

    /**
     * Disconnect from Soundcraft mixer
     */
    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.connection) {
            try {
                this.connection.disconnect();
                this.logger.info('Disconnected from Soundcraft Ui24R');
            } catch (error) {
                this.logger.error(`Error disconnecting from Soundcraft: ${error.message}`);
            }
            this.connection = null;
        }
        this.connected = false;
    }

    /**
     * Resolve the internal mixer bus ID from a channel name
     * @param {string} channelName 
     * @returns {string|null} Internal bus ID (e.g., 'master', 'aux1', 'fx1') or null
     */
    _resolveBusId(channelName) {
        const configChannels = this.config.soundcraftChannels;

        // Handle Object mapping (New style)
        if (!Array.isArray(configChannels) && typeof configChannels === 'object') {
            return configChannels[channelName] || null;
        }

        // Handle Array mapping (Legacy style)
        // If it's a direct match (e.g. "master"), use it
        // If it's a custom name in the array, map by index to AUX
        if (Array.isArray(configChannels)) {
            const lowerName = channelName.toLowerCase();

            // Check if it's a standard name
            if (lowerName === 'master' || lowerName.startsWith('aux') || lowerName.startsWith('fx')) {
                return lowerName;
            }

            // Map by index
            const index = configChannels.indexOf(channelName);
            if (index === 0) return 'master'; // First item is master
            if (index > 0) return `aux${index}`; // Subsequent items are AUX 1, 2, etc.
        }

        return null;
    }

    /**
     * Set volume for a specific channel
     * @param {string} channelName - Name of the channel (e.g., 'master', 'receptionen')
     * @param {number} volume - Volume level in dB (-100 to 0)
     * @returns {Promise<boolean>} Success status
     */
    async setVolume(channelName, volume) {
        if (!this.connected || !this.connection) {
            this.logger.error('Not connected to Soundcraft mixer');
            return false;
        }

        const availableChannels = this.getChannelNames();
        if (!availableChannels.includes(channelName)) {
            this.logger.error(`Invalid channel name: ${channelName}. Available channels: ${availableChannels.join(', ')}`);
            return false;
        }

        // Validate volume range (dB)
        if (volume < -100 || volume > 0) {
            this.logger.error(`Invalid volume: ${volume} dB. Must be between -100 and 0`);
            return false;
        }

        try {
            // Resolve the actual bus ID
            let busId = this._resolveBusId(channelName);

            if (!busId) {
                // Fallback: if the name itself is a valid bus ID (like 'master' or 'aux1'), try using it directly
                // This handles cases where the user types the raw bus name even if mapped differently
                const lowerName = channelName.toLowerCase();
                if (lowerName === 'master' || lowerName.startsWith('aux') || lowerName.startsWith('fx')) {
                    busId = lowerName;
                } else {
                    this.logger.error(`Could not resolve bus ID for channel '${channelName}'`);
                    return false;
                }
            }

            busId = busId.toLowerCase();
            this.logger.info(`Setting Soundcraft channel '${channelName}' (bus: ${busId}) to ${volume} dB`);

            if (busId === 'master') {
                this.connection.master.setFaderLevelDB(volume);
            } else if (busId.startsWith('aux')) {
                const auxNumber = parseInt(busId.replace('aux', '')) || 1;
                // For aux buses, we control the master output of that aux
                // The aux() method returns an AuxBus, we need to use master on it
                const auxBus = this.connection.aux(auxNumber);
                // Aux buses don't have setFaderLevelDB, so we need to use the raw fader value
                // Convert dB to fader level (0-1)
                const faderLevel = this.dbToFaderLevel(volume);
                auxBus.master.setFaderLevel(faderLevel);
            } else if (busId.startsWith('fx')) {
                const fxNumber = parseInt(busId.replace('fx', '')) || 1;
                const fxBus = this.connection.fx(fxNumber);
                const faderLevel = this.dbToFaderLevel(volume);
                fxBus.master.setFaderLevel(faderLevel);
            } else {
                this.logger.error(`Unknown bus type: ${busId}`);
                return false;
            }

            this.logger.info(`✅ Soundcraft volume set successfully`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to set Soundcraft volume: ${error.message}`);
            return false;
        }
    }

    /**
     * Get current volume for a specific channel
     * @param {string} channelName - Name of the channel
     * @returns {Promise<number|null>} Volume level (0-100) or null on error
     */
    async getVolume(channelName) {
        if (!this.connected || !this.connection) {
            this.logger.error('Not connected to Soundcraft mixer');
            return null;
        }

        const availableChannels = this.getChannelNames();
        if (!availableChannels.includes(channelName)) {
            this.logger.error(`Invalid channel name: ${channelName}`);
            return null;
        }

        try {
            let busId = this._resolveBusId(channelName);

            if (!busId) {
                const lowerName = channelName.toLowerCase();
                if (lowerName === 'master' || lowerName.startsWith('aux') || lowerName.startsWith('fx')) {
                    busId = lowerName;
                } else {
                    return null;
                }
            }

            busId = busId.toLowerCase();
            let faderLevel = 0;

            if (busId === 'master') {
                const subscription = this.connection.master.faderLevel$.subscribe(level => {
                    faderLevel = level;
                });
                subscription.unsubscribe();
            } else if (busId.startsWith('aux')) {
                const auxNumber = parseInt(busId.replace('aux', '')) || 1;
                const subscription = this.connection.aux(auxNumber - 1).faderLevel$.subscribe(level => {
                    faderLevel = level;
                });
                subscription.unsubscribe();
            } else if (busId.startsWith('fx')) {
                const fxNumber = parseInt(busId.replace('fx', '')) || 1;
                const subscription = this.connection.fx(fxNumber - 1).faderLevel$.subscribe(level => {
                    faderLevel = level;
                });
                subscription.unsubscribe();
            } else {
                return null;
            }

            // Convert from 0-1 to 0-100
            return Math.round(faderLevel * 100);
        } catch (error) {
            this.logger.error(`Failed to get Soundcraft volume: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if Soundcraft integration is enabled and connected
     * @returns {boolean}
     */
    isEnabled() {
        return this.config.soundcraftEnabled && this.connected;
    }

    /**
     * Get list of configured channel names
     * @returns {string[]}
     */
    getChannelNames() {
        if (!this.config.soundcraftChannels) return [];

        if (Array.isArray(this.config.soundcraftChannels)) {
            return this.config.soundcraftChannels;
        }

        if (typeof this.config.soundcraftChannels === 'object') {
            return Object.keys(this.config.soundcraftChannels);
        }

        return [];
    }
}

module.exports = SoundcraftHandler;
