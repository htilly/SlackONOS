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
let reactionHandler = null; // handler for reaction events
const trackMessages = new Map(); // Map message IDs to track info for reactions

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
            let isMention = false;
            if (text.includes(`<@${botUserId}>`)) {
                cleanText = text.replace(`<@${botUserId}>`, '').trim();
                isMention = true;
                logger.info(`[DISCORD] Bot was mentioned, isMention=true`);
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
                await messageHandler(cleanText, channelId, userName, 'discord', isAdmin, isMention);
            }
        });

        // Error handling
        discordClient.on(Events.Error, (error) => {
            logger.error(`[DISCORD] Client error: ${error.message || error}`);
        });

        // Reaction events - handle vote and gong reactions
        discordClient.on(Events.MessageReactionAdd, async (reaction, user) => {
            try {
                // Ignore bot's own reactions
                if (user.bot) return;

                // Fetch partial data if needed
                if (reaction.partial) {
                    await reaction.fetch();
                }
                if (reaction.message.partial) {
                    await reaction.message.fetch();
                }

                const message = reaction.message;
                const emoji = reaction.emoji.name;

                // Only process reactions on bot's own messages
                if (message.author.id !== botUserId) return;

                // Check if this message is tracked (added via add/bestof)
                const trackInfo = trackMessages.get(message.id);
                if (!trackInfo) return;

                logger.info(`[DISCORD] Reaction ${emoji} from ${user.username} on message ${message.id}`);

                // Handle vote reaction (🎵 or 🎶)
                if (emoji === '🎵' || emoji === '🎶') {
                    if (reactionHandler) {
                        await reactionHandler('vote', trackInfo.trackName, message.channel.id, user.username, 'discord');
                    }
                }
                // Handle gong reaction (🔔)
                else if (emoji === '🔔') {
                    if (reactionHandler) {
                        await reactionHandler('gong', trackInfo.trackName, message.channel.id, user.username, 'discord');
                    }
                }
            } catch (error) {
                logger.error(`[DISCORD] Error handling reaction: ${error.message || error}`);
            }
        });

        // Handle reaction removal (undo vote/gong)
        discordClient.on(Events.MessageReactionRemove, async (reaction, user) => {
            try {
                if (user.bot) return;

                if (reaction.partial) {
                    await reaction.fetch();
                }
                if (reaction.message.partial) {
                    await reaction.message.fetch();
                }

                const message = reaction.message;
                const emoji = reaction.emoji.name;

                if (message.author.id !== botUserId) return;

                const trackInfo = trackMessages.get(message.id);
                if (!trackInfo) return;

                logger.info(`[DISCORD] Reaction ${emoji} removed by ${user.username} on message ${message.id}`);

                // Handle undo (could implement vote/gong removal here if desired)
                // For now, we'll just log it
            } catch (error) {
                logger.error(`[DISCORD] Error handling reaction removal: ${error.message || error}`);
            }
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

async function sendDiscordMessage(channelId, text, options = {}) {
    if (!discordClient) {
        if (discordLogger) discordLogger.warn('Discord client not initialized');
        return null;
    }
    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel) {
            if (discordLogger) discordLogger.warn(`[DISCORD] Cannot find channel ${channelId} to send message`);
            return null;
        }
        if (channel.isTextBased && channel.isTextBased()) {
            const message = await channel.send(text);
            if (discordLogger) discordLogger.debug(`[DISCORD] Sent message to channel ${channelId}`);
            
            // Auto-add reactions if requested (for track additions)
            if (options.addReactions && message) {
                try {
                    await message.react('🎵');
                    await message.react('🔔');
                    if (discordLogger) discordLogger.debug(`[DISCORD] Added reactions to message ${message.id}`);
                } catch (err) {
                    if (discordLogger) discordLogger.warn(`[DISCORD] Failed to add reactions: ${err.message}`);
                }
            }
            
            // Track message for reactions if trackName provided
            if (options.trackName && message) {
                trackMessages.set(message.id, {
                    trackName: options.trackName,
                    channelId: channelId,
                    timestamp: Date.now()
                });
                if (discordLogger) discordLogger.debug(`[DISCORD] Tracking message ${message.id} for track: ${options.trackName}`);
            }
            
            return message;
        } else {
            if (discordLogger) discordLogger.warn(`[DISCORD] Channel ${channelId} is not text-based`);
            return null;
        }
    } catch (error) {
        if (discordLogger) discordLogger.error(`Failed to send Discord message to ${channelId}: ${error.message || error}`);
        return null;
    }
}

function getDiscordClient() {
    return discordClient;
}

function getDiscordBotUserId() {
    return botUserId;
}

function setReactionHandler(handler) {
    reactionHandler = handler;
}

module.exports = {
    initializeDiscord,
    sendDiscordMessage,
    getDiscordClient,
    getDiscordBotUserId,
    setReactionHandler
};
