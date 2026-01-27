const { WebClient } = require('@slack/web-api');
const { SocketModeClient } = require('@slack/socket-mode');

module.exports = function SlackSystem({ botToken, appToken, logger, onCommand }) {

    const web = new WebClient(botToken);

    let botUserId = null;
    let reactionHandler = null; // handler for reaction events
    const trackMessages = new Map(); // Map message timestamps to track info for reactions
    
    // Cleanup old trackMessages entries every 10 minutes to prevent memory leak
    // Entries older than 1 hour are removed (reactions on older tracks are unlikely)
    const TRACK_MESSAGE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
    const TRACK_MESSAGE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

    function cleanupOldTrackMessages() {
        const now = Date.now();
        const cutoff = now - TRACK_MESSAGE_MAX_AGE_MS;
        let removedCount = 0;

        for (const [messageKey, data] of trackMessages.entries()) {
            if (data.timestamp < cutoff) {
                trackMessages.delete(messageKey);
                removedCount++;
            }
        }

        if (removedCount > 0 && logger) {
            logger.debug(`[SLACK] Cleaned up ${removedCount} old track messages from memory`);
        }
    }

    // Start cleanup interval when module loads
    const cleanupInterval = setInterval(cleanupOldTrackMessages, TRACK_MESSAGE_CLEANUP_INTERVAL_MS);
    if (cleanupInterval.unref) {
        cleanupInterval.unref(); // Don't prevent Node.js shutdown
    }

    const socket = new SocketModeClient({
        appToken,
        logger,
        logLevel: "debug", // Keep debug for now to be safe
        clientPingTimeout: 30000, // Increase timeout to 30s to handle network lag
        autoReconnectEnabled: true // Enable automatic reconnection
    });

    // Track connection state
    let isConnected = false;
    
    // Handle disconnections gracefully
    socket.on('disconnect', (event) => {
        isConnected = false;
        logger.warn(`Socket Mode disconnected: ${event?.reason || 'unknown reason'}`);
    });

    socket.on('error', (error) => {
        logger.error(`Socket Mode error: ${error.message}`);
    });

    socket.on('reconnect', () => {
        isConnected = true;
        logger.info('Socket Mode reconnected successfully');
    });
    
    // Mark as connected when socket starts
    socket.on('ready', () => {
        isConnected = true;
    });

    // ==========================================
    // INITIALIZATION
    // ==========================================
    async function init() {
        try {
            // Fetch bot ID BEFORE starting socketMode
            const auth = await web.auth.test();
            botUserId = auth.user_id;
            logger.info(`Bot user ID loaded: ${botUserId}`);

            await socket.start();
            isConnected = true;
            logger.info("Socket Mode connected");
        } catch (error) {
            logger.error(`Failed to initialize Slack: ${error.message}`);
            throw error;
        }
    }

    // ==========================================
    // RAW EVENT LOGGER & DISPATCHER
    // ==========================================
    // We use 'slack_event' to catch EVERYTHING properly
    socket.on('slack_event', async ({ body, ack }) => {
        try {
            // Always acknowledge immediately
            await ack();

            // Handle Slash Commands
            if (body.type === 'slash_commands') {
                const command = body; // In slash commands, body IS the payload
                logger.info(`Slash command: ${command.command} ${command.text}`);
                const fullText = `${command.command.replace('/', '')} ${command.text}`.trim();
                // Slash commands don't have a message timestamp, so pass null
                onCommand(fullText, command.channel_id, `<@${command.user_id}>`, 'slack', false, false, null);
                return;
            }

            // Handle Events API (Messages, App Mentions, etc)
            if (body.type === 'event_callback') {
                const e = body.event;

                // Ignore our own messages
                if (e.user === botUserId) return;

                // 1. Handle standard messages
                if (e.type === 'message') {
                    // Ignore message changes/deletions/subtypes unless it's a file share (maybe?)
                    // For now, let's be permissive but ignore subtypes that are clearly not user messages
                    if (e.subtype && e.subtype !== 'file_share' && e.subtype !== 'thread_broadcast') {
                        // logger.debug(`Ignoring message subtype: ${e.subtype}`);
                        return;
                    }

                    if (e.text) {
                        // If the message contains a direct mention to the bot, skip here
                        // App mentions will be handled by the dedicated handler below
                        if (botUserId && e.text.includes(`<@${botUserId}>`)) {
                            return;
                        }
                        logger.info(`Incoming MESSAGE from ${e.user}: ${e.text}`);
                        onCommand(e.text, e.channel, `<@${e.user}>`, 'slack', false, false, e.ts);
                    }
                    return;
                }

                // 2. Handle App Mentions (@SlackONOS hello)
                if (e.type === 'app_mention') {
                    const cleaned = e.text.replace(/<@[^>]+>/, "").trim();
                    logger.info(`Incoming MENTION from ${e.user}: ${cleaned}`);
                    onCommand(cleaned, e.channel, `<@${e.user}>`, 'slack', false, true, e.ts);  // isMention = true
                    return;
                }

                // 3. Handle Reaction Added events
                if (e.type === 'reaction_added') {
                    logger.debug(`[SLACK] Received reaction_added event: ${JSON.stringify(e)}`);
                    
                    // Ignore bot's own reactions
                    if (e.user === botUserId) {
                        logger.debug(`[SLACK] Ignoring bot's own reaction`);
                        return;
                    }

                    try {
                        // Get user info for username
                        let userName = e.user;
                        try {
                            const userInfo = await web.users.info({ user: e.user });
                            if (userInfo.user && userInfo.user.real_name) {
                                userName = userInfo.user.real_name;
                            } else if (userInfo.user && userInfo.user.name) {
                                userName = userInfo.user.name;
                            }
                        } catch (userErr) {
                            logger.debug(`Could not fetch user info for ${e.user}: ${userErr.message}`);
                        }

                        // Check if this reaction is on a bot message
                        // We need to check the message to see if it's from the bot
                        let message = null;
                        try {
                            const messageResult = await web.conversations.history({
                                channel: e.item.channel,
                                latest: e.item.ts,
                                limit: 1,
                                inclusive: true
                            });
                            if (messageResult.messages && messageResult.messages.length > 0) {
                                message = messageResult.messages[0];
                            }
                        } catch (msgErr) {
                            logger.debug(`Could not fetch message for reaction: ${msgErr.message}`);
                            return;
                        }

                        // Only process reactions on bot's own messages
                        if (!message || message.user !== botUserId) return;

                        // Create message key (channel + timestamp)
                        const messageKey = `${e.item.channel}:${e.item.ts}`;
                        const trackInfo = trackMessages.get(messageKey);
                        if (!trackInfo) {
                            logger.debug(`[SLACK] No track info found for message ${messageKey} (reaction ignored)`);
                            return;
                        }

                        const emoji = e.reaction;
                        logger.info(`[SLACK] Reaction ${emoji} from ${userName} on message ${messageKey}`);

                        // Handle vote reactions (thumbsup, 👍, +1, etc)
                        const voteEmojis = ['thumbsup', '👍', '+1', 'thumbs_up', 'thumbs-up', 'up', 'upvote', 'vote'];
                        if (voteEmojis.includes(emoji)) {
                            if (reactionHandler) {
                                await reactionHandler('vote', trackInfo.trackName, e.item.channel, userName, 'slack');
                            }
                        }
                        // Note: Gong reactions removed - gong only works via command on currently playing track
                    } catch (error) {
                        logger.error(`[SLACK] Error handling reaction: ${error.message || error}`);
                    }
                    return;
                }
            }
        } catch (error) {
            logger.error(`Error in slack_event handler: ${error.message}`);
        }
    });

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        init,
        web,
        socket, // Export socket for connection checking
        isConnected: () => isConnected, // Helper to check connection status
        // Helper to send messages
        sendMessage: async (text, channelId, options = {}) => {
            // Basic heuristic: Slack channel IDs usually start with C, D, G, or W etc.
            // Discord channel IDs are long numeric strings. Skip if looks like Discord.
            if (/^[0-9]{17,22}$/.test(channelId)) {
                logger.debug(`Skipping Slack send for non-Slack channel id: ${channelId}`);
                return;
            }
            try {
                const result = await web.chat.postMessage({
                    channel: channelId,
                    text: text,
                    ...options // Allow passing blocks, attachments, etc.
                });

                // Track message for reactions if trackName provided
                if (options.trackName && result.ts) {
                    const messageKey = `${channelId}:${result.ts}`;
                    trackMessages.set(messageKey, {
                        trackName: options.trackName,
                        channelId: channelId,
                        timestamp: Date.now()
                    });
                    if (logger) {
                        logger.debug(`[SLACK] Tracking message ${messageKey} for track: ${options.trackName}`);
                    }
                }

                return result;
            } catch (error) {
                logger.error(`Error sending message to Slack: ${error.message}`);
                return null;
            }
        },
        setReactionHandler: (handler) => {
            reactionHandler = handler;
        }
    };
};
