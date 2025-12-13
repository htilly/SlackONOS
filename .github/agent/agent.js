import { execSync } from "child_process";
import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const task = process.env.TASK || "Improve code quality";
const requester = process.env.REQUESTER || "unknown";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
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

console.log("[AGENT] Calling OpenAI API...");
const res = await client.chat.completions.create({
  model: "gpt-4o",
  temperature: 0.2,
  messages: [{ role: "user", content: prompt }],
});

const output = res.choices[0].message.content;

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
  console.error("[AGENT] Model did not return a valid diff");
  console.error("[AGENT] Output was:");
  console.error(output);
  process.exit(1);
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
    console.error(`[AGENT] SAFETY VIOLATION: Attempted to modify forbidden file matching ${pattern}`);
    process.exit(1);
  }
}

// Count lines changed
const linesChanged = (diff.match(/^[+-][^+-]/gm) || []).length;
if (linesChanged > 300) {
  console.error(`[AGENT] SAFETY VIOLATION: Too many lines changed (${linesChanged} > 300)`);
  process.exit(1);
}

console.log(`[AGENT] Generated diff with ${linesChanged} lines changed`);

// Apply patch
fs.writeFileSync("/tmp/aicode.patch", diff);
try {
  sh("git apply --check /tmp/aicode.patch");
  sh("git apply /tmp/aicode.patch");
  console.log("[AGENT] Patch applied successfully");
} catch (err) {
  console.error("[AGENT] Failed to apply patch:", err.message);
  console.error("[AGENT] Diff was:");
  console.error(diff);
  process.exit(1);
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

