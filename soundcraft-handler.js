const { SoundcraftUI } = require('soundcraft-ui-connection');
const logger = require('./logger');

class SoundcraftHandler {
    constructor(config) {
        this.config = config;
        this.connection = null;
        this.connected = false;
        this.reconnectTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
    }

    /**
     * Initialize connection to Soundcraft Ui24R mixer
     */
    async connect() {
        if (!this.config.soundcraftEnabled) {
            logger.info('Soundcraft integration disabled in config');
            return false;
        }

        if (!this.config.soundcraftIp) {
            logger.error('Soundcraft IP address not configured');
            return false;
        }

        const channels = this.getChannelNames();
        if (channels.length === 0) {
            logger.error('No Soundcraft channels configured');
            return false;
        }

        try {
            logger.info(`Connecting to Soundcraft Ui24R at ${this.config.soundcraftIp}...`);

            this.connection = new SoundcraftUI(this.config.soundcraftIp);

            // Set up event handlers
            this.connection.conn.observeConnection().subscribe(connected => {
                this.connected = connected;
                if (connected) {
                    logger.info('✅ Successfully connected to Soundcraft Ui24R');
                    logger.info(`   Configured channels: ${channels.join(', ')}`);
                    this.reconnectAttempts = 0;
                } else {
                    logger.warn('⚠️  Disconnected from Soundcraft Ui24R');
                    this.scheduleReconnect();
                }
            });

            // Wait a moment for initial connection
            await new Promise(resolve => setTimeout(resolve, 2000));

            return this.connected;
        } catch (error) {
            logger.error(`Failed to connect to Soundcraft: ${error.message}`);
            this.scheduleReconnect();
            return false;
        }
    }

    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            return;
        }

        if (this.reconnectTimeout) {
            return; // Already scheduled
        }

        this.reconnectAttempts++;
        logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay / 1000}s...`);

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
                this.connection.conn.disconnect();
                logger.info('Disconnected from Soundcraft Ui24R');
            } catch (error) {
                logger.error(`Error disconnecting from Soundcraft: ${error.message}`);
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
     * @param {number} volume - Volume level (0-100)
     * @returns {Promise<boolean>} Success status
     */
    async setVolume(channelName, volume) {
        if (!this.connected || !this.connection) {
            logger.error('Not connected to Soundcraft mixer');
            return false;
        }

        const availableChannels = this.getChannelNames();
        if (!availableChannels.includes(channelName)) {
            logger.error(`Invalid channel name: ${channelName}. Available channels: ${availableChannels.join(', ')}`);
            return false;
        }

        // Validate volume range
        if (volume < 0 || volume > 100) {
            logger.error(`Invalid volume: ${volume}. Must be between 0 and 100`);
            return false;
        }

        try {
            // Convert volume from 0-100 to 0-1 range (fader level)
            const faderLevel = volume / 100;

            // Resolve the actual bus ID
            let busId = this._resolveBusId(channelName);

            if (!busId) {
                // Fallback: if the name itself is a valid bus ID (like 'master' or 'aux1'), try using it directly
                // This handles cases where the user types the raw bus name even if mapped differently
                const lowerName = channelName.toLowerCase();
                if (lowerName === 'master' || lowerName.startsWith('aux') || lowerName.startsWith('fx')) {
                    busId = lowerName;
                } else {
                    logger.error(`Could not resolve bus ID for channel '${channelName}'`);
                    return false;
                }
            }

            busId = busId.toLowerCase();
            logger.info(`Setting Soundcraft channel '${channelName}' (bus: ${busId}) to ${volume}% (fader: ${faderLevel.toFixed(2)})`);

            if (busId === 'master') {
                this.connection.master.setFaderLevel(faderLevel);
            } else if (busId.startsWith('aux')) {
                const auxNumber = parseInt(busId.replace('aux', '')) || 1;
                this.connection.aux(auxNumber - 1).setFaderLevel(faderLevel);
            } else if (busId.startsWith('fx')) {
                const fxNumber = parseInt(busId.replace('fx', '')) || 1;
                this.connection.fx(fxNumber - 1).setFaderLevel(faderLevel);
            } else {
                logger.error(`Unknown bus type: ${busId}`);
                return false;
            }

            logger.info(`✅ Soundcraft volume set successfully`);
            return true;
        } catch (error) {
            logger.error(`Failed to set Soundcraft volume: ${error.message}`);
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
            logger.error('Not connected to Soundcraft mixer');
            return null;
        }

        const availableChannels = this.getChannelNames();
        if (!availableChannels.includes(channelName)) {
            logger.error(`Invalid channel name: ${channelName}`);
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
            logger.error(`Failed to get Soundcraft volume: ${error.message}`);
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
