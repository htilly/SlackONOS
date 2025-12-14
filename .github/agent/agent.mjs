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
  return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
}

// Send error notification to Slack
async function notifySlackError(errorMessage, errorType = "Unknown error") {
  if (!webhookUrl) {
    console.log("[AGENT] No SLACK_WEBHOOK_URL configured, skipping notification");
    return;
  }

  const errorEmoji = errorType.includes("quota") ? "💳" : "❌";
  const message = {
    text: `${errorEmoji} AICODE Agent Failed`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${errorEmoji} *AICODE Agent Failed*\n\n*Task:* ${task}\n*Requested by:* ${requester}\n*Error:* ${errorType}\n\n${errorMessage}`
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
async function handleError(error, errorType = "Unknown error") {
  let errorMessage = error.message || String(error);
  
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
  } else if (error.status === 429 || error.statusCode === 429) {
    errorType = `${provider.toUpperCase()} API Rate Limit`;
    errorMessage = "API rate limit exceeded. Please try again later.";
  } else if (error.status === 401 || error.statusCode === 401) {
    errorType = `${provider.toUpperCase()} API Authentication Failed`;
    if (provider === "claude") {
      errorMessage = "Invalid Anthropic API key. Please check your GitHub secrets (ANTHROPIC_API_KEY or CLAUDE_API_KEY).";
    } else if (provider === "openai") {
      errorMessage = "Invalid OpenAI API key. Please check your GitHub secrets (OPENAI_API_KEY).";
    } else {
      errorMessage = "Invalid API key. Please check your GitHub secrets.";
    }
  }

  console.error(`[AGENT] ${errorType}: ${errorMessage}`);
  
  // Send notification to Slack
  await notifySlackError(errorMessage, errorType);
  
  process.exit(1);
}

console.log(`[AGENT] Starting AI code agent for task: ${task}`);
console.log(`[AGENT] Requested by: ${requester}`);

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

// Try to identify and read relevant files based on the task
// This helps the AI generate accurate diffs with correct line numbers
let relevantFiles = "";
const taskLower = task.toLowerCase();

// Common file patterns to check based on task keywords
const filePatterns = [
  { keywords: ["help", "admin", "command"], files: ["templates/help/helpTextAdmin.txt", "templates/help/helpText.txt"] },
  { keywords: ["config", "setting"], files: ["config/config.json", "src/config-handler.js"] },
  { keywords: ["slack", "message", "notification"], files: ["src/slack-handler.js", "src/notification-handler.js"] },
  { keywords: ["discord"], files: ["src/discord-handler.js"] },
  { keywords: ["sonos", "speaker", "playback"], files: ["src/sonos-handler.js"] },
  { keywords: ["route", "endpoint", "web", "admin panel"], files: ["src/webserver.js", "public/admin.html"] },
  { keywords: ["queue", "track"], files: ["src/queue-handler.js"] },
  { keywords: ["vote", "voting"], files: ["src/voting-handler.js"] },
];

for (const pattern of filePatterns) {
  if (pattern.keywords.some(keyword => taskLower.includes(keyword))) {
    for (const filePath of pattern.files) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        relevantFiles += `\n\n=== ${filePath} ===\n${content}`;
        console.log(`[AGENT] Including content of ${filePath} for context`);
      } catch (e) {
        // File doesn't exist, skip it
      }
    }
  }
}

// Build specialized prompt for SlackONOS
const prompt = `You are an autonomous coding agent for SlackONOS, a democratic music bot for Discord and Slack that controls Sonos speakers.

CRITICAL SAFETY RULES:
- Output ONLY a valid unified git diff format
- DO NOT modify authentication files (webauthn-handler.js, auth-handler.js)
- DO NOT modify config handling (config/*)
- DO NOT modify security-critical code
- Small, focused changes only (max 300 lines changed)
- Follow existing code style (CommonJS, async/await, logger for logging)
- NEVER use console.log in production code, use logger instead
- Test your changes mentally before outputting the diff

CODEBASE CONTEXT:

Project Rules and Conventions:
${cursorRules}

Repository Files:
${files}

Recent Commits:
${recentCommits}

${relevantFiles ? `RELEVANT FILE CONTENTS (use these for accurate line numbers):\n${relevantFiles}` : ''}

TASK FROM ADMIN (${requester}):
${task}

CRITICAL: Generate ONLY the file changes in this EXACT format (no "diff --git" headers, no index lines, no hashes):

--- a/path/to/file.js
+++ b/path/to/file.js
@@ -10,6 +10,7 @@
 existing line
 another existing line
+new line to add
 existing line

Rules for the diff format:
1. Start each file with "--- a/filepath" and "+++ b/filepath"
2. NO "diff --git" line, NO "index" line with hashes
3. Include enough context lines (unchanged lines) around changes
4. Use @@ -startLine,numLines +startLine,numLines @@ for hunks
5. Prefix added lines with "+", removed lines with "-", context lines with " " (space)
6. Include at least 3 lines of context before and after changes

Output ONLY the diff content, no explanations, no markdown code blocks.`;

// Call AI provider with unified interface
async function callAI(promptText) {
  if (provider === "claude") {
    const response = await aiClient.messages.create({
      model: aiModel,
      max_tokens: 4096,
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
let output;
try {
  output = await callAI(prompt);
} catch (error) {
  await handleError(error, `${provider.toUpperCase()} API Error`);
  // handleError calls process.exit(1), so we never reach here
}

// Extract diff from potential markdown code blocks
let diff = output.trim();
if (output.includes("```")) {
  // Extract content between code fences
  const match = output.match(/```(?:diff)?\n([\s\S]*?)```/);
  if (match) {
    diff = match[1].trim();
  }
}

// Validate diff format - accept either unified diff format
const hasValidDiffFormat = diff.includes("--- a/") && diff.includes("+++ b/");
if (!hasValidDiffFormat) {
  const errorMsg = `Model did not return a valid diff format. Expected "--- a/" and "+++ b/" lines. Output was:\n\`\`\`\n${output.substring(0, 500)}\n\`\`\``;
  await handleError(new Error(errorMsg), "Invalid Diff Format");
  // handleError calls process.exit(1), so we never reach here
}

// Safety check: Ensure we're not touching forbidden files
const forbiddenPatterns = [
  /webauthn-handler\.js/,
  /auth-handler\.js/,
  /config\/config\.json$/,
  /config\/userActions\.json/,
  /config\/webauthn-credentials\.json/
];

for (const pattern of forbiddenPatterns) {
  if (pattern.test(diff)) {
    await handleError(
      new Error(`Attempted to modify forbidden file matching ${pattern}`),
      "Safety Violation"
    );
    // handleError calls process.exit(1), so we never reach here
  }
}

// Count lines changed
const linesChanged = (diff.match(/^[+-][^+-]/gm) || []).length;
if (linesChanged > 300) {
  await handleError(
    new Error(`Too many lines changed (${linesChanged} > 300). Maximum allowed is 300 lines.`),
    "Safety Violation"
  );
  // handleError calls process.exit(1), so we never reach here
}

console.log(`[AGENT] Generated diff with ${linesChanged} lines changed`);

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
  console.log(`[AGENT] Standard git apply failed: ${err.message}`);
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
    console.log(`[AGENT] git apply --unidiff-zero failed: ${err.message}`);
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
    console.log(`[AGENT] git apply --ignore-whitespace failed: ${err.message}`);
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
    console.log(`[AGENT] patch command failed: ${err.message}`);
    lastError = err;
  }
}

if (!patchApplied) {
  const errorMsg = `Failed to apply patch after trying multiple strategies.\n\nLast error: ${lastError.message}\n\nDiff preview:\n\`\`\`\n${diff.substring(0, 1000)}\n\`\`\``;
  await handleError(new Error(errorMsg), "Patch Application Failed");
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

