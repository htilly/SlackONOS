const { WebClient } = require('@slack/web-api');
const { SocketModeClient } = require('@slack/socket-mode');

module.exports = function SlackSystem({ botToken, appToken, logger, onCommand }) {

    const web = new WebClient(botToken);

    let botUserId = null;
    const socket = new SocketModeClient({
        appToken,
        logger,
        logLevel: "debug", // Keep debug for now to be safe
        clientPingTimeout: 30000 // Increase timeout to 30s to handle network lag
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
                onCommand(fullText, command.channel_id, `<@${command.user_id}>`);
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
                        logger.info(`Incoming MESSAGE from ${e.user}: ${e.text}`);
                        onCommand(e.text, e.channel, `<@${e.user}>`);
                    }
                    return;
                }

                // 2. Handle App Mentions (@SlackONOS hello)
                if (e.type === 'app_mention') {
                    const cleaned = e.text.replace(/<@[^>]+>/, "").trim();
                    logger.info(`Incoming MENTION from ${e.user}: ${cleaned}`);
                    onCommand(cleaned, e.channel, `<@${e.user}>`);
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
        // Helper to send messages
        sendMessage: async (text, channelId, options = {}) => {
            try {
                await web.chat.postMessage({
                    channel: channelId,
                    text: text,
                    ...options // Allow passing blocks, attachments, etc.
                });
            } catch (error) {
                logger.error(`Error sending message to Slack: ${error.message}`);
            }
        }
    };
};
