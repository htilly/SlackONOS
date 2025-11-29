'use strict'

const { Client, GatewayIntentBits, Events } = require('discord.js');
const WinstonWrapper = require('./logger.js');

/**
 * Discord client module for SlackONOS
 * Handles Discord Gateway connection and message events
 */

let discordClient = null;
let botUserId = null;
let discordLogger = null; // module-level logger reference

// We accept an injected logger (recommended). If not provided we create a minimal one.
async function initializeDiscord(config, messageHandler, injectedLogger) {
    let logger = injectedLogger;
    if (!logger) {
        try {
            logger = new WinstonWrapper({
                level: (config && config.logLevel) || 'info',
                format: require('winston').format.simple(),
                transports: [new (require('winston').transports.Console)()]
            });
        } catch (e) {
            logger = {
                info: console.log,
                warn: console.warn,
                error: console.error,
                debug: console.debug
            }; // last-resort fallback
        }
    }

    // store logger globally for other functions
    discordLogger = logger;

    if (!config.discordToken) {
        logger.warn('Discord token not configured - Discord integration disabled');
        return null;
    }

    try {
        // Create Discord client with required intents
        discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });

        // Ready event - bot is connected
        discordClient.once(Events.ClientReady, (client) => {
            try {
                botUserId = client.user.id;
                logger.info(`✅ Discord bot logged in as ${client.user.tag}`);
                logger.info(`   Bot user ID: ${botUserId}`);
            } catch (e) {
                console.error('Discord ready logging failed:', e.message);
            }
        });

        // Message event - handle incoming messages
        discordClient.on(Events.MessageCreate, async (message) => {
            // Ignore bot's own messages
            if (message.author.id === botUserId || message.author.bot) {
                return;
            }
            // Only respond in configured channels (supports IDs or names)
            if (Array.isArray(config.discordChannels) && config.discordChannels.length > 0) {
                const allowed = config.discordChannels;
                if (!allowed.includes(message.channel.id) && !allowed.includes(message.channel.name)) {
                    logger.debug(`[DISCORD] Ignoring message in ${message.channel.name} (${message.channel.id}) - not in allowed list`);
                    return;
                }
            }

            // Parse message content
            const text = message.content.trim();
            const userName = message.author.username;
            const channelId = message.channel.id;

            logger.info(`[DISCORD] Message from ${userName} in ${message.channel.name}: ${text}`);

            // Handle mentions - Discord bot mentions are <@BOT_ID>
            let cleanText = text;
            if (text.includes(`<@${botUserId}>`)) {
                cleanText = text.replace(`<@${botUserId}>`, '').trim();
            }

            // Check if user has admin role
            let isAdmin = false;
            if (message.member && Array.isArray(config.discordAdminRoles) && config.discordAdminRoles.length > 0) {
                // Log all user roles at info level for debugging
                const userRoles = message.member.roles.cache.map(r => `${r.name} (${r.id})`).join(', ');
                logger.info(`[DISCORD] ${userName} has roles: ${userRoles}`);
                logger.info(`[DISCORD] Checking against admin roles: ${config.discordAdminRoles.join(', ')}`);
                
                isAdmin = message.member.roles.cache.some(role => 
                    config.discordAdminRoles.includes(role.name) || 
                    config.discordAdminRoles.includes(role.id)
                );
                if (isAdmin) {
                    logger.info(`[DISCORD] ✅ User ${userName} has admin role`);
                } else {
                    logger.info(`[DISCORD] ❌ User ${userName} does NOT have admin role`);
                }
            } else {
                logger.info(`[DISCORD] Admin check skipped - member: ${!!message.member}, adminRoles: ${config.discordAdminRoles}`);
            }

            // Call the message handler (shared with Slack)
            if (messageHandler) {
                await messageHandler(cleanText, channelId, userName, 'discord', isAdmin);
            }
        });

        // Error handling
        discordClient.on(Events.Error, (error) => {
            logger.error(`[DISCORD] Client error: ${error.message || error}`);
        });

        // Login to Discord
        await discordClient.login(config.discordToken);
        logger.info('🎮 Discord client connecting...');

        return discordClient;

    } catch (error) {
        logger.error(`Failed to initialize Discord: ${error.message || error}`);
        return null;
    }
}

async function sendDiscordMessage(channelId, text) {
    if (!discordClient) {
        if (discordLogger) discordLogger.warn('Discord client not initialized');
        return;
    }
    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel) {
            if (discordLogger) discordLogger.warn(`[DISCORD] Cannot find channel ${channelId} to send message`);
            return;
        }
        if (channel.isTextBased && channel.isTextBased()) {
            await channel.send(text);
            if (discordLogger) discordLogger.debug(`[DISCORD] Sent message to channel ${channelId}`);
        } else {
            if (discordLogger) discordLogger.warn(`[DISCORD] Channel ${channelId} is not text-based`);
        }
    } catch (error) {
        if (discordLogger) discordLogger.error(`Failed to send Discord message to ${channelId}: ${error.message || error}`);
    }
}

function getDiscordClient() {
    return discordClient;
}

function getDiscordBotUserId() {
    return botUserId;
}

module.exports = {
    initializeDiscord,
    sendDiscordMessage,
    getDiscordClient,
    getDiscordBotUserId
};
