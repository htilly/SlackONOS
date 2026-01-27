import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate Implementation - Use Claude to analyze codebase and IMPLEMENT code changes
 *
 * This script uses Claude to:
 * 1. Intelligently identify relevant files based on the task
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
 * Get all files in the repository
 */
function getAllFiles() {
  const repoRoot = resolve(__dirname, "../..");
  const files = [];
  
  function walkDir(dir, basePath = "") {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = basePath ? join(basePath, entry.name) : entry.name;
        
        // Skip excluded paths
        if (relPath.includes('node_modules/') || 
            relPath.includes('.git/') || 
            relPath.includes('coverage/') ||
            relPath.includes('dist/') ||
            relPath.includes('build/') ||
            relPath.startsWith('.') && !relPath.startsWith('.github/')) {
          continue;
        }
        
        if (entry.isDirectory()) {
          walkDir(fullPath, relPath);
        } else if (entry.isFile()) {
          // Only include code files
          const ext = entry.name.split('.').pop();
          if (['js', 'mjs', 'json', 'html', 'css', 'txt', 'yml', 'yaml'].includes(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }
  
  walkDir(repoRoot);
  return files;
}

/**
 * Select relevant files based on task description (keyword-based)
 */
function selectRelevantFiles(task, fileList) {
  const taskLower = task.toLowerCase();
  const relevantFiles = new Set();
  
  // Keyword to file mapping (updated for current codebase structure)
  const keywordMap = {
    'spotify': ['lib/spotify.js', 'lib/command-handlers.js'],
    'discord': ['lib/discord.js'],
    'slack': ['lib/slack.js'],
    'sonos': ['index.js'],
    'vote': ['lib/voting.js', 'index.js'],
    'gong': ['lib/voting.js', 'index.js'],
    'admin': ['public/setup/admin.js', 'public/setup/admin.html'],
    'auth': ['lib/auth-handler.js', 'lib/webauthn-handler.js'],
    'ai': ['lib/ai-handler.js'],
    'soundcraft': ['lib/soundcraft-handler.js'],
    'help': ['templates/help/', 'index.js'],
    'web': ['public/setup/', 'public/'],
    'config': ['index.js'],
    'queue': ['lib/add-handlers.js', 'index.js'],
    'search': ['lib/spotify.js', 'lib/command-handlers.js', 'index.js'],
    'command': ['lib/command-handlers.js', 'index.js'],
    'feature': ['index.js', 'lib/command-handlers.js'],
    'alias': ['index.js', 'lib/command-handlers.js'],
    'github': ['lib/github-app.js', 'index.js']
  };
  
  // Find relevant files based on keywords
  for (const [keyword, files] of Object.entries(keywordMap)) {
    if (taskLower.includes(keyword)) {
      for (const file of files) {
        // Check if file exists in fileList
        const matchingFiles = fileList.filter(f => 
          f.includes(file) || f.endsWith(file) || f === file
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
 * Read relevant project files to give Claude context
 */
function getProjectContext(task) {
  const repoRoot = resolve(__dirname, "../..");
  const files = [];
  const fileList = getAllFiles();
  
  // Priority files (always include)
  const priorityFiles = [
    'package.json',
    'index.js'
  ];
  
  // Get task-relevant files
  const relevantFiles = selectRelevantFiles(task, fileList);
  console.log(`[IMPLEMENTATION] Identified ${relevantFiles.length} relevant files based on task keywords`);
  if (relevantFiles.length > 0) {
    console.log(`[IMPLEMENTATION] Relevant files: ${relevantFiles.join(', ')}`);
  }

  // First pass: Include priority files
  for (const filePath of priorityFiles) {
    try {
      const fullPath = resolve(repoRoot, filePath);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, "utf8");
        // Include full content for priority files
        files.push({
          path: filePath,
          content: filePath === 'index.js' ? content.substring(0, 15000) : content
        });
      }
    } catch (e) {
      console.warn(`[IMPLEMENTATION] Could not read ${filePath}`);
    }
  }

  // Second pass: Include task-relevant files
  for (const filePath of relevantFiles) {
    try {
      const fullPath = resolve(repoRoot, filePath);
      if (existsSync(fullPath)) {
        const stats = statSync(fullPath);
        // Skip very large files
        if (stats.size > 100000) {
          console.log(`[IMPLEMENTATION] Skipping large file: ${filePath} (${stats.size} bytes)`);
          continue;
        }
        
        const content = readFileSync(fullPath, "utf8");
        files.push({
          path: filePath,
          content: content // Include full content for relevant files
        });
      }
    } catch (e) {
      console.warn(`[IMPLEMENTATION] Could not read ${filePath}`);
    }
  }

  // Third pass: Include other lib files if we have space (limit to prevent token overflow)
  const maxFiles = 15; // Limit total files
  const libFiles = [
    'lib/slack.js',
    'lib/discord.js',
    'lib/voting.js',
    'lib/command-handlers.js',
    'lib/ai-handler.js',
    'lib/spotify.js',
    'lib/add-handlers.js'
  ];
  
  for (const filePath of libFiles) {
    if (files.length >= maxFiles) break;
    
    // Skip if already included
    if (files.some(f => f.path === filePath)) continue;
    
    try {
      const fullPath = resolve(repoRoot, filePath);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, "utf8");
        files.push({
          path: filePath,
          content: content.substring(0, 8000) // Truncate non-priority files
        });
      }
    } catch (e) {
      // Skip if can't read
    }
  }

  console.log(`[IMPLEMENTATION] Including ${files.length} files in context`);
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

    const projectFiles = getProjectContext(enhancedTask);

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
