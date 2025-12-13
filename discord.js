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

// Cleanup old trackMessages entries every 10 minutes to prevent memory leak
// Entries older than 1 hour are removed (reactions on older tracks are unlikely)
const TRACK_MESSAGE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const TRACK_MESSAGE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function cleanupOldTrackMessages() {
    const now = Date.now();
    const cutoff = now - TRACK_MESSAGE_MAX_AGE_MS;
    let removedCount = 0;

    for (const [messageId, data] of trackMessages.entries()) {
        if (data.timestamp < cutoff) {
            trackMessages.delete(messageId);
            removedCount++;
        }
    }

    if (removedCount > 0 && discordLogger) {
        discordLogger.debug(`[DISCORD] Cleaned up ${removedCount} old track messages from memory`);
    }
}

// Start cleanup interval when module loads
const cleanupInterval = setInterval(cleanupOldTrackMessages, TRACK_MESSAGE_CLEANUP_INTERVAL_MS);

// Keep the interval from preventing Node.js shutdown
cleanupInterval.unref();

// Logger must be injected - no fallback to ensure consistent logging
async function initializeDiscord(config, messageHandler, injectedLogger) {
    if (!injectedLogger) {
        throw new Error('Discord integration requires an injected logger');
    }

    const logger = injectedLogger;

    // store logger globally for other functions
    discordLogger = logger;

    if (!config.discordToken) {
        logger.warn('Discord token not configured - Discord integration disabled');
        return null;
    }

    try {
        // Create Discord client with required intents
        // 
        // Gateway Intents Documentation for Discord App Directory:
        // 
        // STANDARD INTENTS (no approval needed):
        // - GatewayIntentBits.Guilds: Required for basic bot functionality (guilds, channels, roles)
        // - GatewayIntentBits.GuildMessages: Required to receive message create/update/delete events
        // - GatewayIntentBits.GuildMessageReactions: Required for emoji voting (🎵 vote, 🔔 gong)
        // 
        // PRIVILEGED INTENTS (requires Discord approval):
        // - GatewayIntentBits.MessageContent: Required to read message content (commands, AI parsing)
        //   ⚠️ MUST be enabled in Discord Developer Portal AND approved for App Directory
        //   Go to: https://discord.com/developers/applications → Your App → Bot → Privileged Gateway Intents
        //   Enable "Message Content Intent" before submitting to App Directory
        // 
        // BOT PERMISSIONS (set in invite URL, calculated as 274878024768):
        // - View Channels (1024): See channels to respond in
        // - Send Messages (2048): Send responses to users
        // - Add Reactions (64): Add 🎵 and 🔔 reactions for voting
        // - Read Message History (65536): Track votes on existing messages
        // - Use External Emojis (262144): Use custom emojis in messages
        discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,                  // Required: Basic guild info
                GatewayIntentBits.GuildMessages,            // Required: Receive messages
                GatewayIntentBits.MessageContent,           // Privileged: Read message text
                GatewayIntentBits.GuildMessageReactions     // Required: Handle emoji reactions
            ]
        });

        // Ready event - bot is connected
        discordClient.once(Events.ClientReady, (client) => {
            try {
                botUserId = client.user.id;
                logger.info(`✅ Discord bot logged in as ${client.user.tag}`);
                logger.info(`   Bot user ID: ${botUserId}`);
            } catch (e) {
                logger.error('Discord ready logging failed:', e.message);
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
                // Note: Gong reactions removed - gong only works via command on currently playing track
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
            // Convert Slack markdown to Discord markdown
            let discordText = text.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)');
            
            // Discord has a 2000 char limit, split into chunks if needed
            const maxLength = 1900; // Leave some margin
            let messages = [];
            
            if (discordText.length <= maxLength) {
                // Single message
                const message = await channel.send(discordText);
                if (discordLogger) discordLogger.debug(`[DISCORD] Sent message to channel ${channelId}`);
                messages.push(message);
            } else {
                // Split on newlines to keep formatting intact
                const lines = discordText.split('\n');
                let currentChunk = '';
                let chunkCount = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if ((currentChunk + line + '\n').length > maxLength) {
                        // Send current chunk
                        if (currentChunk.trim().length > 0) {
                            const message = await channel.send(currentChunk);
                            messages.push(message);
                            chunkCount++;
                            currentChunk = '';
                            // Small delay between messages
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                    
                    currentChunk += line + '\n';
                }

                // Send remaining chunk
                if (currentChunk.trim().length > 0) {
                    const message = await channel.send(currentChunk);
                    messages.push(message);
                    chunkCount++;
                }

                if (discordLogger) discordLogger.info(`[DISCORD] Sent ${chunkCount} message chunks to channel ${channelId}`);
            }
            
            // Auto-add reactions to first message if requested (for track additions)
            const firstMessage = messages[0];
            if (options.addReactions && firstMessage) {
                try {
                    await firstMessage.react('🎵');
                    // Note: 🔔 gong reaction removed - gong only works via command on currently playing track
                    if (discordLogger) discordLogger.debug(`[DISCORD] Added reactions to message ${firstMessage.id}`);
                } catch (err) {
                    if (discordLogger) discordLogger.warn(`[DISCORD] Failed to add reactions: ${err.message}`);
                }
            }
            
            // Track first message for reactions if trackName provided
            if (options.trackName && firstMessage) {
                trackMessages.set(firstMessage.id, {
                    trackName: options.trackName,
                    channelId: channelId,
                    timestamp: Date.now()
                });
                if (discordLogger) discordLogger.debug(`[DISCORD] Tracking message ${firstMessage.id} for track: ${options.trackName}`);
            }
            
            return firstMessage; // Return first message for compatibility
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
