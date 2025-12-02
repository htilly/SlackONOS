#!/usr/bin/env node

/**
 * Check what scopes the test bot token has
 */

import { WebClient } from '@slack/web-api';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test config
const testConfigPath = join(__dirname, '../config/test-config.json');
let config = {};

try {
    config = JSON.parse(readFileSync(testConfigPath, 'utf8'));
} catch (error) {
    console.error('❌ Could not load test-config.json');
    process.exit(1);
}

const token = config.slackBotToken;
if (!token) {
    console.error('❌ No slackBotToken in test-config.json');
    process.exit(1);
}

const slack = new WebClient(token);

async function checkScopes() {
    console.log('🔍 Checking token scopes...\n');
    
    try {
        const result = await slack.auth.test();
        
        console.log('✅ Token is valid!');
        console.log(`   Bot User: ${result.user}`);
        console.log(`   User ID: ${result.user_id}`);
        console.log(`   Team: ${result.team}`);
        console.log(`   Team ID: ${result.team_id}\n`);
        
        // The auth.test response doesn't show scopes directly,
        // but we can test individual API calls to see what works
        
        console.log('🧪 Testing API capabilities:\n');
        
        // Test conversations.list (requires channels:read)
        try {
            await slack.conversations.list({ limit: 1 });
            console.log('✅ conversations.list - Has channels:read scope');
        } catch (e) {
            console.log('❌ conversations.list - Missing channels:read scope');
            console.log(`   Error: ${e.message}\n`);
        }
        
        // Test users.info (requires users:read)
        try {
            await slack.users.info({ user: result.user_id });
            console.log('✅ users.info - Has users:read scope');
        } catch (e) {
            console.log('❌ users.info - Missing users:read scope');
            console.log(`   Error: ${e.message}\n`);
        }
        
    } catch (error) {
        console.error('❌ Token test failed:', error.message);
        process.exit(1);
    }
}

checkScopes();
