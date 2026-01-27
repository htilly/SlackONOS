import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate Implementation - Use Claude to analyze codebase and generate implementation
 *
 * This script uses Claude to:
 * 1. Analyze the existing codebase
 * 2. Generate an implementation plan
 * 3. Create code changes for the feature request
 */

const enhancedTask = process.env.ENHANCED_TASK || process.env.TASK || "";
const issueNumber = process.env.ISSUE_NUMBER || "unknown";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

if (!enhancedTask) {
  console.error("[IMPLEMENTATION] ENHANCED_TASK or TASK environment variable not set");
  process.exit(1);
}

if (!anthropicApiKey) {
  console.error("[IMPLEMENTATION] ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: anthropicApiKey });

/**
 * Read relevant project files to give Claude context
 */
function getProjectContext() {
  const repoRoot = resolve(__dirname, "../..");
  const files = [];

  // Read package.json for dependencies
  try {
    const packageJson = readFileSync(resolve(repoRoot, "package.json"), "utf8");
    files.push({
      path: "package.json",
      content: packageJson
    });
  } catch (e) {
    console.warn("[IMPLEMENTATION] Could not read package.json");
  }

  // Read main index file
  try {
    const indexJs = readFileSync(resolve(repoRoot, "index.js"), "utf8");
    files.push({
      path: "index.js",
      content: indexJs.substring(0, 5000) // First 5000 chars to avoid token limits
    });
  } catch (e) {
    console.warn("[IMPLEMENTATION] Could not read index.js");
  }

  // Read lib directory structure
  try {
    const libFiles = [
      "lib/slack.js",
      "lib/discord.js",
      "lib/voting.js",
      "lib/command-handlers.js",
      "lib/ai-handler.js",
      "lib/spotify.js"
    ];

    for (const libFile of libFiles) {
      const fullPath = resolve(repoRoot, libFile);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, "utf8");
        files.push({
          path: libFile,
          content: content.substring(0, 3000) // First 3000 chars per file
        });
      }
    }
  } catch (e) {
    console.warn("[IMPLEMENTATION] Could not read lib files");
  }

  return files;
}

/**
 * Generate implementation using Claude
 */
async function generateImplementation() {
  try {
    console.log(`[IMPLEMENTATION] Generating implementation with ${model}...`);
    console.log(`[IMPLEMENTATION] Feature request: ${enhancedTask}`);

    const projectFiles = getProjectContext();

    // Build context from project files
    let contextText = "Here are relevant files from the project:\n\n";
    for (const file of projectFiles) {
      contextText += `--- ${file.path} ---\n${file.content}\n\n`;
    }

    const systemPrompt = `You are an expert software developer working on a Slack/Discord bot for controlling Sonos speakers.

The project is called SlackONOS and is a democratic bot where users can vote on songs to play.

Your task is to analyze the feature request and generate a concrete implementation plan with code suggestions.

Project context:
- Node.js application
- Uses Slack Socket Mode / Events API (via @slack/socket-mode) and Discord.js
- Controls Sonos speakers
- Has voting system for democratic music control
- Uses AI for natural language commands
- Supports Spotify integration

Output format:
1. **Implementation Plan** - Brief overview of what needs to be changed
2. **Files to Modify/Create** - List specific files
3. **Code Changes** - Provide actual code snippets or full file contents

Be specific and actionable. Focus on the actual code changes needed.`;

    const userPrompt = `Feature Request to Implement:

${enhancedTask}

${contextText}

Please provide:
1. A brief implementation plan
2. List of files to modify or create
3. Actual code changes with clear instructions

Make it actionable and ready to commit.`;

    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${systemPrompt}\n\n${userPrompt}`
            }
          ]
        }
      ]
    });

    const implementation = response.content[0].text;

    console.log(`[IMPLEMENTATION] Generated implementation plan:`);
    console.log(implementation);

    // Save implementation to file for the workflow to use
    const outputPath = resolve(__dirname, `../../implementation-${issueNumber}.md`);
    writeFileSync(outputPath, implementation, "utf8");
    console.log(`[IMPLEMENTATION] Saved to ${outputPath}`);

    // Output markers for workflow parsing
    console.log(`\nIMPLEMENTATION_FILE:${outputPath}`);
    console.log(`IMPLEMENTATION_START`);
    console.log(implementation);
    console.log(`IMPLEMENTATION_END`);

    return implementation;

  } catch (error) {
    console.error(`[IMPLEMENTATION] Error generating implementation: ${error.message}`);
    if (error.response) {
      console.error(`[IMPLEMENTATION] API Error: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }
}

generateImplementation();
