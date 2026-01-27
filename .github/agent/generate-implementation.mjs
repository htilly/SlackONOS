import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate Implementation - Use Claude to analyze codebase and IMPLEMENT code changes
 *
 * This script uses Claude to:
 * 1. Analyze the existing codebase
 * 2. Generate actual code changes (diffs)
 * 3. Apply the changes to the codebase
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
      content: indexJs.substring(0, 10000) // More context for main file
    });
  } catch (e) {
    console.warn("[IMPLEMENTATION] Could not read index.js");
  }

  // Read lib directory files
  try {
    const libFiles = [
      "lib/slack.js",
      "lib/discord.js",
      "lib/voting.js",
      "lib/command-handlers.js",
      "lib/ai-handler.js",
      "lib/spotify.js",
      "lib/add-handlers.js"
    ];

    for (const libFile of libFiles) {
      const fullPath = resolve(repoRoot, libFile);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, "utf8");
        files.push({
          path: libFile,
          content: content.substring(0, 5000) // More context per file
        });
      }
    }
  } catch (e) {
    console.warn("[IMPLEMENTATION] Could not read lib files");
  }

  return files;
}

/**
 * Apply diff to files
 */
function applyDiff(diff) {
  const repoRoot = resolve(__dirname, "../..");
  const tempPatchFile = resolve(repoRoot, `.tmp-patch-${issueNumber}.patch`);
  
  try {
    // Write diff to temporary patch file
    writeFileSync(tempPatchFile, diff, "utf8");
    console.log(`[IMPLEMENTATION] Wrote patch to ${tempPatchFile}`);
    
    // Try to apply the patch
    try {
      execSync(`cd "${repoRoot}" && git apply --ignore-whitespace "${tempPatchFile}"`, {
        stdio: 'inherit'
      });
      console.log(`[IMPLEMENTATION] ✅ Successfully applied patch`);
      return true;
    } catch (applyError) {
      console.warn(`[IMPLEMENTATION] ⚠️  git apply failed, trying patch command...`);
      try {
        execSync(`cd "${repoRoot}" && patch -p1 < "${tempPatchFile}"`, {
          stdio: 'inherit'
        });
        console.log(`[IMPLEMENTATION] ✅ Successfully applied patch with patch command`);
        return true;
      } catch (patchError) {
        console.error(`[IMPLEMENTATION] ❌ Failed to apply patch`);
        console.error(`[IMPLEMENTATION] git apply error: ${applyError.message}`);
        console.error(`[IMPLEMENTATION] patch error: ${patchError.message}`);
        return false;
      }
    }
  } finally {
    // Clean up temp file
    try {
      if (existsSync(tempPatchFile)) {
        execSync(`rm "${tempPatchFile}"`);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate and apply implementation using Claude
 */
async function generateImplementation() {
  try {
    console.log(`[IMPLEMENTATION] Generating code implementation with ${model}...`);
    console.log(`[IMPLEMENTATION] Feature request: ${enhancedTask}`);

    const projectFiles = getProjectContext();

    // Build context from project files
    let contextText = "Here are relevant files from the project:\n\n";
    for (const file of projectFiles) {
      contextText += `--- ${file.path} ---\n${file.content}\n\n`;
    }

    const systemPrompt = `You are an expert software developer working on a Slack/Discord bot for controlling Sonos speakers.

The project is called SlackONOS and is a democratic bot where users can vote on songs to play.

Your task is to IMPLEMENT the feature request by generating actual code changes in unified diff format.

Project context:
- Node.js application
- Uses Slack Socket Mode / Events API (via @slack/socket-mode) and Discord.js
- Controls Sonos speakers
- Has voting system for democratic music control
- Uses AI for natural language commands
- Supports Spotify integration

CRITICAL: You must generate a VALID unified diff that can be applied with git apply or patch command.

DIFF FORMAT REQUIREMENTS:
1. Start each file with "--- a/path/to/file.js" and "+++ b/path/to/file.js" (BOTH lines required)
2. NO "diff --git" line, NO "index" line with hashes
3. Include "@@ -startLine,numLines +startLine,numLines @@" hunk headers
4. Include at least 3 lines of context before and after each change
5. Use "+" prefix for additions, "-" prefix for removals, " " (space) prefix for context
6. Ensure line numbers match actual file contents
7. Output ONLY the diff - no explanations, no markdown code blocks, no text before/after
8. The diff MUST be complete and valid - every file section must have BOTH "--- a/path" AND "+++ b/path" lines
9. NEVER truncate file paths - always write complete paths
10. If creating new files, use "--- /dev/null" and "+++ b/path/to/newfile.js"

Generate the complete, valid unified diff now.`;

    const userPrompt = `Feature Request to Implement:

${enhancedTask}

${contextText}

Generate a valid unified diff that implements this feature. The diff must be complete and ready to apply with git apply or patch command.

Output ONLY the diff, no explanations.`;

    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 8192, // Increased for larger diffs
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

    const diff = response.content[0].text;

    console.log(`[IMPLEMENTATION] Generated diff:`);
    console.log(diff);

    // Extract diff from potential markdown code blocks
    let cleanDiff = diff.trim();
    if (cleanDiff.includes('```')) {
      const matches = cleanDiff.matchAll(/```(?:diff)?\n([\s\S]*?)```/g);
      const extracted = [];
      for (const match of matches) {
        extracted.push(match[1].trim());
      }
      if (extracted.length > 0) {
        cleanDiff = extracted.reduce((a, b) => a.length > b.length ? a : b);
      }
    }

    // Validate diff format
    if (!cleanDiff.includes('--- a/') || !cleanDiff.includes('+++ b/')) {
      console.error(`[IMPLEMENTATION] ❌ Generated output is not a valid diff format`);
      console.error(`[IMPLEMENTATION] Missing required diff markers (--- a/ or +++ b/)`);
      
      // Save as fallback implementation plan
      const outputPath = resolve(__dirname, `../../implementation-${issueNumber}.md`);
      writeFileSync(outputPath, `# Implementation Plan\n\n${enhancedTask}\n\n## Generated Output\n\n${diff}`, "utf8");
      console.log(`[IMPLEMENTATION] Saved as fallback plan to ${outputPath}`);
      console.log(`\nIMPLEMENTATION_FILE:${outputPath}`);
      return;
    }

    // Apply the diff
    const applied = applyDiff(cleanDiff);
    
    if (applied) {
      console.log(`[IMPLEMENTATION] ✅ Code changes successfully applied!`);
      
      // List changed files
      try {
        const changedFiles = execSync('git diff --name-only', { encoding: 'utf8' }).trim().split('\n').filter(f => f);
        console.log(`[IMPLEMENTATION] Changed files:`);
        changedFiles.forEach(f => console.log(`[IMPLEMENTATION]   - ${f}`));
        
        // Output marker for workflow
        console.log(`\nIMPLEMENTATION_FILE:APPLIED`);
        console.log(`IMPLEMENTATION_CHANGED_FILES:${changedFiles.join(',')}`);
      } catch (e) {
        console.warn(`[IMPLEMENTATION] Could not list changed files: ${e.message}`);
        console.log(`\nIMPLEMENTATION_FILE:APPLIED`);
      }
    } else {
      console.error(`[IMPLEMENTATION] ❌ Failed to apply code changes`);
      
      // Save diff as fallback
      const outputPath = resolve(__dirname, `../../implementation-${issueNumber}.patch`);
      writeFileSync(outputPath, cleanDiff, "utf8");
      console.log(`[IMPLEMENTATION] Saved diff to ${outputPath} for manual review`);
      console.log(`\nIMPLEMENTATION_FILE:${outputPath}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`[IMPLEMENTATION] Error generating implementation: ${error.message}`);
    if (error.response) {
      console.error(`[IMPLEMENTATION] API Error: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }
}

generateImplementation();
