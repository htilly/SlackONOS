#!/usr/bin/env node

/**
 * List all channels the test bot is a member of
 */

import { WebClient } from '@slack/web-api';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testConfigPath = join(__dirname, '../config/test-config.json');
let config = {};

try {
    config = JSON.parse(readFileSync(testConfigPath, 'utf8'));
} catch (error) {
    console.error('❌ Could not load test-config.json');
    process.exit(1);
}

const slack = new WebClient(config.slackBotToken);

async function listChannels() {
    console.log('📋 Channels TestBot is a member of:\n');
    
    try {
        const result = await slack.users.conversations({
            types: 'public_channel,private_channel'
        });
        
        if (result.channels.length === 0) {
            console.log('   (none - bot is not a member of any channels)');
        } else {
            for (const channel of result.channels) {
                console.log(`   ${channel.is_private ? '🔒' : '#'} ${channel.name} (${channel.id})`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

listChannels();
