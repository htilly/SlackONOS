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
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read source file to extract validator descriptions
const sourceCode = readFileSync(__filename, 'utf8');

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
    const sendTime = Date.now();

    try {
        // Send message
        const result = await slack.chat.postMessage({
            channel: channel,
            text: message,
        });

        if (!result.ok) {
            throw new Error('Failed to send message');
        }

        // Poll for responses instead of just waiting
        // Check every 200ms for responses, but wait up to waitTime seconds total
        let firstResponseTime = null;
        const pollInterval = 200; // Check every 200ms
        const maxWaitTime = waitTime * 1000; // Convert to milliseconds
        const startTime = Date.now();
        let allResponses = [];
        let seenMessageIds = new Set();

        while (Date.now() - startTime < maxWaitTime) {
            // Get messages after
            const messagesAfter = await getChannelHistory(channel, 20);

            // Find new messages from OTHER bots (not TestBot itself)
            const newBotResponses = messagesAfter.filter(msg => {
                const isFromBot = msg.bot_id || (msg.user && msg.user !== botUserId);
                const isNew = parseFloat(msg.ts) > timestampBefore;
                const isNotTestBot = msg.user !== botUserId;
                const isNewMessage = !seenMessageIds.has(msg.ts);
                return isFromBot && isNew && isNotTestBot && isNewMessage;
            });

            // Add new responses
            for (const resp of newBotResponses) {
                seenMessageIds.add(resp.ts);
                allResponses.push(resp);
                
                // Record time of first response
                if (firstResponseTime === null) {
                    firstResponseTime = Date.now();
                }
            }

            // If we got a response and we've waited at least 1 second, we can break early
            // But still wait a bit more to catch multiple responses
            if (firstResponseTime !== null && Date.now() - firstResponseTime > 1000) {
                // Give it a bit more time for additional responses, but not the full waitTime
                if (Date.now() - startTime > Math.min(maxWaitTime, 2000)) {
                    break;
                }
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Calculate timing
        const totalTime = Date.now() - sendTime;
        const responseTime = firstResponseTime ? firstResponseTime - sendTime : null;

        return {
            responses: allResponses,
            timing: {
                totalTime: totalTime,
                firstResponseTime: responseTime,
                responseCount: allResponses.length
            }
        };
    } catch (error) {
        if (verbose) console.error('❌ Error:', error.message);
        return {
            responses: [],
            timing: {
                totalTime: Date.now() - sendTime,
                firstResponseTime: null,
                responseCount: 0
            }
        };
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
        this.timing = null; // Will store { totalTime, firstResponseTime, responseCount }
    }

    // Helper to describe what the validator expects
    describeValidator(validator) {
        if (typeof validator === 'function') {
            // Try to extract description from validator function
            const funcStr = validator.toString();
            if (funcStr.includes('containsText')) {
                const match = funcStr.match(/containsText\(['"]([^'"]+)['"]\)/);
                if (match) return `contains "${match[1]}"`;
            }
            if (funcStr.includes('matchesRegex')) {
                const match = funcStr.match(/matchesRegex\(([^)]+)\)/);
                if (match) return `matches regex ${match[1]}`;
            }
            if (funcStr.includes('responseCount')) {
                const match = funcStr.match(/responseCount\((\d+)(?:,\s*(\d+))?\)/);
                if (match) {
                    const min = match[1];
                    const max = match[2] || 'unlimited';
                    return `${min}-${max} response(s)`;
                }
            }
            if (funcStr.includes('hasText')) {
                return 'has text content';
            }
            if (funcStr.includes('notContainsText')) {
                const match = funcStr.match(/notContainsText\(['"]([^'"]+)['"]\)/);
                if (match) return `does NOT contain "${match[1]}"`;
            }
            if (funcStr.includes('and(')) {
                return 'multiple conditions (AND)';
            }
            if (funcStr.includes('or(')) {
                return 'one of multiple conditions (OR)';
            }
            return 'custom validation';
        }
        return 'unknown validator';
    }

    // Get human-readable description of what this test expects
    getExpectedDescription() {
        try {
            // Try to extract from source code by finding the test case definition
            // Match from "new TestCase(" to the closing parenthesis of the validator parameter
            const testNameEscaped = this.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Find the test case definition - need to match the complete validator expression
            // Look for: new TestCase('Name', 'command', validators.xxx(...), waitTime)
            // We need to find the validator parameter which can span multiple lines
            const testStartPattern = new RegExp(`new TestCase\\(\\s*['"]${testNameEscaped}['"]`, 's');
            const testStartMatch = sourceCode.match(testStartPattern);
            
            if (testStartMatch) {
                const startIndex = testStartMatch.index;
                // Find where the validator parameter starts (after command string)
                const afterCommand = sourceCode.indexOf('validators.', startIndex);
                
                if (afterCommand !== -1) {
                    // Find the matching closing parenthesis for the validator
                    let depth = 0;
                    let pos = afterCommand + 'validators.'.length - 1;
                    let inString = false;
                    let stringChar = null;
                    let foundStart = false;
                    
                    while (pos < sourceCode.length && pos < startIndex + 2000) {
                        const char = sourceCode[pos];
                        
                        if (!inString && (char === '"' || char === "'")) {
                            inString = true;
                            stringChar = char;
                        } else if (inString && char === stringChar && sourceCode[pos - 1] !== '\\') {
                            inString = false;
                        } else if (!inString) {
                            if (char === '(') {
                                depth++;
                                foundStart = true;
                            }
                            if (char === ')') {
                                depth--;
                                if (depth === 0 && foundStart) {
                                    const validatorCode = sourceCode.substring(afterCommand, pos + 1);
                                    return this._parseValidatorString(validatorCode);
                                }
                            }
                        }
                        pos++;
                    }
                }
            }
            
            // Final fallback: try to parse the validator directly
            const validatorStr = this.validator.toString();
            return this._parseValidatorString(validatorStr);
        } catch (e) {
            return 'validation check';
        }
    }
    
    _parseValidatorString(validatorStr) {
        const results = [];
        
        // Extract responseCount
        const responseCountPattern = /validators\.responseCount\((\d+)(?:,\s*(\d+))?\)/g;
        let match;
        while ((match = responseCountPattern.exec(validatorStr)) !== null) {
            const min = match[1];
            const max = match[2] || 'unlimited';
            results.push({ type: 'responseCount', min, max });
        }
        
        // Extract containsText - handle both single and double quotes
        const containsPattern = /validators\.containsText\(['"]([^'"]+)['"]\)/g;
        while ((match = containsPattern.exec(validatorStr)) !== null) {
            results.push({ type: 'containsText', text: match[1] });
        }
        
        // Extract matchesRegex
        const regexPattern = /validators\.matchesRegex\(([^)]+)\)/g;
        while ((match = regexPattern.exec(validatorStr)) !== null) {
            results.push({ type: 'matchesRegex', pattern: match[1] });
        }
        
        // Extract notContainsText
        const notContainsPattern = /validators\.notContainsText\(['"]([^'"]+)['"]\)/g;
        while ((match = notContainsPattern.exec(validatorStr)) !== null) {
            results.push({ type: 'notContainsText', text: match[1] });
        }
        
        // Extract hasText
        if (/validators\.hasText\(\)/.test(validatorStr)) {
            results.push({ type: 'hasText' });
        }
        
        // Check if it's an AND or OR structure
        const isAnd = /validators\.and\(/.test(validatorStr);
        const isOr = /validators\.or\(/.test(validatorStr);
        
        // Build description
        const conditions = [];
        
        for (const v of results) {
            switch (v.type) {
                case 'responseCount':
                    if (v.max === 'unlimited') {
                        conditions.push(`${v.min}+ response(s)`);
                    } else {
                        conditions.push(`${v.min}-${v.max} response(s)`);
                    }
                    break;
                case 'containsText':
                    conditions.push(`contains "${v.text}"`);
                    break;
                case 'matchesRegex':
                    conditions.push(`matches ${v.pattern}`);
                    break;
                case 'notContainsText':
                    conditions.push(`does NOT contain "${v.text}"`);
                    break;
                case 'hasText':
                    conditions.push('has text content');
                    break;
            }
        }
        
        if (conditions.length === 0) {
            return 'custom validation';
        }
        
        // Join with appropriate operator
        if (isOr && conditions.length > 1) {
            return conditions.join(' OR ');
        } else if (isAnd && conditions.length > 1) {
            return conditions.join(' AND ');
        } else {
            return conditions.join(' AND ');
        }
    }

    async run() {
        if (verbose) console.log(`\n🧪 Running: ${this.name}`);
        if (verbose) console.log(`   Command: "${this.command}"`);
        if (verbose && this.targetChannel) console.log(`   Channel: ${this.targetChannel === adminChannelId ? 'Admin' : 'Standard'}`);
        if (verbose) console.log(`   Expected: ${this.getExpectedDescription()}`);

        const result = await sendAndWaitForResponse(this.command, this.waitTime, this.targetChannel);
        this.responses = result.responses;
        this.timing = result.timing;

        if (verbose) {
            console.log(`   Responses received: ${this.responses.length}`);
            if (this.timing.firstResponseTime !== null) {
                console.log(`   ⏱️  First response: ${this.timing.firstResponseTime}ms, Total wait: ${this.timing.totalTime}ms`);
            } else {
                console.log(`   ⏱️  No response received (waited ${this.timing.totalTime}ms)`);
            }
            if (this.responses.length > 0) {
                this.responses.forEach((resp, idx) => {
                    console.log(`   Response ${idx + 1}: ${resp.text ? resp.text.substring(0, 200) : '(no text)'}${resp.text && resp.text.length > 200 ? '...' : ''}`);
                });
            }
        }

        if (this.responses.length === 0) {
            this.failed = true;
            this.error = 'No response from bot';
            if (verbose) console.log(`   ❌ Failed: ${this.error}`);
            return false;
        }

        try {
            const validationResult = this.validator(this.responses);
            if (validationResult === true) {
                this.passed = true;
                if (verbose) console.log(`   ✅ Validation passed`);
                return true;
            } else {
                this.failed = true;
                this.error = validationResult || 'Validation failed';
                if (verbose) console.log(`   ❌ Validation failed: ${this.error}`);
                return false;
            }
        } catch (error) {
            this.failed = true;
            this.error = error.message;
            if (verbose) console.log(`   ❌ Exception: ${this.error}`);
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

// Define test suite (will be assigned after definition)
const testSuiteArray = [
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
            validators.responseCount(1),
            validators.or(
                validators.containsText('Currently playing'),
                validators.containsText('playing'),
                validators.containsText('Playback is')
            )
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
        8
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
                validators.containsText('yeeted'),
                validators.containsText('removed'),
                validators.containsText('track'),
                validators.containsText('Track'),
                validators.containsText('not found'),
                validators.containsText('Error removing'),
                validators.containsText('Error removing track'),
                validators.matchesRegex(/track|Track|yeeted|removed|Error/i)
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

// Make testSuite accessible to TestCase instances
let testSuite = [];

// Run test suite
async function runTestSuite() {
    console.log('🚀 SlackONOS Integration Test Suite\n');
    console.log(`📋 Channel: ${channelId}`);
    
    // Get bot user ID
    const testBotId = await getBotUserId();
    console.log(`🤖 TestBot ID: ${testBotId}\n`);

    // Assign testSuite so TestCase instances can access it
    testSuite = testSuiteArray;
    
    // Setup timing log file
    const timingLogPath = join(__dirname, '../timing-log.json');
    
    // Read previous timing log for comparison
    let previousTimingLog = null;
    try {
        const previousData = readFileSync(timingLogPath, 'utf8');
        previousTimingLog = JSON.parse(previousData);
        if (verbose) {
            console.log(`📖 Loaded previous timing data from: ${previousTimingLog.timestamp || 'unknown'}\n`);
        }
    } catch (err) {
        // No previous timing log exists, that's okay
        if (verbose) {
            console.log('📖 No previous timing data found (first run)\n');
        }
    }
    
    const timingLog = {
        timestamp: new Date().toISOString(),
        channel: channelId,
        botId: testBotId,
        tests: []
    };
    
    const startTime = Date.now();
    
    console.log('─'.repeat(60));
    console.log(`Running ${testSuite.length} tests...\n`);

    let passed = 0;
    let failed = 0;

    for (const test of testSuite) {
        process.stdout.write(`${test.name}... `);
        
        const result = await test.run();
        
        // Log timing data
        timingLog.tests.push({
            name: test.name,
            command: test.command,
            channel: test.targetChannel === adminChannelId ? 'admin' : 'standard',
            passed: result,
            timing: test.timing || { totalTime: null, firstResponseTime: null, responseCount: 0 },
            responseCount: test.responses.length,
            error: test.error || null
        });
        
        if (result) {
            console.log('✅ PASS');
            passed++;
        } else {
            console.log(`❌ FAIL`);
            console.log(`   Error: ${test.error}`);
            if (verbose) {
                console.log(`   Expected: ${test.getExpectedDescription()}`);
                if (test.responses.length > 0) {
                    console.log(`   Actual responses (${test.responses.length}):`);
                    test.responses.forEach((resp, idx) => {
                        console.log(`     [${idx + 1}] ${resp.text || '(no text)'}`);
                    });
                } else {
                    console.log(`   Actual: No responses received`);
                }
            } else {
                // Non-verbose: show truncated response
                if (test.responses.length > 0) {
                    console.log(`   Response: ${test.responses[0].text.substring(0, 100)}...`);
                }
            }
            failed++;
        }

        // Delay between tests to avoid rate limits and allow bot to process
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Calculate total time as sum of all test timings (excluding delays)
    const totalTime = timingLog.tests.reduce((sum, test) => {
        return sum + (test.timing?.totalTime || 0);
    }, 0);
    
    const wallClockTime = Date.now() - startTime;
    
    // Write timing log to file
    try {
        writeFileSync(timingLogPath, JSON.stringify(timingLog, null, 2));
        console.log(`\n📊 Timing data saved to: ${timingLogPath}`);
    } catch (err) {
        console.error(`\n⚠️  Failed to save timing log: ${err.message}`);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('📊 Test Results:');
    console.log(`   ✅ Passed: ${passed}/${testSuite.length}`);
    console.log(`   ❌ Failed: ${failed}/${testSuite.length}`);
    console.log(`   📈 Success Rate: ${Math.round((passed / testSuite.length) * 100)}%`);
    console.log(`   ⏱️  Total Test Time: ${(totalTime / 1000).toFixed(2)}s (wall clock: ${(wallClockTime / 1000).toFixed(2)}s)`);
    
    // Compare with previous run if available
    if (previousTimingLog && previousTimingLog.tests) {
        console.log('\n' + '─'.repeat(60));
        console.log('📊 Timing Comparison (vs previous run):');
        
        // Calculate previous total time
        let previousTotalTime = 0;
        if (previousTimingLog.tests.length > 0) {
            previousTotalTime = previousTimingLog.tests.reduce((sum, test) => {
                return sum + (test.timing?.totalTime || 0);
            }, 0);
        }
        
        // Show total time comparison
        const totalDiff = totalTime - previousTotalTime;
        const totalDiffPercent = previousTotalTime > 0 ? ((totalDiff / previousTotalTime) * 100) : 0;
        const totalDiffSymbol = totalDiff < 0 ? '⬇️' : totalDiff > 0 ? '⬆️' : '➡️';
        const totalDiffColor = totalDiff < 0 ? '\x1b[32m' : totalDiff > 0 ? '\x1b[31m' : '\x1b[33m';
        const resetColor = '\x1b[0m';
        
        console.log(`\n   Total Time:`);
        console.log(`   Previous: ${(previousTotalTime / 1000).toFixed(2)}s`);
        console.log(`   Current:  ${(totalTime / 1000).toFixed(2)}s`);
        console.log(`   ${totalDiffSymbol} ${totalDiffColor}${totalDiff >= 0 ? '+' : ''}${(totalDiff / 1000).toFixed(2)}s (${totalDiffPercent >= 0 ? '+' : ''}${totalDiffPercent.toFixed(1)}%)${resetColor}`);
        
        // Create a map of previous tests by name for quick lookup
        const previousTestsMap = new Map();
        previousTimingLog.tests.forEach(test => {
            previousTestsMap.set(test.name, test);
        });
        
        // Compare individual tests
        console.log(`\n   Individual Test Comparisons:`);
        let fasterCount = 0;
        let slowerCount = 0;
        let sameCount = 0;
        
        timingLog.tests.forEach(test => {
            const prevTest = previousTestsMap.get(test.name);
            if (prevTest && prevTest.timing && test.timing && test.timing.totalTime !== null) {
                const currentTime = test.timing.totalTime;
                const prevTime = prevTest.timing.totalTime;
                const diff = currentTime - prevTime;
                const diffPercent = prevTime > 0 ? ((diff / prevTime) * 100) : 0;
                
                if (Math.abs(diff) < 50) {
                    // Less than 50ms difference, consider it the same
                    sameCount++;
                } else if (diff < 0) {
                    fasterCount++;
                } else {
                    slowerCount++;
                }
                
                const symbol = diff < -50 ? '⬇️' : diff > 50 ? '⬆️' : '➡️';
                const color = diff < -50 ? '\x1b[32m' : diff > 50 ? '\x1b[31m' : '\x1b[33m';
                const timeStr = `${(currentTime / 1000).toFixed(2)}s`;
                const diffStr = `${diff >= 0 ? '+' : ''}${(diff / 1000).toFixed(2)}s (${diffPercent >= 0 ? '+' : ''}${diffPercent.toFixed(1)}%)`;
                
                console.log(`   ${symbol} ${test.name.substring(0, 40).padEnd(40)} ${color}${timeStr.padStart(8)} ${diffStr.padStart(20)}${resetColor}`);
            } else if (test.timing && test.timing.totalTime !== null) {
                // New test, no previous data
                console.log(`   🆕 ${test.name.substring(0, 40).padEnd(40)} ${(test.timing.totalTime / 1000).toFixed(2)}s (new test)`);
            }
        });
        
        console.log(`\n   Summary: ${fasterCount} faster, ${slowerCount} slower, ${sameCount} same`);
    } else {
        console.log('\n📊 No previous timing data to compare (this appears to be the first run)');
    }
    
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
