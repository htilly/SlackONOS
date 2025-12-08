#!/usr/bin/env node

/**
 * Integration Test Suite for SlackONOS
 * 
 * Tests all main features by sending commands and validating responses.
 * Requires SlackONOS bot to be running.
 * 
 * Usage:
 *   node test/tools/integration-test-suite.mjs
 *   node test/tools/integration-test-suite.mjs --channel C01JS8A0YC9
 *   node test/tools/integration-test-suite.mjs --verbose
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
    console.error('❌ Could not load test/config/test-config.json');
    console.error('   Run: cp test/config/test-config.json.example test/config/test-config.json');
    process.exit(1);
}

const slackToken = process.env.SLACK_BOT_TOKEN || config.slackBotToken;
if (!slackToken) {
    console.error('❌ No Slack bot token found');
    process.exit(1);
}

const slack = new WebClient(slackToken);

// Parse CLI args
const args = process.argv.slice(2);
let channelId = config.slackChannel || 'C01JS8A0YC9';
let adminChannelId = config.slackAdminChannel || 'C01J1TBLCA0';
const slackONOSBotId = config.slackONOSBotId || null;
let verbose = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--channel' && args[i + 1]) {
        channelId = args[i + 1];
        i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
        verbose = true;
    }
}

// Get bot user ID
let botUserId = null;

async function getBotUserId() {
    try {
        const result = await slack.auth.test();
        botUserId = result.user_id;
        return result.user_id;
    } catch (error) {
        console.error('❌ Failed to get bot user ID:', error.message);
        return null;
    }
}

// Get channel history
async function getChannelHistory(channelId, limit = 10) {
    try {
        const result = await slack.conversations.history({
            channel: channelId,
            limit,
        });
        return result.messages || [];
    } catch (error) {
        if (verbose) console.error('❌ Error getting history:', error.message);
        return [];
    }
}

// Send a message and wait for response
async function sendAndWaitForResponse(message, waitTime = 3, targetChannel = null) {
    const channel = targetChannel || channelId;
    const timestampBefore = Date.now() / 1000;

    try {
        // Send message
        const result = await slack.chat.postMessage({
            channel: channel,
            text: message,
        });

        if (!result.ok) {
            throw new Error('Failed to send message');
        }

        // Wait for bot to process
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

        // Get messages after
        const messagesAfter = await getChannelHistory(channel, 20);

        // Find new messages from OTHER bots (not TestBot itself)
        const botResponses = messagesAfter.filter(msg => {
            const isFromBot = msg.bot_id || (msg.user && msg.user !== botUserId);
            const isNew = parseFloat(msg.ts) > timestampBefore;
            const isNotTestBot = msg.user !== botUserId;
            return isFromBot && isNew && isNotTestBot;
        });

        return botResponses;
    } catch (error) {
        if (verbose) console.error('❌ Error:', error.message);
        return [];
    }
}

// Test case class
class TestCase {
    constructor(name, command, validator, waitTime = 3, targetChannel = null) {
        this.name = name;
        this.command = command;
        this.validator = validator;
        this.waitTime = waitTime;
        this.targetChannel = targetChannel;
        this.passed = false;
        this.failed = false;
        this.error = null;
        this.responses = [];
    }

    async run() {
        if (verbose) console.log(`\n🧪 Running: ${this.name}`);
        if (verbose) console.log(`   Command: "${this.command}"`);
        if (verbose && this.targetChannel) console.log(`   Channel: ${this.targetChannel === adminChannelId ? 'Admin' : 'Standard'}`);

        this.responses = await sendAndWaitForResponse(this.command, this.waitTime, this.targetChannel);

        if (this.responses.length === 0) {
            this.failed = true;
            this.error = 'No response from bot';
            return false;
        }

        try {
            const result = this.validator(this.responses);
            if (result === true) {
                this.passed = true;
                return true;
            } else {
                this.failed = true;
                this.error = result || 'Validation failed';
                return false;
            }
        } catch (error) {
            this.failed = true;
            this.error = error.message;
            return false;
        }
    }
}

// Validators
const validators = {
    containsText: (text) => (responses) => {
        const allText = responses.map(r => r.text).join(' ');
        if (allText.toLowerCase().includes(text.toLowerCase())) {
            return true;
        }
        return `Response does not contain "${text}"`;
    },

    responseCount: (min, max = null) => (responses) => {
        if (max === null && responses.length >= min) return true;
        if (responses.length >= min && responses.length <= max) return true;
        return `Expected ${min}${max ? `-${max}` : '+'} responses, got ${responses.length}`;
    },

    hasText: () => (responses) => {
        if (responses.length > 0 && responses[0].text) return true;
        return 'No text in response';
    },

    matchesRegex: (regex) => (responses) => {
        const allText = responses.map(r => r.text).join(' ');
        if (regex.test(allText)) return true;
        return `Response does not match pattern ${regex}`;
    },

    and: (...validatorFns) => (responses) => {
        for (const validator of validatorFns) {
            const result = validator(responses);
            if (result !== true) return result;
        }
        return true;
    },

    or: (...validatorFns) => (responses) => {
        const errors = [];
        for (const validator of validatorFns) {
            const result = validator(responses);
            if (result === true) return true;
            errors.push(result);
        }
        return `None of the conditions matched: ${errors.join(', ')}`;
    },

    notContainsText: (text) => (responses) => {
        const allText = responses.map(r => r.text).join(' ');
        if (!allText.toLowerCase().includes(text.toLowerCase())) {
            return true;
        }
        return `Response should NOT contain "${text}"`;
    }
};

// Define test suite
const testSuite = [
    new TestCase(
        'Flush Queue - Access Denied (regular channel)',
        'flush',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('admin-only'),
                validators.containsText('flushvote')
            )
        ),
        3
    ),

    new TestCase(
        'Flush Queue - Admin Channel',
        'flush',
        validators.responseCount(1, 3),
        5,
        adminChannelId
    ),

    new TestCase(
        'Add Track - First Time',
        'add Foo Fighters - Best Of You',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added')
            )
        ),
        7
    ),

    new TestCase(
        'Add Track - Duplicate Detection',
        'add Foo Fighters - Best Of You',
        validators.and(
            validators.responseCount(1, 3),
            validators.containsText('already')
        ),
        5
    ),

    new TestCase(
        'Help Command',
        'help',
        validators.containsText('SlackONOS'),
        3
    ),

    new TestCase(
        'Current Track',
        'current',
        validators.and(
            validators.hasText(),
            validators.responseCount(1)
        ),
        3
    ),

    new TestCase(
        'List Queue',
        'list',
        validators.and(
            validators.responseCount(1, 5),
            validators.hasText()
        ),
        5
    ),

    new TestCase(
        'Queue Size',
        'size',
        validators.matchesRegex(/\d+.*track/i),
        4
    ),

    new TestCase(
        'Volume Check',
        'volume',
        validators.matchesRegex(/\d+/),
        4
    ),

    new TestCase(
        'Search Track',
        'search with or without you',
        validators.and(
            validators.responseCount(1, 2),
            validators.containsText('u2')
        ),
        5
    ),

    new TestCase(
        'Status Command',
        'status',
        validators.and(
            validators.hasText(),
            validators.responseCount(1)
        ),
        3
    ),

    new TestCase(
        'Play/Pause Control - Access Denied',
        'pause',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('admin-only'),
                validators.containsText('admin')
            )
        ),
        3
    ),

    new TestCase(
        'Admin - Pause Playback',
        'pause',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('pause'),
                validators.containsText('stop'),
                validators.containsText('paused')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Play/Resume',
        'play',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('play'),
                validators.containsText('resume'),
                validators.containsText('playing'),
                validators.containsText('gooo'),
                validators.containsText('flowing')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Best Of Command',
        'bestof nirvana',
        validators.and(
            validators.responseCount(1, 3),
            validators.hasText()
        ),
        15
    ),

    // NOTE: AI Natural Language via @mention cannot be tested via API
    // because app_mention events require actual Slack UI mentions, not text.
    // AI functionality is still tested via 'bestof' command above.

    new TestCase(
        'Admin - Remove Track #2',
        'remove 2',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('removed'),
                validators.containsText('track'),
                validators.containsText('not found')
            )
        ),
        5,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Gong Limit',
        'setconfig gongLimit 1',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('gongLimit'),
                validators.containsText('set to 1'),
                validators.containsText('updated')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Gong Non-Immune Track',
        'gong',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('GONGED into oblivion'),
                validators.containsText('PEOPLE HAVE SPOKEN')
            )
        ),
        7
    ),

    new TestCase(
        'Vote to Play Track',
        'vote 4',
        validators.and(
            validators.responseCount(1, 3),
            validators.notContainsText('already voted'),
            validators.or(
                validators.containsText('VOTE'),
                validators.containsText('Voted!')
            )
        ),
        4
    ),

    new TestCase(
        'Remove Track from Queue - Access Denied',
        'remove 1',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('removed'),
                validators.containsText('track'),
                validators.containsText('admin-only')
            )
        ),
        3
    ),

    new TestCase(
        'Democratic Flush Vote',
        'flushvote',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('flush'),
                validators.containsText('vote'),
                validators.containsText('clear')
            )
        ),
        3
    ),
];

// Run test suite
async function runTestSuite() {
    console.log('🚀 SlackONOS Integration Test Suite\n');
    console.log(`📋 Channel: ${channelId}`);
    
    // Get bot user ID
    const testBotId = await getBotUserId();
    console.log(`🤖 TestBot ID: ${testBotId}\n`);

    console.log('─'.repeat(60));
    console.log(`Running ${testSuite.length} tests...\n`);

    let passed = 0;
    let failed = 0;

    for (const test of testSuite) {
        process.stdout.write(`${test.name}... `);
        
        const result = await test.run();
        
        if (result) {
            console.log('✅ PASS');
            passed++;
        } else {
            console.log(`❌ FAIL`);
            console.log(`   Error: ${test.error}`);
            if (verbose && test.responses.length > 0) {
                console.log(`   Response: ${test.responses[0].text.substring(0, 100)}...`);
            }
            failed++;
        }

        // Delay between tests to avoid rate limits and allow bot to process
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('\n' + '─'.repeat(60));
    console.log('📊 Test Results:');
    console.log(`   ✅ Passed: ${passed}/${testSuite.length}`);
    console.log(`   ❌ Failed: ${failed}/${testSuite.length}`);
    console.log(`   📈 Success Rate: ${Math.round((passed / testSuite.length) * 100)}%`);
    console.log('─'.repeat(60));

    if (failed > 0) {
        console.log('\n⚠️  Some tests failed. Check that SlackONOS bot is running.');
        process.exit(1);
    } else {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
    }
}

// Run
runTestSuite().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
});
