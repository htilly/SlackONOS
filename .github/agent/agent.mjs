import { execSync } from "child_process";
import fs from "fs";

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
  aiModel = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";
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

// Build specialized prompt for SlackONOS
const prompt = `You are an autonomous coding agent for SlackONOS, a democratic music bot for Discord and Slack that controls Sonos speakers.

CRITICAL SAFETY RULES:
- Output ONLY a valid unified git diff (starting with "diff --git")
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

TASK FROM ADMIN (${requester}):
${task}

Generate a safe, focused code change as a unified git diff. The diff will be applied with "git apply" so ensure it's properly formatted.

Remember: Output ONLY the git diff, no explanations, no markdown code blocks, just the raw diff.`;

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
let diff = output;
if (output.includes("```")) {
  // Extract content between code fences
  const match = output.match(/```(?:diff)?\n([\s\S]*?)```/);
  if (match) {
    diff = match[1];
  }
}

// Validate diff format
if (!diff.includes("diff --git")) {
  const errorMsg = `Model did not return a valid diff. Output was:\n\`\`\`\n${output.substring(0, 500)}\n\`\`\``;
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

// Apply patch
fs.writeFileSync("/tmp/aicode.patch", diff);
try {
  sh("git apply --check /tmp/aicode.patch");
  sh("git apply /tmp/aicode.patch");
  console.log("[AGENT] Patch applied successfully");
} catch (err) {
  const errorMsg = `Failed to apply patch: ${err.message}\n\nDiff preview:\n\`\`\`\n${diff.substring(0, 500)}\n\`\`\``;
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

