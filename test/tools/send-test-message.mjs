#!/usr/bin/env node

/**
 * Quick Slack Message Sender
 * Sends a message to test bot integration
 * 
 * Usage: node send-test-message.mjs "add foo fighters"
 * Or with env: SLACK_BOT_TOKEN=xoxb-... node send-test-message.mjs "help"
 */

import { WebClient } from '@slack/web-api';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config with priority: env var > test-config.json > main config.json
const testConfigPath = join(__dirname, '../config/test-config.json');
const mainConfigPath = join(__dirname, '../../config/config.json');
let config = {};

if (!process.env.SLACK_BOT_TOKEN) {
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
            console.error('❌ No config found and SLACK_BOT_TOKEN not set');
            console.error('\nCreate test/config/test-config.json or set env var:');
            console.error('cp test/config/test-config.json.example test/config/test-config.json');
            process.exit(1);
        }
    }
}

const token = process.env.SLACK_BOT_TOKEN || config.slackBotToken || config.token;
const channel = process.env.SLACK_CHANNEL || config.slackChannel || config.standardChannel || 'CJ51NPNN4';
const message = process.argv[2] || 'help';

if (!token) {
    console.error('❌ SLACK_BOT_TOKEN not found in config or environment');
    console.error('Add to test/config/test-config.json or set env var');
    process.exit(1);
}

const slack = new WebClient(token);

async function sendMessage() {
    try {
        console.log(`📤 Sending to channel ${channel}: "${message}"`);

        const result = await slack.chat.postMessage({
            channel: channel,
            text: message,
        });

        console.log(`✅ Message sent! Timestamp: ${result.ts}`);
        console.log(`📺 Watch the bot logs for the response!`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

sendMessage();
