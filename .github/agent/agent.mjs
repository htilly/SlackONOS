import { execSync } from "child_process";
import fs from "fs";

/**
 * AICODE Agent - Autonomous code modification agent for SlackONOS
 *
 * This agent uses AI (Claude, OpenAI, or Gemini) to generate code changes
 * based on natural language task descriptions from Slack admins.
 *
 * Key Features:
 * - Multi-provider AI support (Claude Sonnet 4.5 default)
 * - Safety checks (forbidden files, line limits, security patterns)
 * - Robust patch application with multiple fallback strategies
 * - Slack notifications for success/failure
 * - Automatic PR creation when tests pass
 *
 * Patch Application Strategies (tried in order):
 * 1. Standard git apply
 * 2. git apply --unidiff-zero (for exact line matching)
 * 3. git apply --ignore-whitespace (for whitespace variations)
 * 4. patch -p1 command (traditional Unix patch)
 */

// Support multiple AI providers
const provider = process.env.AI_PROVIDER || "claude"; // claude, openai, or gemini
const task = process.env.TASK || "Improve code quality";
const requester = process.env.REQUESTER || "unknown";
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
const runId = process.env.GITHUB_RUN_ID;

// Initialize AI client based on provider
let aiClient = null;
let aiModel = null;

if (provider === "claude") {
  // Claude (Anthropic) - FREE tier available!
  const { Anthropic } = await import("@anthropic-ai/sdk");
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error("[AGENT] ANTHROPIC_API_KEY or CLAUDE_API_KEY not set");
    process.exit(1);
  }
  aiClient = new Anthropic({ apiKey });
  aiModel = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
  
  // Validate model name format (warn if incorrect)
  if (aiModel.includes("claude-4-5") || aiModel.includes("claude-3-5")) {
    // Check for common incorrect formats
    if (aiModel.match(/claude-[0-9]-[0-9]-sonnet/)) {
      console.warn(`[AGENT] WARNING: Model name "${aiModel}" appears to be in incorrect format.`);
      console.warn(`[AGENT] Correct format: claude-sonnet-4-5 (not claude-4-5-sonnet)`);
      console.warn(`[AGENT] See: https://platform.claude.com/docs/en/about-claude/models/overview`);
    }
  }
  
  console.log(`[AGENT] Using Claude (Anthropic) with model: ${aiModel}`);
} else if (provider === "openai") {
  // OpenAI (original)
  const { default: OpenAI } = await import("openai");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[AGENT] OPENAI_API_KEY not set");
    process.exit(1);
  }
  aiClient = new OpenAI({ apiKey });
  aiModel = process.env.OPENAI_MODEL || "gpt-4o";
  console.log(`[AGENT] Using OpenAI with model: ${aiModel}`);
  } else if (provider === "gemini") {
    // Google Gemini - FREE tier available!
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error("[AGENT] GEMINI_API_KEY or GOOGLE_API_KEY not set");
      process.exit(1);
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    aiModel = process.env.GEMINI_MODEL || "gemini-1.5-pro";
    aiClient = genAI.getGenerativeModel({ model: aiModel });
    console.log(`[AGENT] Using Google Gemini with model: ${aiModel}`);
} else {
  console.error(`[AGENT] Unknown provider: ${provider}. Use: claude, openai, or gemini`);
  process.exit(1);
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    // Capture stderr and stdout for better error messages
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    const errorOutput = stderr || stdout || err.message;
    
    // Create enhanced error with actual command output
    const enhancedError = new Error(`Command failed: ${cmd}\n${errorOutput}`);
    enhancedError.stderr = stderr;
    enhancedError.stdout = stdout;
    enhancedError.status = err.status;
    enhancedError.code = err.code;
    throw enhancedError;
  }
}

/**
 * Validate diff format and syntax
 * @param {string} diff - The diff content to validate
 * @returns {Object} Validation result with isValid and errors array
 */
function validateDiff(diff) {
  const errors = [];
  
  // Check for basic diff format markers
  if (!diff.includes("--- a/") || !diff.includes("+++ b/")) {
    errors.push("Missing required diff markers (--- a/ or +++ b/)");
    return { isValid: false, errors };
  }
  
  // Parse hunks and validate format
  const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  const hunks = diff.match(hunkPattern);
  
  if (!hunks || hunks.length === 0) {
    errors.push("No valid hunk headers found (expected @@ -start,num +start,num @@ format)");
  }
  
  // Check for potential conflicts (same line modified differently)
  const fileChanges = new Map();
  const lines = diff.split('\n');
  let currentFile = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Track which file we're in
    if (line.startsWith('--- a/')) {
      currentFile = line.substring(6).trim();
      if (!fileChanges.has(currentFile)) {
        fileChanges.set(currentFile, { additions: [], deletions: [] });
      }
    }
    
    // Track line numbers being changed
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match && currentFile) {
        const oldStart = parseInt(match[1]);
        const oldCount = parseInt(match[2] || '1');
        const newStart = parseInt(match[3]);
        const newCount = parseInt(match[4] || '1');
        
        // Validate line numbers are positive
        if (oldStart <= 0 || newStart <= 0) {
          errors.push(`Invalid line numbers in hunk at line ${i + 1}: ${line}`);
        }
      }
    }
    
    // Check for whitespace-only changes
    if ((line.startsWith('+') || line.startsWith('-')) && line.length > 1) {
      const content = line.substring(1);
      if (content.trim().length === 0 && content.length > 0) {
        // This is a whitespace-only change, which is acceptable but log it
        console.log(`[VALIDATION] Whitespace-only change detected at line ${i + 1}`);
      }
    }
  }
  
  // Validate that files exist in repo (basic check)
  for (const [filePath] of fileChanges) {
    if (filePath.startsWith('a/') || filePath.startsWith('b/')) {
      const cleanPath = filePath.replace(/^[ab]\//, '');
      if (!fs.existsSync(cleanPath)) {
        // File doesn't exist - might be a new file, which is OK
        console.log(`[VALIDATION] File ${cleanPath} doesn't exist (might be new file)`);
      }
    }
  }
  
  // Check for incomplete file sections (critical validation)
  const fileSections = diff.split(/^--- a\//gm);
  for (let i = 1; i < fileSections.length; i++) {
    const section = fileSections[i];
    const lines = section.split('\n');
    
    // First line should be the file path, second should be +++ b/path
    if (lines.length < 2) {
      errors.push(`Incomplete file section starting at line ${diff.substring(0, diff.indexOf(section)).split('\n').length + 1}: missing +++ b/ line`);
      continue;
    }
    
    const oldPath = lines[0].trim();
    const newPathLine = lines[1];
    
    if (!newPathLine.startsWith('+++ b/')) {
      errors.push(`Incomplete file section for ${oldPath}: missing or malformed +++ b/ line`);
      continue;
    }
    
    const newPath = newPathLine.substring(6).trim();
    
    // Check if the path is complete (not truncated)
    if (!newPath || newPath.length < 3 || newPath.includes('\n') || newPath.match(/^[a-z]$/i)) {
      errors.push(`Incomplete +++ b/ line detected: "${newPathLine}" - file name appears to be truncated or missing`);
      continue;
    }
    
    // Check if the section has at least one hunk
    const hasHunk = section.includes('@@');
    if (!hasHunk && !section.includes('new file') && !section.includes('deleted file')) {
      errors.push(`File section for ${oldPath} has no hunks (might be incomplete)`);
    }
    
    // Check if section ends properly (not mid-line)
    const lastLine = lines[lines.length - 1];
    if (lastLine && (lastLine.startsWith('+') || lastLine.startsWith('-') || lastLine.startsWith('\\'))) {
      // Section might be cut off
      const nextSectionStart = diff.indexOf('--- a/', diff.indexOf(section) + section.length);
      if (nextSectionStart === -1 && !lastLine.match(/^[\s+-\\]/)) {
        // Last line doesn't look like a proper diff line ending
        errors.push(`File section for ${oldPath} appears to be cut off (incomplete diff)`);
      }
    }
  }
  
  // Check for incomplete +++ b/ lines (common issue)
  const incompletePlusPlus = diff.match(/\+\+\+ b\/[^\n]*$/m);
  if (incompletePlusPlus) {
    errors.push(`Incomplete +++ b/ line detected at end of diff (file name missing)`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    stats: {
      filesChanged: fileChanges.size,
      hunks: hunks ? hunks.length : 0
    }
  };
}

/**
 * Detect code quality issues in generated diff
 * @param {string} diff - The diff content to check
 * @returns {Array} Array of detected issues
 */
function detectCodeQualityIssues(diff) {
  const issues = [];
  const lines = diff.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Only check added lines (lines starting with +)
    if (!line.startsWith('+')) continue;
    
    const content = line.substring(1);
    
    // Check for console.log (should use logger)
    if (content.includes('console.log') && !content.includes('//') && !content.includes('*')) {
      issues.push({
        type: 'code_quality',
        severity: 'warning',
        line: i + 1,
        message: 'console.log detected - should use logger instead',
        code: content.trim().substring(0, 50)
      });
    }
    
    // Check for ES6 imports in main code (should use CommonJS)
    if (content.match(/^import\s+.*from\s+['"]/) && !line.includes('.mjs')) {
      // Allow in .mjs files, but not in .js files
      const fileMatch = diff.substring(0, diff.indexOf(line)).match(/^\+\+\+ b\/(.+)$/m);
      if (fileMatch && fileMatch[1] && fileMatch[1].endsWith('.js') && !fileMatch[1].endsWith('.mjs')) {
        issues.push({
          type: 'code_quality',
          severity: 'error',
          line: i + 1,
          message: 'ES6 import detected in .js file - should use CommonJS require()',
          code: content.trim().substring(0, 50)
        });
      }
    }
    
    // Check for eval() or Function() constructor (security risk)
    if (content.match(/\beval\s*\(/) || content.match(/\bFunction\s*\(/)) {
      issues.push({
        type: 'security',
        severity: 'error',
        line: i + 1,
        message: 'eval() or Function() constructor detected - security risk',
        code: content.trim().substring(0, 50)
      });
    }
    
    // Check for hardcoded secrets/tokens (basic pattern matching)
    const secretPatterns = [
      /['"](?:sk-|ghp_|xoxb-|AIza|AKIA)[a-zA-Z0-9_-]{20,}/,
      /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]{10,}['"]/i,
      /token\s*[:=]\s*['"][^'"]{20,}['"]/i
    ];
    
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: 'security',
          severity: 'error',
          line: i + 1,
          message: 'Potential hardcoded secret/token detected',
          code: content.trim().substring(0, 50).replace(/['"].{20,}/g, '[REDACTED]')
        });
        break; // Only report once per line
      }
    }
  }
  
  return issues;
}

/**
 * Enhanced security pattern checking
 * @param {string} diff - The diff content to check
 * @returns {Array} Array of security violations
 */
function checkSecurityPatterns(diff) {
  const violations = [];
  
  // Extended forbidden patterns with regex
  const securityPatterns = [
    {
      pattern: /webauthn-handler\.js/,
      message: 'Cannot modify webauthn-handler.js (security-critical)'
    },
    {
      pattern: /auth-handler\.js/,
      message: 'Cannot modify auth-handler.js (security-critical)'
    },
    {
      pattern: /config\/config\.json$/,
      message: 'Cannot modify config/config.json (contains secrets)'
    },
    {
      pattern: /config\/userActions\.json/,
      message: 'Cannot modify config/userActions.json (protected config)'
    },
    {
      pattern: /config\/webauthn-credentials\.json/,
      message: 'Cannot modify config/webauthn-credentials.json (security-critical)'
    },
    {
      pattern: /\.env/,
      message: 'Cannot modify .env files (may contain secrets)'
    },
    {
      pattern: /process\.env\.(?:GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|SLACK.*TOKEN|DISCORD.*TOKEN)/,
      message: 'Cannot directly access sensitive environment variables'
    }
  ];
  
  for (const { pattern, message } of securityPatterns) {
    if (pattern.test(diff)) {
      violations.push({
        type: 'security',
        severity: 'error',
        message,
        pattern: pattern.toString()
      });
    }
  }
  
  return violations;
}

// Send error notification to Slack with enhanced details
async function notifySlackError(errorMessage, errorType = "Unknown error", errorDetails = null) {
  if (!webhookUrl) {
    console.log("[AGENT] No SLACK_WEBHOOK_URL configured, skipping notification");
    return;
  }

  const errorEmoji = errorType.includes("quota") ? "💳" : errorType.includes("security") ? "🔒" : "❌";
  
  // Build detailed error message
  let detailedMessage = `${errorEmoji} *AICODE Agent Failed*\n\n*Task:* ${task}\n*Requested by:* ${requester}\n*Error Type:* ${errorType}\n\n${errorMessage}`;
  
  if (errorDetails) {
    if (errorDetails.category) {
      detailedMessage += `\n\n*Category:* ${errorDetails.category}`;
    }
    if (errorDetails.suggestions && errorDetails.suggestions.length > 0) {
      detailedMessage += `\n\n*Suggestions:*\n${errorDetails.suggestions.map(s => `• ${s}`).join('\n')}`;
    }
    if (errorDetails.filesChanged) {
      detailedMessage += `\n\n*Files changed:* ${errorDetails.filesChanged}`;
    }
    if (errorDetails.diffPreview) {
      detailedMessage += `\n\n*Diff preview:*\n\`\`\`\n${errorDetails.diffPreview}\n\`\`\``;
    }
  }
  
  const message = {
    text: `${errorEmoji} AICODE Agent Failed`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: detailedMessage
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<https://github.com/htilly/SlackONOS/actions/runs/${runId}|View GitHub Actions logs>`
        }
      }
    ]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    if (!response.ok) {
      console.error(`[AGENT] Failed to send Slack notification: ${response.status}`);
    } else {
      console.log("[AGENT] Error notification sent to Slack");
    }
  } catch (err) {
    console.error(`[AGENT] Error sending Slack notification: ${err.message}`);
  }
}

// Handle errors and exit gracefully
async function handleError(error, errorType = "Unknown error", context = {}) {
  let errorMessage = error.message || String(error);
  
  // Format error details
  const errorDetails = formatErrorDetails(error, context);
  
  // Override error type if we have more specific information
  if (errorDetails.type !== 'unknown') {
    errorType = `${errorType}: ${errorDetails.type}`;
  }
  
  // Format quota errors more clearly
  if (error.code === "insufficient_quota" || error.type === "insufficient_quota") {
    errorType = `${provider.toUpperCase()} API Quota Exceeded`;
    if (provider === "claude") {
      errorMessage = "You exceeded your Anthropic API quota. Check billing at https://console.anthropic.com/";
    } else if (provider === "openai") {
      errorMessage = "You exceeded your OpenAI API quota. Check billing at https://platform.openai.com/account/billing";
    } else {
      errorMessage = "You exceeded your API quota. Please check your plan and billing details.";
    }
    errorDetails.category = 'api';
    errorDetails.type = 'quota_exceeded';
  } else if (error.status === 429 || error.statusCode === 429) {
    errorType = `${provider.toUpperCase()} API Rate Limit`;
    errorMessage = "API rate limit exceeded. Please try again later.";
    errorDetails.category = 'api';
    errorDetails.type = 'rate_limit';
  } else if (error.status === 401 || error.statusCode === 401) {
    errorType = `${provider.toUpperCase()} API Authentication Failed`;
    if (provider === "claude") {
      errorMessage = "Invalid Anthropic API key. Please check your GitHub secrets (ANTHROPIC_API_KEY or CLAUDE_API_KEY).";
    } else if (provider === "openai") {
      errorMessage = "Invalid OpenAI API key. Please check your GitHub secrets (OPENAI_API_KEY).";
    } else {
      errorMessage = "Invalid API key. Please check your GitHub secrets.";
    }
    errorDetails.category = 'api';
    errorDetails.type = 'authentication';
  }

  console.error(`[AGENT] ${errorType}: ${errorMessage}`);
  if (error.stack && process.env.DEBUG) {
    console.error(`[AGENT] Stack trace: ${error.stack}`);
  }
  
  // Send notification to Slack with detailed error information
  await notifySlackError(errorMessage, errorType, errorDetails);
  
  process.exit(1);
}

console.log(`[AGENT] Starting AI code agent for task: ${task}`);
console.log(`[AGENT] Requested by: ${requester}`);

// Verify we're on the develop branch
try {
  const currentBranch = sh("git branch --show-current 2>&1").trim();
  console.log(`[AGENT] Current branch: ${currentBranch}`);
  if (currentBranch !== 'develop') {
    console.warn(`[AGENT] WARNING: Not on develop branch (current: ${currentBranch}). Workflow should checkout develop.`);
  }
} catch (e) {
  console.warn(`[AGENT] Could not determine current branch: ${e.message}`);
}

/**
 * Select relevant files based on task description
 * @param {string} task - The task description
 * @param {Array} fileList - List of all files in repo
 * @returns {Array} Prioritized list of relevant files
 */
function selectRelevantFiles(task, fileList) {
  const taskLower = task.toLowerCase();
  const relevantFiles = new Set();
  
  // Keyword to file mapping
  const keywordMap = {
    'spotify': ['spotify-async.js', 'lib/spotify-validator.js', 'music-helper.js'],
    'discord': ['discord.js'],
    'slack': ['slack.js'],
    'sonos': ['index.js'], // Sonos logic is in index.js
    'vote': ['voting.js', 'index.js'],
    'gong': ['voting.js', 'index.js'],
    'admin': ['public/setup/admin.js', 'public/setup/admin.html', 'lib/auth-handler.js'],
    'auth': ['lib/auth-handler.js', 'lib/webauthn-handler.js'],
    'ai': ['ai-handler.js'],
    'soundcraft': ['soundcraft-handler.js'],
    'help': ['templates/help/', 'index.js'],
    'web': ['public/setup/', 'public/'],
    'config': ['index.js'], // Config handling is in index.js
    'queue': ['music-helper.js', 'index.js'],
    'search': ['spotify-async.js', 'music-helper.js', 'index.js']
  };
  
  // Find relevant files based on keywords
  for (const [keyword, files] of Object.entries(keywordMap)) {
    if (taskLower.includes(keyword)) {
      for (const file of files) {
        // Check if file exists in fileList
        const matchingFiles = fileList.filter(f => 
          f.includes(file) || f.endsWith(file)
        );
        matchingFiles.forEach(f => relevantFiles.add(f));
      }
    }
  }
  
  // Also check for direct file mentions
  for (const file of fileList) {
    const fileName = file.split('/').pop();
    if (taskLower.includes(fileName.toLowerCase().replace(/\.(js|mjs|json)$/, ''))) {
      relevantFiles.add(file);
    }
  }
  
  return Array.from(relevantFiles);
}

/**
 * Fetch relevant GitHub context (PRs, issues, commits)
 * @param {string} task - The task description
 * @returns {Object} GitHub context with PRs, issues, and recent commits
 */
async function fetchGitHubContext(task) {
  const context = {
    prs: [],
    issues: [],
    recentCommits: [],
    error: null
  };
  
  // Only fetch if GITHUB_TOKEN is available (it should be in GitHub Actions)
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.log("[AGENT] GITHUB_TOKEN not available, skipping GitHub context fetch");
    return context;
  }
  
  const repo = process.env.GITHUB_REPOSITORY || 'htilly/SlackONOS';
  const apiBase = `https://api.github.com/repos/${repo}`;
  
  try {
    // Fetch open PRs (limit to 5 most recent)
    const prResponse = await fetch(`${apiBase}/pulls?state=open&per_page=5&sort=updated`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (prResponse.ok) {
      const prs = await prResponse.json();
      context.prs = prs.map(pr => ({
        number: pr.number,
        title: pr.title,
        body: pr.body?.substring(0, 200),
        url: pr.html_url
      }));
      console.log(`[AGENT] Found ${prs.length} open PRs`);
    }
    
    // Fetch recent commits in relevant files (if we can determine them)
    const commitsResponse = await fetch(`${apiBase}/commits?per_page=10`, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    
    if (commitsResponse.ok) {
      const commits = await commitsResponse.json();
      context.recentCommits = commits.map(commit => ({
        sha: commit.sha.substring(0, 7),
        message: commit.commit.message.split('\n')[0],
        author: commit.commit.author.name,
        date: commit.commit.author.date,
        url: commit.html_url
      }));
      console.log(`[AGENT] Found ${commits.length} recent commits`);
    }
    
  } catch (error) {
    console.log(`[AGENT] Error fetching GitHub context: ${error.message}`);
    context.error = error.message;
  }
  
  return context;
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay in milliseconds
 * @returns {Promise} Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable (transient errors)
      const isRetryable = 
        error.status === 429 || // Rate limit
        error.status === 500 || // Internal server error
        error.status === 502 || // Bad gateway
        error.status === 503 || // Service unavailable
        error.statusCode === 429 ||
        error.statusCode === 500 ||
        error.statusCode === 502 ||
        error.statusCode === 503 ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';
      
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      const delay = initialDelay * Math.pow(2, attempt);
      console.log(`[AGENT] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms delay`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Format detailed error information
 * @param {Error} error - The error object
 * @param {Object} context - Additional context (diff, files, etc.)
 * @returns {Object} Formatted error details
 */
function formatErrorDetails(error, context = {}) {
  const details = {
    type: 'unknown',
    message: error.message || String(error),
    stack: error.stack,
    category: 'unknown',
    suggestions: []
  };
  
  // Categorize error
  if (error.message?.includes('diff') || error.message?.includes('patch')) {
    details.category = 'validation';
    details.type = 'diff_validation';
    details.suggestions = [
      'Check that the diff format is correct (unified diff format)',
      'Verify that line numbers match the actual file contents',
      'Ensure context lines are included around changes'
    ];
  } else if (error.message?.includes('apply') || error.message?.includes('git apply')) {
    details.category = 'patch';
    details.type = 'patch_application';
    details.suggestions = [
      'The generated diff may not match the current file state',
      'Try re-running the agent - files may have changed',
      'Check if there are merge conflicts or uncommitted changes'
    ];
  } else if (error.status === 429 || error.statusCode === 429) {
    details.category = 'api';
    details.type = 'rate_limit';
    details.suggestions = [
      'Wait a few minutes and try again',
      'Check your API quota/billing',
      'Consider using a different AI provider'
    ];
  } else if (error.status === 401 || error.statusCode === 401) {
    details.category = 'api';
    details.type = 'authentication';
    details.suggestions = [
      'Verify your API key is correct',
      'Check that the API key has not expired',
      'Ensure the API key has the required permissions'
    ];
  } else if (error.message?.includes('test') || error.message?.includes('npm test')) {
    details.category = 'test';
    details.type = 'test_failure';
    details.suggestions = [
      'Review the generated code changes',
      'Check test output for specific failures',
      'The changes may need manual adjustment'
    ];
  }
  
  // Add context-specific information
  if (context.diff) {
    details.diffPreview = context.diff.substring(0, 500);
    details.filesChanged = (context.diff.match(/^\+\+\+ b\//gm) || []).length;
  }
  
  if (context.files) {
    details.files = context.files;
  }
  
  return details;
}

// Get repo context
const files = sh("git ls-files");
const recentCommits = sh("git log --oneline -10");

// Read cursor rules for context
let cursorRules = "";
try {
  cursorRules = fs.readFileSync(".cursorrules", "utf8");
} catch (e) {
  console.log("[AGENT] No .cursorrules file found");
}

// Include all code files while excluding docs, images, and large files
// Prioritize frequently-changed files to stay under 200K token limit
let codebaseContent = "";
const fileList = files.split("\n").filter(f => f.trim());

// Most frequently modified files (from git history analysis)
// These are always included first
const priorityFiles = [
  'index.js',
  'ai-handler.js',
  'discord.js',
  'spotify-async.js',
  'soundcraft-handler.js',
  'slack.js',
  'lib/spotify-validator.js',
  'lib/webauthn-handler.js',
  'public/setup/admin.js',
  'public/setup/admin.html',
  'templates/help/helpTextAdmin.txt',
  'templates/help/helpText.txt',
];

// Include code files, exclude non-code
const includedExtensions = ['.js', '.mjs', '.json', '.txt', '.html', '.css', '.yml', '.yaml'];
const excludedPaths = [
  'node_modules/',
  'package-lock.json',
  '.git/',
  'coverage/',
  'dist/',
  'build/',
  'docs/',
  'README.md',
  'CHANGELOG.md',
  '.github/workflows/',
  'test/',
  'build.txt',
];

// Fetch GitHub context for better prompt
console.log("[AGENT] Fetching GitHub context...");
const githubContext = await fetchGitHubContext(task);

// Intelligent file selection based on task
console.log("[AGENT] Selecting relevant files based on task...");
const relevantFiles = selectRelevantFiles(task, fileList);
console.log(`[AGENT] Identified ${relevantFiles.length} relevant files based on task keywords`);

console.log("[AGENT] Loading codebase files...");
let filesIncluded = 0;
let totalSize = 0;
const includedFiles = new Set();

// First pass: Include priority files
for (const filePath of priorityFiles) {
  if (!fileList.includes(filePath)) continue;

  try {
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    codebaseContent += `\n\n=== ${filePath} ===\n${content}`;
    filesIncluded++;
    totalSize += stats.size;
    includedFiles.add(filePath);
    console.log(`[AGENT] Priority: ${filePath} (${Math.round(stats.size / 1024)} KB)`);
  } catch (e) {
    // Skip if can't read
  }
}

// Second pass: Include task-relevant files (prioritize these)
for (const filePath of relevantFiles) {
  if (includedFiles.has(filePath)) continue;
  if (!fileList.includes(filePath)) continue;
  
  // Skip excluded paths
  if (excludedPaths.some(excluded => filePath.includes(excluded))) {
    continue;
  }

  try {
    const stats = fs.statSync(filePath);
    
    // Skip very large files
    if (stats.size > 80000) {
      console.log(`[AGENT] Skipping large relevant file: ${filePath} (${stats.size} bytes)`);
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    codebaseContent += `\n\n=== ${filePath} ===\n${content}`;
    filesIncluded++;
    totalSize += stats.size;
    includedFiles.add(filePath);
    console.log(`[AGENT] Task-relevant: ${filePath} (${Math.round(stats.size / 1024)} KB)`);
  } catch (e) {
    // Skip if can't read
  }
}

// Third pass: Include other code files (skip if exceeds limit)
for (const filePath of fileList) {
  if (includedFiles.has(filePath)) continue;

  // Skip excluded paths
  if (excludedPaths.some(excluded => filePath.includes(excluded))) {
    continue;
  }

  // Skip if not code extension
  if (!includedExtensions.some(ext => filePath.endsWith(ext))) {
    continue;
  }

  try {
    const stats = fs.statSync(filePath);

    // Skip very large files
    if (stats.size > 80000) {
      console.log(`[AGENT] Skipping large file: ${filePath} (${stats.size} bytes)`);
      continue;
    }

    // Stop if we're approaching token limit (~600KB ≈ 150K tokens)
    if (totalSize > 600000) {
      console.log(`[AGENT] Reached size limit, skipping remaining files`);
      break;
    }

    const content = fs.readFileSync(filePath, "utf8");
    codebaseContent += `\n\n=== ${filePath} ===\n${content}`;
    filesIncluded++;
    totalSize += stats.size;
  } catch (e) {
    // Skip files we can't read
  }
}

console.log(`[AGENT] Included ${filesIncluded} code files (${Math.round(totalSize / 1024)} KB total)`);

// Build specialized prompt for SlackONOS with enhanced context
let githubContextText = '';
if (githubContext.prs.length > 0) {
  githubContextText += `\n\nOPEN PULL REQUESTS (for context):\n`;
  githubContext.prs.forEach(pr => {
    githubContextText += `- PR #${pr.number}: ${pr.title}\n`;
    if (pr.body) {
      githubContextText += `  ${pr.body.substring(0, 150)}...\n`;
    }
  });
}

if (githubContext.recentCommits.length > 0) {
  githubContextText += `\n\nRECENT COMMITS:\n`;
  githubContext.recentCommits.slice(0, 5).forEach(commit => {
    githubContextText += `- ${commit.sha}: ${commit.message} (${commit.author})\n`;
  });
}

const prompt = `You are an autonomous coding agent for SlackONOS, a democratic music bot for Discord and Slack that controls Sonos speakers.

CRITICAL SAFETY RULES:
- Output ONLY a valid unified git diff format
- DO NOT modify authentication files (webauthn-handler.js, auth-handler.js)
- DO NOT modify config handling (config/*)
- DO NOT modify security-critical code
- Small, focused changes only (max 300 lines changed)
- Follow existing code style (CommonJS, async/await, logger for logging)
- NEVER use console.log in production code, use logger instead
- NEVER use ES6 imports in .js files (use CommonJS require/module.exports)
- NEVER hardcode secrets, tokens, or API keys
- Test your changes mentally before outputting the diff

CODEBASE CONTEXT:

Project Rules and Conventions:
${cursorRules}

Recent Commits:
${recentCommits}${githubContextText}

COMPLETE CODEBASE (use these exact contents for accurate diffs):
${codebaseContent}

TASK FROM ADMIN (${requester}):
${task}

CHAIN OF THOUGHT:
1. Analyze the task and identify which files need to be modified
2. Review the existing code structure and patterns
3. Plan the changes to follow existing code style
4. Generate a minimal, focused diff with proper context
5. Verify the diff format is correct before outputting

CRITICAL: Generate ONLY the file changes in this EXACT format (no "diff --git" headers, no index lines, no hashes):

--- a/path/to/file.js
+++ b/path/to/file.js
@@ -10,6 +10,7 @@
 existing line
 another existing line
+new line to add
 existing line

Rules for the diff format:
1. Start each file with "--- a/filepath" and "+++ b/filepath" (BOTH lines must be complete with full file path)
2. NO "diff --git" line, NO "index" line with hashes
3. Include enough context lines (unchanged lines) around changes
4. Use @@ -startLine,numLines +startLine,numLines @@ for hunks
5. Prefix added lines with "+", removed lines with "-", context lines with " " (space)
6. Include at least 3 lines of context before and after changes
7. Ensure line numbers match the actual file contents exactly
8. CRITICAL: The diff MUST be complete - every file section must have BOTH "--- a/path" AND "+++ b/path" lines with complete file paths
9. CRITICAL: Do NOT truncate the diff - if you reach token limits, prioritize completing fewer files rather than truncating
10. Each file section must end properly - do not cut off mid-line or mid-hunk

Output ONLY the complete diff content, no explanations, no markdown code blocks. Ensure every file section is fully complete.`;

// Call AI provider with unified interface
async function callAI(promptText) {
  if (provider === "claude") {
    const response = await aiClient.messages.create({
      model: aiModel,
      max_tokens: 180000, // Increased to 180K for very large diffs (note: actual limit depends on context window)
      temperature: 0.2,
      messages: [{ role: "user", content: promptText }],
    });
    return response.content[0].text;
  } else if (provider === "openai") {
    const response = await aiClient.chat.completions.create({
      model: aiModel,
      temperature: 0.2,
      messages: [{ role: "user", content: promptText }],
    });
    return response.choices[0].message.content;
  } else if (provider === "gemini") {
    const result = await aiClient.generateContent({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: { temperature: 0.2 },
    });
    return result.response.text();
  }
}

console.log(`[AGENT] Calling ${provider.toUpperCase()} API...`);
const apiStartTime = Date.now();
let output;
try {
  output = await retryWithBackoff(async () => {
    return await callAI(prompt);
  }, 3, 1000);
  const apiDuration = Date.now() - apiStartTime;
  console.log(`[AGENT] API call completed in ${apiDuration}ms`);
} catch (error) {
  const errorDetails = formatErrorDetails(error, {});
  await handleError(error, `${provider.toUpperCase()} API Error`, { errorDetails });
  // handleError calls process.exit(1), so we never reach here
}

// Extract diff from potential markdown code blocks
let diff = output.trim();
if (output.includes("```")) {
  // Try to extract content between code fences
  // Handle both single and multiple code blocks
  const matches = output.matchAll(/```(?:diff)?\n([\s\S]*?)```/g);
  const extractedDiffs = [];
  for (const match of matches) {
    extractedDiffs.push(match[1].trim());
  }
  // Use the longest extracted diff (likely the actual diff)
  if (extractedDiffs.length > 0) {
    diff = extractedDiffs.reduce((a, b) => a.length > b.length ? a : b);
  }
  
  // If no code blocks found but output contains diff markers, use the whole output
  if (!diff.includes("--- a/") && output.includes("--- a/")) {
    // Extract everything after the first "--- a/" line
    const diffStart = output.indexOf("--- a/");
    diff = output.substring(diffStart).trim();
    // Remove any trailing markdown or explanations
    const diffEnd = diff.indexOf("\n\n```") !== -1 ? diff.indexOf("\n\n```") : 
                    diff.indexOf("\n\n##") !== -1 ? diff.indexOf("\n\n##") :
                    diff.indexOf("\n\n**") !== -1 ? diff.indexOf("\n\n**") :
                    diff.length;
    diff = diff.substring(0, diffEnd).trim();
  }
}

// Enhanced diff validation
console.log("[AGENT] Validating diff format...");
const validationResult = validateDiff(diff);

// Check if diff appears to be truncated
const diffLength = diff.length;
const lastLines = diff.split('\n').slice(-5).join('\n');
if (validationResult.errors.length > 0 || diff.match(/\+\+\+ b\/[^\n]*$/m)) {
  console.warn(`[AGENT] WARNING: Diff validation found issues or appears incomplete`);
  console.warn(`[AGENT] Diff length: ${diffLength} characters`);
  console.warn(`[AGENT] Last 5 lines:\n${lastLines}`);
  
  // Try to detect if this is a token limit issue
  if (diffLength > 7000 && diff.match(/\+\+\+ b\/[^\n]*$/m)) {
    const errorMsg = `Diff appears to be truncated (likely hit token limit). The AI model may have generated an incomplete diff.\n\nErrors:\n${validationResult.errors.join('\n')}\n\nDiff preview (last 500 chars):\n\`\`\`\n${diff.substring(Math.max(0, diffLength - 500))}\n\`\`\`\n\nSuggestion: Try breaking the task into smaller parts or increase max_tokens.`;
    const errorDetails = formatErrorDetails(new Error(errorMsg), { diff: diff.substring(Math.max(0, diffLength - 1000)), files: validationResult.stats.filesChanged });
    await handleError(new Error(errorMsg), "Incomplete Diff (Token Limit?)", { diff: diff.substring(Math.max(0, diffLength - 1000)), errorDetails });
    // handleError calls process.exit(1), so we never reach here
  }
}

if (!validationResult.isValid) {
  const errorMsg = `Invalid diff format:\n${validationResult.errors.join('\n')}\n\nDiff preview (first 1000 chars):\n\`\`\`\n${diff.substring(0, 1000)}\n\`\`\`\n\nDiff preview (last 500 chars):\n\`\`\`\n${diff.substring(Math.max(0, diffLength - 500))}\n\`\`\``;
  const errorDetails = formatErrorDetails(new Error(errorMsg), { diff: diff.substring(0, 1000), files: validationResult.stats.filesChanged });
  await handleError(new Error(errorMsg), "Validation Error", { diff: diff.substring(0, 1000), errorDetails });
  // handleError calls process.exit(1), so we never reach here
}
console.log(`[AGENT] Diff format valid: ${validationResult.stats.filesChanged} files, ${validationResult.stats.hunks} hunks`);

// Enhanced security pattern checking
console.log("[AGENT] Checking security patterns...");
const securityViolations = checkSecurityPatterns(diff);
if (securityViolations.length > 0) {
  const violations = securityViolations.map(v => v.message).join('\n');
  await handleError(
    new Error(`Security violation detected:\n${violations}`),
    "Security Violation",
    { diff: diff.substring(0, 500), violations }
  );
  // handleError calls process.exit(1), so we never reach here
}

// Code quality checks
console.log("[AGENT] Checking code quality...");
const qualityIssues = detectCodeQualityIssues(diff);
if (qualityIssues.length > 0) {
  const errors = qualityIssues.filter(i => i.severity === 'error');
  const warnings = qualityIssues.filter(i => i.severity === 'warning');
  
  if (errors.length > 0) {
    const errorList = errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
    await handleError(
      new Error(`Code quality errors detected:\n${errorList}`),
      "Code Quality Error",
      { diff: diff.substring(0, 500), issues: errors }
    );
    // handleError calls process.exit(1), so we never reach here
  }
  
  if (warnings.length > 0) {
    console.log(`[AGENT] Code quality warnings (${warnings.length}):`);
    warnings.forEach(w => {
      console.log(`  - Line ${w.line}: ${w.message}`);
    });
  }
}

// Count lines changed
const linesChanged = (diff.match(/^[+-][^+-]/gm) || []).length;
if (linesChanged > 300) {
  await handleError(
    new Error(`Too many lines changed (${linesChanged} > 300). Maximum allowed is 300 lines.`),
    "Safety Violation",
    { linesChanged, diff: diff.substring(0, 500) }
  );
  // handleError calls process.exit(1), so we never reach here
}

console.log(`[AGENT] Generated diff with ${linesChanged} lines changed (${validationResult.stats.filesChanged} files)`);

// Apply patch with multiple strategies
fs.writeFileSync("/tmp/aicode.patch", diff);

let patchApplied = false;
let lastError = null;

// Strategy 1: Try with standard git apply
try {
  sh("git apply --check /tmp/aicode.patch 2>&1");
  sh("git apply /tmp/aicode.patch 2>&1");
  console.log("[AGENT] Patch applied successfully with 'git apply'");
  patchApplied = true;
} catch (err) {
  const errorDetails = err.stderr || err.stdout || err.message;
  console.log(`[AGENT] Standard git apply failed:\n${errorDetails}`);
  lastError = err;
}

// Strategy 2: Try with --unidiff-zero for exact line matching
if (!patchApplied) {
  try {
    sh("git apply --unidiff-zero --check /tmp/aicode.patch 2>&1");
    sh("git apply --unidiff-zero /tmp/aicode.patch 2>&1");
    console.log("[AGENT] Patch applied successfully with '--unidiff-zero'");
    patchApplied = true;
  } catch (err) {
    const errorDetails = err.stderr || err.stdout || err.message;
    console.log(`[AGENT] git apply --unidiff-zero failed:\n${errorDetails}`);
    lastError = err;
  }
}

// Strategy 3: Try with more lenient whitespace handling
if (!patchApplied) {
  try {
    sh("git apply --ignore-whitespace --check /tmp/aicode.patch 2>&1");
    sh("git apply --ignore-whitespace /tmp/aicode.patch 2>&1");
    console.log("[AGENT] Patch applied successfully with '--ignore-whitespace'");
    patchApplied = true;
  } catch (err) {
    const errorDetails = err.stderr || err.stdout || err.message;
    console.log(`[AGENT] git apply --ignore-whitespace failed:\n${errorDetails}`);
    lastError = err;
  }
}

// Strategy 4: Try patch command as fallback
if (!patchApplied) {
  try {
    sh("patch -p1 --dry-run < /tmp/aicode.patch 2>&1");
    sh("patch -p1 < /tmp/aicode.patch 2>&1");
    console.log("[AGENT] Patch applied successfully with 'patch' command");
    patchApplied = true;
  } catch (err) {
    const errorDetails = err.stderr || err.stdout || err.message;
    console.log(`[AGENT] patch command failed:\n${errorDetails}`);
    lastError = err;
  }
}

if (!patchApplied) {
  // Get git status and branch info for debugging
  let gitStatus = '';
  let currentBranch = '';
  try {
    gitStatus = sh("git status --short 2>&1");
    currentBranch = sh("git branch --show-current 2>&1").trim();
  } catch (e) {
    gitStatus = 'Could not get git status';
    currentBranch = 'unknown';
  }
  
  // Get actual error output from the last failed command
  const actualError = lastError.stderr || lastError.stdout || lastError.message;
  
  // Read patch file for debugging
  let patchContent = '';
  try {
    patchContent = fs.readFileSync("/tmp/aicode.patch", "utf8");
  } catch (e) {
    patchContent = 'Could not read patch file';
  }
  
  const errorDetails = formatErrorDetails(lastError, { 
    diff: diff.substring(0, 1000),
    files: validationResult.stats.filesChanged
  });
  
  const errorMsg = `Failed to apply patch after trying multiple strategies.

Current branch: ${currentBranch}
Last error output:
${actualError}

Error category: ${errorDetails.category}
Suggestions:
${errorDetails.suggestions.map(s => `- ${s}`).join('\n')}

Git status:
${gitStatus}

Patch file preview (first 2000 chars):
\`\`\`
${patchContent.substring(0, 2000)}
\`\`\``;
  await handleError(new Error(errorMsg), `Patch Application Failed: ${errorDetails.type}`, { 
    diff: patchContent.substring(0, 1000), 
    errorDetails,
    actualError: actualError.substring(0, 500)
  });
  // handleError calls process.exit(1), so we never reach here
}

// Show diff for logs
console.log("\n[AGENT] Generated changes:");
console.log(sh("git diff"));

// Stage changes
sh("git add -A");
sh('git config user.name "AICODE Agent"');
sh('git config user.email "aicode@slackonos.bot"');
sh(`git commit -m "AI: ${task}"`);

console.log("[AGENT] Changes committed, ready for testing");

