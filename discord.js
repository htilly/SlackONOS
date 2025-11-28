'use strict'

const { Client, GatewayIntentBits, Events } = require('discord.js');
const logger = require('./logger.js');

/**
 * Discord client module for SlackONOS
 * Handles Discord Gateway connection and message events
 */

let discordClient = null;
let botUserId = null;

async function initializeDiscord(config, messageHandler) {
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
            botUserId = client.user.id;
            logger.info(`✅ Discord bot logged in as ${client.user.tag}`);
            logger.info(`   Bot user ID: ${botUserId}`);
        });

        // Message event - handle incoming messages
        discordClient.on(Events.MessageCreate, async (message) => {
            // Ignore bot's own messages
            if (message.author.id === botUserId || message.author.bot) {
                return;
            }

            // Only respond in configured channels
            if (config.discordChannels && !config.discordChannels.includes(message.channel.id)) {
                return;
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

            // Call the message handler (shared with Slack)
            if (messageHandler) {
                await messageHandler(cleanText, channelId, userName, 'discord');
            }
        });

        // Error handling
        discordClient.on(Events.Error, (error) => {
            logger.error('[DISCORD] Client error:', error);
        });

        // Login to Discord
        await discordClient.login(config.discordToken);
        logger.info('🎮 Discord client connecting...');

        return discordClient;

    } catch (error) {
        logger.error('Failed to initialize Discord:', error);
        return null;
    }
}

async function sendDiscordMessage(channelId, text) {
    if (!discordClient) {
        logger.warn('Discord client not initialized');
        return;
    }

    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            await channel.send(text);
        }
    } catch (error) {
        logger.error(`Failed to send Discord message to ${channelId}:`, error);
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
