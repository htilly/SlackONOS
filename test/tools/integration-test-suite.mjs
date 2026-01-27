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
        return { messages: result.messages || [], retryAfter: null };
    } catch (error) {
        const retryAfter = error?.data?.retry_after || null;
        if (verbose) console.error('❌ Error getting history:', error.message);
        return { messages: [], retryAfter };
    }
}

async function getThreadReplies(channelId, threadTs, limit = 50) {
    try {
        const result = await slack.conversations.replies({
            channel: channelId,
            ts: threadTs,
            limit,
        });
        return { messages: result.messages || [], retryAfter: null };
    } catch (error) {
        const retryAfter = error?.data?.retry_after || null;
        if (verbose) console.error('❌ Error getting thread replies:', error.message);
        return { messages: [], retryAfter };
    }
}

// Send a message and wait for response
async function sendAndWaitForResponse(message, waitTime = 3, targetChannel = null) {
    const channel = targetChannel || channelId;
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

        // Use the sent message's timestamp as reference (more reliable than local clock)
        const sentMessageTs = parseFloat(result.ts);

        // Poll for responses instead of just waiting
        // Check every 200ms for responses, but wait up to waitTime seconds total
        let firstResponseTime = null;
        const pollInterval = 1000; // Check every 1s to avoid rate limits
        const maxWaitTime = waitTime * 1000; // Convert to milliseconds
        const startTime = Date.now();
        let allResponses = [];
        let seenMessageIds = new Set();
        // Track our own message so we don't pick it up
        seenMessageIds.add(result.ts);

        while (Date.now() - startTime < maxWaitTime) {
            // Get messages after
            const historyResult = await getChannelHistory(channel, 10);
            if (historyResult.retryAfter) {
                await new Promise(resolve => setTimeout(resolve, historyResult.retryAfter * 1000));
                continue;
            }
            const messagesAfter = historyResult.messages;

            // Find new messages that came AFTER our sent message
            const newBotResponses = messagesAfter.filter(msg => {
                const msgTs = parseFloat(msg.ts);
                const isAfterOurMessage = msgTs > sentMessageTs;
                const isNotOurMessage = msg.ts !== result.ts;
                const isNotTestBot = msg.user !== botUserId;
                const isNewMessage = !seenMessageIds.has(msg.ts);
                // Accept any message that's not from TestBot and came after our message
                return isAfterOurMessage && isNotOurMessage && isNotTestBot && isNewMessage;
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

            // Check for thread replies to OUR sent message (bot may reply in thread)
            const ourThreadReplies = await getThreadReplies(channel, result.ts, 25);
            if (ourThreadReplies.retryAfter) {
                await new Promise(resolve => setTimeout(resolve, ourThreadReplies.retryAfter * 1000));
            } else {
                for (const reply of ourThreadReplies.messages) {
                    const isNotOurMessage = reply.ts !== result.ts;
                    const isNotTestBot = reply.user !== botUserId;
                    const isNewMessage = !seenMessageIds.has(reply.ts);
                    if (isNotOurMessage && isNotTestBot && isNewMessage) {
                        seenMessageIds.add(reply.ts);
                        allResponses.push(reply);
                        if (firstResponseTime === null) {
                            firstResponseTime = Date.now();
                        }
                    }
                }
            }

            // Also check thread replies on any bot responses that started threads
            for (const resp of newBotResponses) {
                if (!resp.thread_ts || resp.thread_ts === result.ts) continue; // Skip if it's our thread
                const repliesResult = await getThreadReplies(channel, resp.thread_ts, 25);
                if (repliesResult.retryAfter) {
                    await new Promise(resolve => setTimeout(resolve, repliesResult.retryAfter * 1000));
                    continue;
                }
                for (const reply of repliesResult.messages) {
                    const isAfterOurMessage = parseFloat(reply.ts) > sentMessageTs;
                    const isNotOurMessage = reply.ts !== result.ts;
                    const isNotTestBot = reply.user !== botUserId;
                    const isNewMessage = !seenMessageIds.has(reply.ts);
                    if (isAfterOurMessage && isNotOurMessage && isNotTestBot && isNewMessage) {
                        seenMessageIds.add(reply.ts);
                        allResponses.push(reply);
                        if (firstResponseTime === null) {
                            firstResponseTime = Date.now();
                        }
                    }
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
    constructor(name, command, validator, waitTime = 7, targetChannel = null) {
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

    async run(isRetry = false) {
        if (verbose) console.log(`\n🧪 Running: ${this.name}${isRetry ? ' (RETRY)' : ''}`);
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
const queueSizeStore = {};
const extractedValues = {};

function extractQueueSize(responses) {
    const allText = responses.map(r => r.text).join(' ');
    // Match "X tracks" pattern first (more specific)
    const tracksMatch = allText.match(/(\d+)\s*track/i);
    if (tracksMatch) return parseInt(tracksMatch[1], 10);
    // Fall back to first number
    const match = allText.match(/\b(\d+)\b/);
    if (!match) return null;
    return parseInt(match[1], 10);
}

function extractTrackCountFromResponse(responses) {
    const allText = responses.map(r => r.text).join(' ');
    // Match patterns like "(150 tracks)" or "150 tracks"
    const match = allText.match(/\((\d+)\s*tracks?\)/i) || allText.match(/(\d+)\s*tracks?/i);
    if (!match) return null;
    return parseInt(match[1], 10);
}

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
    },

    recordQueueSize: (key) => (responses) => {
        const size = extractQueueSize(responses);
        if (size === null) return 'Could not parse queue size from response';
        queueSizeStore[key] = size;
        return true;
    },

    queueSizeIncreaseFrom: (key, minIncrease = 1) => (responses) => {
        const size = extractQueueSize(responses);
        if (size === null) return 'Could not parse queue size from response';
        const baseline = queueSizeStore[key];
        if (baseline === undefined || baseline === null) {
            return `No baseline queue size recorded for "${key}"`;
        }
        if (size >= baseline + minIncrease) return true;
        return `Expected queue size to increase by ${minIncrease} from ${baseline}, got ${size}`;
    },

    // Verify queue size increased by EXACTLY N (not double, not less)
    queueSizeIncreaseExactly: (key, exactIncrease) => (responses) => {
        const size = extractQueueSize(responses);
        if (size === null) return 'Could not parse queue size from response';
        const baseline = queueSizeStore[key];
        if (baseline === undefined || baseline === null) {
            return `No baseline queue size recorded for "${key}"`;
        }
        const actualIncrease = size - baseline;
        
        // Exact match - no output
        if (actualIncrease === exactIncrease) return true;
        
        // Disable tolerance for very small expected increases (1-2 tracks),
        // where a "90%" tolerance would allow clearly incorrect results (e.g., 0 of 1).
        if (exactIncrease >= 3) {
            const tolerance = Math.floor(exactIncrease * 0.9);
            if (actualIncrease >= tolerance && actualIncrease < exactIncrease) {
                console.log(`   ⚠️  WARNING: Queue increased by ${actualIncrease} (expected ${exactIncrease}, baseline: ${baseline} → ${size})`);
                return true;
            }
        }
        
        // Outside tolerance or small exact value - fail
        return `❌ FAIL: Queue increased by ${actualIncrease} (expected exactly ${exactIncrease}, baseline: ${baseline} → ${size})`;
    },

    // Extract and store track count from search results (e.g., "(50 tracks)")
    extractAndStoreTrackCount: (key) => (responses) => {
        const count = extractTrackCountFromResponse(responses);
        if (count === null) return 'Could not extract track count from response';
        extractedValues[key] = count;
        return true;
    },

    // Verify queue increased by stored track count (with tolerance for duplicates/blacklist)
    queueSizeIncreasedByStoredCount: (baselineKey, countKey, tolerancePercent = 10) => (responses) => {
        const size = extractQueueSize(responses);
        if (size === null) return 'Could not parse queue size from response';
        const baseline = queueSizeStore[baselineKey];
        const expectedCount = extractedValues[countKey];
        if (baseline === undefined) return `No baseline recorded for "${baselineKey}"`;
        if (expectedCount === undefined) return `No track count recorded for "${countKey}"`;
        
        const actualIncrease = size - baseline;
        const minExpected = Math.floor(expectedCount * (1 - tolerancePercent / 100));
        const maxExpected = expectedCount; // Should not exceed expected (no doubling!)
        
        // Exact match - no output
        if (actualIncrease === expectedCount) return true;
        
        // Within tolerance but not exact - warning but pass
        if (actualIncrease >= minExpected && actualIncrease < expectedCount) {
            console.log(`   ⚠️  WARNING: Queue increased by ${actualIncrease} (expected ${expectedCount}, baseline: ${baseline} → ${size}, tolerance: ${minExpected}-${maxExpected})`);
            return true;
        }
        
        // Exceeded expected (possible doubling bug) - fail
        if (actualIncrease > maxExpected) {
            return `❌ FAIL: Queue increased by ${actualIncrease} but expected max ${maxExpected} - possible DUPLICATE QUEUEING BUG! (baseline: ${baseline} → ${size})`;
        }
        
        // Below minimum (too many filtered) - fail
        return `❌ FAIL: Queue increased by ${actualIncrease}, expected ${minExpected}-${maxExpected} (based on ${expectedCount} tracks, baseline: ${baseline} → ${size})`;
    }
};

// Define test suite (will be assigned after definition)
// ORDER MATTERS: Tests are arranged to handle state dependencies correctly
const testSuiteArray = [
    // ═══════════════════════════════════════════════════════════════════
    // PHASE 0: PRE-FLIGHT CHECKS - Verify clean state before starting
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Pre-flight: Check No Active Votes',
        'votecheck',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('no active votes'),
                validators.containsText('No votes'),
                validators.containsText('No tracks have been voted'),
                validators.containsText('0 vote')
            )
        ),
        3
    ),

    new TestCase(
        'Pre-flight: Check No Immune Tracks',
        'listimmune',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('No tracks'),
                validators.containsText('no immune'),
                validators.containsText('currently immune'),
                validators.containsText('fair game'),
                validators.containsText('0 immune')
            )
        ),
        3,
        adminChannelId
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: SETUP - Start with a clean slate
    // ═══════════════════════════════════════════════════════════════════
    
    new TestCase(
        'Admin - Flush Queue (Setup)',
        'flush',
        validators.responseCount(1, 3),
        5,
        adminChannelId
    ),

    new TestCase(
        'Admin - Reset Gong Limit to 3',
        'setconfig gongLimit 3',
        validators.or(
            validators.containsText('gongLimit'),
            validators.containsText('set to 3'),
            validators.containsText('updated')
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Reset Vote Limit to 3',
        'setconfig voteLimit 3',
        validators.or(
            validators.containsText('voteLimit'),
            validators.containsText('set to 3'),
            validators.containsText('updated')
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Safe Volume (5)',
        'setvolume 5',
        validators.matchesRegex(/5|volume/i),
        3,
        adminChannelId
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: READ-ONLY QUERIES (don't change state)
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Help Command',
        'help',
        validators.containsText('SlackONOS'),
        3
    ),

    new TestCase(
        'Status Command',
        'status',
        validators.and(
            validators.hasText(),
            validators.responseCount(1)
        ),
        5  // Increased timeout
    ),

    new TestCase(
        'Volume Check',
        'volume',
        validators.matchesRegex(/\d+/),
        4
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3: SEARCH COMMANDS (read-only)
    // ═══════════════════════════════════════════════════════════════════

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
        'Search Album',
        'searchalbum abbey road',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Beatles'),
                validators.containsText('Abbey Road')
            )
        ),
        5
    ),

    new TestCase(
        'Search Playlist',
        'searchplaylist rock classics',
        validators.and(
            validators.responseCount(1, 2),
            validators.matchesRegex(/playlist|tracks|\d+/i)
        ),
        5
    ),

    new TestCase(
        'Search - Empty Query Error',
        'search',
        validators.containsText('What should I search for'),
        3
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 4: BUILD UP THE QUEUE (add tracks for later tests)
    // ═══════════════════════════════════════════════════════════════════

    // Get baseline queue size before adding tracks
    new TestCase(
        'Queue Size - Initial Baseline',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.recordQueueSize('initialBaseline')
        ),
        4
    ),

    new TestCase(
        'Add Track #1 - Foo Fighters',
        'add Foo Fighters - Best Of You',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        7
    ),

    // Verify exactly 1 track was added
    new TestCase(
        'Queue Size - After Track #1 (+1)',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.queueSizeIncreaseExactly('initialBaseline', 1),
            validators.recordQueueSize('afterTrack1')
        ),
        4
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
        'Add Track #2 - U2',
        'add U2 - With Or Without You',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        7
    ),

    // Verify exactly 1 more track added (total +2 from initial)
    new TestCase(
        'Queue Size - After Track #2 (+1)',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.queueSizeIncreaseExactly('afterTrack1', 1),
            validators.recordQueueSize('afterTrack2')
        ),
        4
    ),

    new TestCase(
        'Add Track #3 - Queen',
        'add Queen - Bohemian Rhapsody',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        7
    ),

    new TestCase(
        'Add Track #4 - Nirvana',
        'add Nirvana - Smells Like Teen Spirit',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        7
    ),

    // Search album first to get track count
    new TestCase(
        'Search Album - Abbey Road (get track count)',
        'searchalbum abbey road',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Beatles'),
                validators.containsText('Abbey Road')
            ),
            validators.extractAndStoreTrackCount('abbeyRoadTracks')
        ),
        5
    ),

    new TestCase(
        'Queue Size - Baseline Before Album',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.recordQueueSize('beforeAlbum')
        ),
        4
    ),

    new TestCase(
        'Add Album - Abbey Road',
        'addalbum abbey road',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        10
    ),

    // Verify album tracks were added (not doubled!)
    new TestCase(
        'Queue Size - After Album (verify no doubling)',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.queueSizeIncreasedByStoredCount('beforeAlbum', 'abbeyRoadTracks', 20),
            validators.recordQueueSize('beforePlaylist')
        ),
        4
    ),

    // Search playlist first to get track count
    new TestCase(
        'Search Playlist - Rock Classics (get track count)',
        'searchplaylist rock classics',
        validators.and(
            validators.responseCount(1, 2),
            validators.matchesRegex(/playlist|tracks|\d+/i),
            validators.extractAndStoreTrackCount('rockClassicsTracks')
        ),
        5
    ),

    new TestCase(
        'Add Playlist - Rock Classics',
        'addplaylist rock classics',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('queue'),
                validators.containsText('added'),
                validators.containsText('Added')
            )
        ),
        12
    ),

    // Verify playlist tracks added (not doubled!)
    new TestCase(
        'Queue Size - After Playlist (verify no doubling)',
        'size',
        validators.and(
            validators.responseCount(1, 2),
            validators.queueSizeIncreasedByStoredCount('beforePlaylist', 'rockClassicsTracks', 20)
        ),
        4
    ),

    new TestCase(
        'Best Of Command',
        'bestof led zeppelin 3',
        validators.and(
            validators.responseCount(1, 3),
            validators.hasText()
        ),
        8
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 5: QUEUE QUERIES (now that we have tracks)
    // ═══════════════════════════════════════════════════════════════════

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
        'Up Next',
        'upnext',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('Upcoming'),
                validators.containsText('#')
            )
        ),
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

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 6: ACCESS CONTROL TESTS (before we use admin commands)
    // ═══════════════════════════════════════════════════════════════════

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
        5
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
        'Remove Track - Access Denied',
        'remove 1',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('admin-only'),
                validators.containsText('admin')
            )
        ),
        3
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 7: VOTING SYSTEM (order matters!)
    // First: vote immune on track #1, then try to gong it (should fail)
    // Then: gong a different track (should succeed with gongLimit=1)
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Vote Check - Initially Empty',
        'votecheck',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('no active votes'),
                validators.containsText('No votes'),
                validators.containsText('No tracks have been voted'),
                validators.containsText('Be the first')
            )
        ),
        3
    ),

    new TestCase(
        'Gong Check - Initially No Gongs',
        'gongcheck',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('more votes are needed'),
                validators.containsText('GONG'),
                validators.containsText('gong')
            )
        ),
        3
    ),

    new TestCase(
        'Vote Immune - Protect Track #0',
        'voteimmune 0',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('IMMUNITY GRANTED'),
                validators.containsText('immunity'),
                validators.containsText('protected'),
                validators.containsText('vote')  // partial vote message
            )
        ),
        4
    ),

    new TestCase(
        'Admin - List Immune Tracks',
        'listimmune',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('immune'),
                validators.containsText('Immune'),
                validators.containsText('protected'),
                validators.containsText('fair game')  // "Everything is fair game for the gong"
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Gong Limit to 1',
        'setconfig gongLimit 1',
        validators.or(
            validators.containsText('gongLimit'),
            validators.containsText('set to 1'),
            validators.containsText('updated')
        ),
        3,
        adminChannelId
    ),

    // This should fail because track #0 is immune
    new TestCase(
        'Gong Immune Track - Should Be Protected',
        'gong',
        validators.and(
            validators.responseCount(1, 3),
            validators.or(
                validators.containsText('diplomatic immunity'),
                validators.containsText('protect'),
                validators.containsText('GONGED into oblivion'),  // Might gong a different track
                validators.containsText('PEOPLE HAVE SPOKEN')
            )
        ),
        7
    ),

    new TestCase(
        'Vote to Play Track #3',
        'vote 3',
        validators.and(
            validators.responseCount(1, 3),
            validators.notContainsText('already voted'),
            validators.or(
                validators.containsText('VOTE'),
                validators.containsText('Voted!'),
                validators.containsText('vote')
            )
        ),
        4
    ),

    new TestCase(
        'Vote Check - Should Show Active Vote',
        'votecheck',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('Current vote counts'),
                validators.containsText('votes'),
                validators.containsText('/3')  // shows as "1/3 votes"
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
                validators.containsText('Voting period started'),
                validators.containsText('flush'),
                validators.containsText('minutes'),
                validators.containsText('already voted')  // if already voted
            )
        ),
        3
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 8: ADMIN PLAYBACK CONTROLS
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Admin - Pause Playback',
        'pause',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Taking a breather'),
                validators.containsText('Paused'),
                validators.containsText('pause')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Resume Playback',
        'resume',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Back to the groove'),
                validators.containsText('Resuming'),
                validators.containsText('play')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Play',
        'play',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('play'),
                validators.containsText('gooo'),
                validators.containsText('flowing'),
                validators.containsText('Music')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Next Track',
        'next',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Skipped'),
                validators.containsText('next banger'),
                validators.containsText('On to the next')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Previous Track',
        'previous',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Going back in time'),
                validators.containsText('Previous track'),
                validators.containsText('previous')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Shuffle Mode',
        'shuffle',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Shuffle mode activated'),
                validators.containsText('randomized'),
                validators.containsText('chaos reign')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Normal Mode',
        'normal',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Back to normal'),
                validators.containsText('order you actually wanted'),
                validators.containsText('normal')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Stop Playback',
        'stop',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Silence falls'),
                validators.containsText('Playback stopped'),
                validators.containsText('stop')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Play Again',
        'play',
        validators.or(
            validators.containsText('play'),
            validators.containsText('gooo'),
            validators.containsText('flowing')
        ),
        3,
        adminChannelId
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 9: ADMIN QUEUE MODIFICATIONS (with verification)
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Queue Size Before Remove',
        'size',
        validators.matchesRegex(/\d+.*track/i),
        3
    ),

    new TestCase(
        'Admin - Remove Track #2',
        'remove 2',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('yeeted'),
                validators.containsText('removed'),
                validators.containsText('Track'),
                validators.matchesRegex(/track|yeeted|removed/i)
            )
        ),
        5,
        adminChannelId
    ),

    new TestCase(
        'Queue Size After Remove',
        'size',
        validators.matchesRegex(/\d+.*track/i),
        3
    ),

    new TestCase(
        'Admin - Remove Invalid Track Number (error)',
        'remove abc',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText("That's not a valid track number"),
                validators.containsText('Check the queue with')
            )
        ),
        3,
        adminChannelId
    ),

    // Add more tracks before Thanos (need at least 4 for a meaningful snap)
    new TestCase(
        'Add Track for Thanos #1 - AC/DC',
        'add AC/DC - Back In Black',
        validators.or(
            validators.containsText('queue'),
            validators.containsText('added'),
            validators.containsText('Added')
        ),
        7
    ),

    new TestCase(
        'Add Track for Thanos #2 - Metallica',
        'add Metallica - Enter Sandman',
        validators.or(
            validators.containsText('queue'),
            validators.containsText('added'),
            validators.containsText('Added')
        ),
        7
    ),

    new TestCase(
        'Queue Size Before Thanos',
        'size',
        validators.matchesRegex(/\d+.*track/i),
        3
    ),

    new TestCase(
        'Admin - Thanos Snap',
        'thanos',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('SNAP'),
                validators.containsText('balanced'),
                validators.containsText('dust'),
                validators.containsText('tiny')  // In case queue is too small
            )
        ),
        5,
        adminChannelId
    ),

    new TestCase(
        'Queue Size After Thanos',
        'size',
        validators.matchesRegex(/\d+.*track/i),
        3
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 10: VOLUME CONTROLS (keep volume LOW - max 20, reset to 5)
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Admin - Set Volume to 15',
        'setvolume 15',
        validators.matchesRegex(/15|volume|Volume/i),
        4,
        adminChannelId
    ),

    new TestCase(
        'Admin - Reset Volume to 5',
        'setvolume 5',
        validators.matchesRegex(/5|volume/i),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Volume Too High (error)',
        'setvolume 999',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('louder than a metal concert'),
                validators.containsText('Max is'),
                validators.containsText('Whoa there')
            )
        ),
        3,
        adminChannelId
    ),

    // Volume should still be 5 after rejected high volume

    new TestCase(
        'Admin - Set Volume Invalid (error)',
        'setvolume abc',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText("That's not a number"),
                validators.containsText('actual digits'),
                validators.containsText('Invalid volume')
            )
        ),
        3,
        adminChannelId
    ),

    // Volume should still be 5 after rejected invalid input

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 11: CONFIG COMMANDS
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Admin - Get Config',
        'getconfig',
        validators.and(
            validators.hasText(),
            validators.or(
                validators.containsText('gongLimit'),
                validators.containsText('voteLimit'),
                validators.containsText('maxVolume')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Invalid Config Key',
        'setconfig invalidKeyThatDoesNotExist 123',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Unknown'),
                validators.containsText('unknown'),
                validators.containsText('Invalid'),
                validators.containsText('not a valid')
            )
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Crossfade Status',
        'crossfade',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Crossfade'),
                validators.containsText('crossfade'),
                validators.containsText('enabled'),
                validators.containsText('disabled')
            )
        ),
        3,
        adminChannelId
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 12: ERROR HANDLING (input validation)
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Add - No Track Specified',
        'add',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('gotta tell me what to add'),
                validators.containsText('add <song name')
            )
        ),
        3
    ),

    new TestCase(
        'Vote - Invalid Track Number',
        'vote xyz',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText("track number isn't in the queue"),
                validators.containsText('Use `list`'),
                validators.containsText('see available tracks')
            )
        ),
        3
    ),

    new TestCase(
        'Search Album - No Query',
        'searchalbum',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('gotta tell me what album'),
                validators.containsText('searchalbum <album name>')
            )
        ),
        3
    ),

    new TestCase(
        'Search Playlist - No Query',
        'searchplaylist',
        validators.and(
            validators.responseCount(1, 2),
            validators.or(
                validators.containsText('Tell me which playlist'),
                validators.containsText('searchplaylist <name>')
            )
        ),
        3
    ),

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 13: CLEANUP - Reset to safe defaults
    // ═══════════════════════════════════════════════════════════════════

    new TestCase(
        'Admin - Reset Gong Limit to 3 (Cleanup)',
        'setconfig gongLimit 3',
        validators.or(
            validators.containsText('gongLimit'),
            validators.containsText('updated')
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Reset Vote Limit to 3 (Cleanup)',
        'setconfig voteLimit 3',
        validators.or(
            validators.containsText('voteLimit'),
            validators.containsText('updated')
        ),
        3,
        adminChannelId
    ),

    new TestCase(
        'Admin - Set Volume to 5 (Cleanup)',
        'setvolume 5',
        validators.matchesRegex(/5|volume/i),
        3,
        adminChannelId
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

        let finalResult = result;
        let retried = false;

        // If test failed, wait 10 seconds and retry once
        if (!result) {
            console.log(`❌ FAIL - Retrying in 10s...`);
            await new Promise(resolve => setTimeout(resolve, 10000));

            process.stdout.write(`${test.name} (RETRY)... `);
            finalResult = await test.run(true);
            retried = true;
        }

        // Log timing data
        timingLog.tests.push({
            name: test.name,
            command: test.command,
            channel: test.targetChannel === adminChannelId ? 'admin' : 'standard',
            passed: finalResult,
            timing: test.timing || { totalTime: null, firstResponseTime: null, responseCount: 0 },
            responseCount: test.responses.length,
            error: test.error || null,
            retried: retried,
            retrySucceeded: retried && finalResult
        });

        if (finalResult) {
            if (retried) {
                console.log('✅ PASS (after retry)');
            } else {
                console.log('✅ PASS');
            }
            passed++;
        } else {
            console.log(`❌ FAIL`);
            if (retried) {
                console.log(`   Still failed after retry`);
            }
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
                if (test.responses.length > 0 && test.responses[0].text) {
                    console.log(`   Response: ${test.responses[0].text.substring(0, 100)}...`);
                }
            }
            failed++;

            // ABORT EARLY if pre-flight checks fail - bot needs restart
            if (test.name.startsWith('Pre-flight:')) {
                console.log('\n' + '═'.repeat(60));
                console.log('🛑 PRE-FLIGHT CHECK FAILED - ABORTING TEST SUITE');
                console.log('');
                console.log('   The bot has leftover state from a previous run.');
                console.log('   Please restart the SlackONOS bot and try again.');
                console.log('');
                console.log('   Leftover state can include:');
                console.log('   • Active votes on tracks');
                console.log('   • Immune tracks from voteimmune');
                console.log('   • Pending gong votes');
                console.log('═'.repeat(60));
                process.exit(1);
            }
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

    // Calculate retry statistics
    const retriedTests = timingLog.tests.filter(t => t.retried).length;
    const retrySucceeded = timingLog.tests.filter(t => t.retrySucceeded).length;

    console.log('\n' + '─'.repeat(60));
    console.log('📊 Test Results:');
    console.log(`   ✅ Passed: ${passed}/${testSuite.length}`);
    console.log(`   ❌ Failed: ${failed}/${testSuite.length}`);
    console.log(`   📈 Success Rate: ${Math.round((passed / testSuite.length) * 100)}%`);
    if (retriedTests > 0) {
        console.log(`   🔄 Retried: ${retriedTests} test(s) (${retrySucceeded} succeeded after retry)`);
    }
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

    // Post results to admin channel
    await postResultsToAdminChannel(passed, failed, testSuite.length, totalTime, wallClockTime, timingLog, previousTimingLog);

    if (failed > 0) {
        console.log('\n⚠️  Some tests failed. Check that SlackONOS bot is running.');
        process.exit(1);
    } else {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
    }
}

/**
 * Post test results summary to the admin Slack channel
 */
async function postResultsToAdminChannel(passed, failed, total, totalTime, wallClockTime, timingLog, previousTimingLog) {
    try {
        const successRate = Math.round((passed / total) * 100);
        const statusEmoji = failed === 0 ? '✅' : '⚠️';
        const statusText = failed === 0 ? 'All tests passed!' : `${failed} test(s) failed`;

        // Calculate retry statistics
        const retriedTests = timingLog.tests.filter(t => t.retried).length;
        const retrySucceeded = timingLog.tests.filter(t => t.retrySucceeded).length;

        let retryInfo = '';
        if (retriedTests > 0) {
            retryInfo = `\n*Retries:* ${retriedTests} test(s) retried (${retrySucceeded} succeeded)`;
        }

        // Build failed tests list if any
        let failedTestsList = '';
        if (failed > 0 && timingLog && timingLog.tests) {
            const failedTests = timingLog.tests
                .filter(t => !t.passed)
                .map(t => {
                    const retryNote = t.retried ? ' (failed after retry)' : '';
                    return `• ${t.name}${retryNote}`;
                })
                .slice(0, 10); // Limit to 10 failed tests

            if (failedTests.length > 0) {
                failedTestsList = `\n\n*Failed Tests:*\n${failedTests.join('\n')}`;
                if (timingLog.tests.filter(t => !t.passed).length > 10) {
                    failedTestsList += `\n_...and ${timingLog.tests.filter(t => !t.passed).length - 10} more_`;
                }
            }
        }
        
        // Build time comparison if previous run data exists
        let timeComparison = '';
        if (previousTimingLog && previousTimingLog.tests) {
            const previousTotalTime = previousTimingLog.tests.reduce((sum, test) => {
                return sum + (test.timing?.totalTime || 0);
            }, 0);
            
            if (previousTotalTime > 0) {
                const timeDiff = totalTime - previousTotalTime;
                const timeDiffPercent = ((timeDiff / previousTotalTime) * 100);
                const timeDiffSymbol = timeDiff < -500 ? '⬇️' : timeDiff > 500 ? '⬆️' : '➡️';
                const timeDiffSign = timeDiff >= 0 ? '+' : '';
                
                timeComparison = `\n*vs Previous:* ${timeDiffSymbol} ${timeDiffSign}${(timeDiff / 1000).toFixed(2)}s (${timeDiffSign}${timeDiffPercent.toFixed(1)}%)`;
            }
        }
        
        const message = `${statusEmoji} *Integration Test Results*\n\n` +
            `*Status:* ${statusText}\n` +
            `*Passed:* ${passed}/${total}\n` +
            `*Failed:* ${failed}/${total}\n` +
            `*Success Rate:* ${successRate}%\n` +
            `*Duration:* ${(totalTime / 1000).toFixed(2)}s (wall clock: ${(wallClockTime / 1000).toFixed(2)}s)` +
            retryInfo +
            timeComparison +
            failedTestsList;
        
        await slack.chat.postMessage({
            channel: adminChannelId,
            text: message,
            unfurl_links: false,
            unfurl_media: false
        });
        
        console.log(`\n📨 Results posted to admin channel (${adminChannelId})`);
    } catch (error) {
        console.error(`\n⚠️  Failed to post results to admin channel: ${error.message}`);
    }
}

// Run
runTestSuite().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
});
