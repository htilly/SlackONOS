#!/usr/bin/env node

/**
 * Integration Test Helper
 * 
 * This tool allows you to send real Slack messages and observe the bot's response.
 * Useful for end-to-end testing of the entire flow:
 * Slack message → Bot processing → Spotify search → Sonos action
 * 
 * Usage:
 *   node test/tools/integration-test-helper.mjs "add foo fighters" --channel music-admin
 */

import { WebClient } from '@slack/web-api';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config with priority: test-config.json > main config.json > env var
const testConfigPath = join(__dirname, '../config/test-config.json');
const mainConfigPath = join(__dirname, '../../config/config.json');
let config = {};

// Try test config first
try {
    config = JSON.parse(readFileSync(testConfigPath, 'utf8'));
    console.log('📋 Using test-config.json');
} catch (error) {
    // Fall back to main config
    try {
        config = JSON.parse(readFileSync(mainConfigPath, 'utf8'));
        console.log('📋 Using main config.json');
    } catch (error2) {
        // Config might be gitignored, that's OK if we have env var
        if (!process.env.SLACK_BOT_TOKEN) {
            console.error('❌ No config files found and SLACK_BOT_TOKEN not set');
            console.error('\nEither:');
            console.error('  1. Create test/config/test-config.json (recommended for tests)');
            console.error('  2. Create config/config.json');
            console.error('  3. Set SLACK_BOT_TOKEN environment variable');
            console.error('\nExample: cp test/config/test-config.json.example test/config/test-config.json');
            process.exit(1);
        }
    }
}

const slackToken = process.env.SLACK_BOT_TOKEN || config.slackBotToken || config.token || config.legacySlackToken;
if (!slackToken) {
    console.error('❌ SLACK_BOT_TOKEN not found');
    console.error('\nAdd it to test/config/test-config.json or set env var:');
    console.error('SLACK_BOT_TOKEN=xoxb-... node test/tools/integration-test-helper.mjs "help"');
    process.exit(1);
}

const slack = new WebClient(slackToken);

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(`
Usage: node integration-test-helper.mjs <message> [options]

Examples:
  node integration-test-helper.mjs "add foo fighters"
  node integration-test-helper.mjs "what's playing" --channel music-admin
  node integration-test-helper.mjs "volume up" --wait 5

Options:
  --channel <name>   Channel to send to (default: from config)
  --wait <seconds>   Wait time to observe bot response (default: 3)
  --watch           Watch for bot responses in real-time
  `);
    process.exit(0);
}

// Parse options
let message = args[0];
let channelName = config.slackChannel || config.standardChannel || process.env.SLACK_CHANNEL || 'CJ51NPNN4'; // Default to standard music channel
let waitTime = 3;
let watch = false;

for (let i = 1; i < args.length; i++) {
    if (args[i] === '--channel' && args[i + 1]) {
        channelName = args[i + 1].replace(/^#/, '');
        i++;
    } else if (args[i] === '--wait' && args[i + 1]) {
        waitTime = parseInt(args[i + 1]);
        i++;
    } else if (args[i] === '--watch') {
        watch = true;
    }
}

/**
 * Get channel ID from name (or return if already an ID)
 */
async function getChannelId(name) {
    const cleanName = name.replace(/^#/, '');

    // If it's already a channel ID (starts with C or G), return it directly
    if (/^[CG][A-Z0-9]{8,}$/.test(cleanName)) {
        console.log(`Using channel ID directly: ${cleanName}`);
        return cleanName;
    }

    // Otherwise, lookup by name
    try {
        const result = await slack.conversations.list({
            types: 'public_channel,private_channel',
        });

        const channel = result.channels?.find(
            (c) => c.name === cleanName || c.id === cleanName
        );

        if (!channel) {
            throw new Error(`Channel not found: ${name}`);
        }

        return channel.id;
    } catch (error) {
        console.error('❌ Error finding channel:', error.message);
        throw error;
    }
}

/**
 * Get channel history
 */
async function getChannelHistory(channelId, limit = 10) {
    try {
        const result = await slack.conversations.history({
            channel: channelId,
            limit,
        });

        return result.messages || [];
    } catch (error) {
        console.error('❌ Error getting channel history:', error.message);
        return [];
    }
}

/**
 * Get bot user ID
 */
async function getBotUserId() {
    try {
        const result = await slack.auth.test();
        return result.user_id;
    } catch (error) {
        console.error('❌ Error getting bot user ID:', error.message);
        return null;
    }
}

/**
 * Format message for display
 */
async function formatMessage(msg) {
    let username = msg.user || 'Unknown';

    if (msg.user) {
        try {
            const userInfo = await slack.users.info({ user: msg.user });
            username = userInfo.user?.real_name || userInfo.user?.name || msg.user;
        } catch (e) {
            // Ignore user lookup errors
        }
    } else if (msg.bot_id) {
        username = '🤖 Bot';
    }

    const timestamp = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString();
    const text = msg.text || '(attachments/blocks)';

    return `[${timestamp}] ${username}: ${text}`;
}

/**
 * Main test flow
 */
async function runIntegrationTest() {
    console.log('🚀 SlackONOS Integration Test Helper\n');

    try {
        // Get channel ID
        console.log(`📡 Finding channel: #${channelName}...`);
        const channelId = await getChannelId(channelName);
        console.log(`✅ Channel ID: ${channelId}\n`);

        // Get bot user ID
        const botUserId = await getBotUserId();
        console.log(`🤖 Bot User ID: ${botUserId}\n`);

        // Get messages before sending
        console.log('📖 Reading channel history before test...');
        const messagesBefore = await getChannelHistory(channelId, 5);
        const timestampBefore = Date.now() / 1000;

        // Send test message
        console.log(`\n💬 Sending message: "${message}"`);
        const result = await slack.chat.postMessage({
            channel: channelId,
            text: message,
        });

        if (!result.ok) {
            throw new Error('Failed to send message');
        }

        console.log(`✅ Message sent! (ts: ${result.ts})\n`);

        // Wait for bot to process
        console.log(`⏳ Waiting ${waitTime} seconds for bot to respond...\n`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

        // Get messages after
        console.log('📖 Reading bot responses...\n');
        const messagesAfter = await getChannelHistory(channelId, 10);

        // Find new messages from OTHER bots (not TestBot itself)
        const botResponses = messagesAfter.filter(msg => {
            const isFromBot = msg.user === botUserId || msg.bot_id;
            const isNew = parseFloat(msg.ts) > timestampBefore;
            const isNotTestBot = msg.user !== botUserId; // Ignore TestBot's own message
            return isFromBot && isNew && isNotTestBot;
        });

        if (botResponses.length === 0) {
            console.log('⚠️  No bot responses detected yet.');
            console.log('   The bot might still be processing, or it might not be running.\n');
            console.log('   Recent messages:');
            for (const msg of messagesAfter.slice(0, 5)) {
                console.log('   ' + await formatMessage(msg));
            }
        } else {
            console.log(`✅ Bot responded! (${botResponses.length} message(s))\n`);
            console.log('📨 Bot responses:');
            console.log('─'.repeat(60));
            for (const msg of botResponses.reverse()) {
                console.log(await formatMessage(msg));
                if (msg.attachments) {
                    console.log('   📎 Attachments:', JSON.stringify(msg.attachments, null, 2));
                }
            }
            console.log('─'.repeat(60));
        }

        // Watch mode
        if (watch) {
            console.log('\n👀 Watching for more responses (Ctrl+C to stop)...\n');
            let lastCheck = Date.now() / 1000;

            setInterval(async () => {
                const messages = await getChannelHistory(channelId, 5);
                const newMessages = messages.filter(msg => {
                    const isFromBot = msg.user === botUserId || msg.bot_id;
                    const isNew = parseFloat(msg.ts) > lastCheck;
                    return isFromBot && isNew;
                });

                if (newMessages.length > 0) {
                    for (const msg of newMessages.reverse()) {
                        console.log('🔔 ' + await formatMessage(msg));
                    }
                    lastCheck = Date.now() / 1000;
                }
            }, 2000);
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
runIntegrationTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
