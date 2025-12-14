import OpenAI from "openai";
import fetch from "node-fetch";

/**
 * Preprocess Task - Convert one-liner task descriptions to structured user stories
 *
 * This script takes a natural language task description and converts it to a
 * structured user story format using OpenAI, then creates a Confluence page
 * with the requirements before triggering the main agent.
 */

const task = process.env.TASK || "";
const openaiApiKey = process.env.OPENAI_API_KEY;
const model = process.env.PREPROCESSING_MODEL || "gpt-4o-mini";

// Confluence configuration
const confluenceUrl = process.env.CONFLUENCE_URL || "";
const confluenceEmail = process.env.CONFLUENCE_EMAIL || "";
const confluenceApiToken = process.env.CONFLUENCE_API_TOKEN || "";
const confluenceSpaceKey = process.env.CONFLUENCE_SPACE_KEY || "AICODE";

if (!task) {
  console.error("[PREPROCESS] TASK environment variable not set");
  process.exit(1);
}

if (!openaiApiKey) {
  console.warn("[PREPROCESS] OPENAI_API_KEY not set, skipping preprocessing");
  console.log(`[PREPROCESS] Original task: ${task}`);
  process.exit(0);
}

const openai = new OpenAI({ apiKey: openaiApiKey });

const systemPrompt = `You are a task analysis assistant for a code generation system. Your job is to convert natural language task descriptions into structured user stories that are clearer and more actionable for AI code generation.

Convert the given task description into a structured user story format following this template:

"As a [role], I want to [action] so that [benefit].

Acceptance Criteria:
- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

Technical Notes:
- [Any technical considerations]
- [Files likely to be modified]
- [Potential risks or edge cases]"

Guidelines:
- Identify the user role (administrator, developer, end user, etc.)
- Extract the main action/feature requested
- Clarify the benefit or goal
- Break down the task into specific, testable acceptance criteria
- Add technical notes about implementation details
- Maintain all technical context and requirements
- Keep it concise but comprehensive
- If the task is already well-structured, enhance it rather than completely rewriting

Output ONLY the user story with technical notes, no explanations or markdown formatting.`;

const userPrompt = `Convert this task description into a structured user story:

${task}`;

/**
 * Create a Confluence page with the requirements
 * @param {string} title - Page title
 * @param {string} content - Page content (user story)
 * @returns {Promise<string|null>} Confluence page URL or null if failed
 */
async function createConfluencePage(title, content) {
  if (!confluenceUrl || !confluenceEmail || !confluenceApiToken) {
    console.log("[PREPROCESS] Confluence credentials not configured, skipping page creation");
    return null;
  }

  try {
    console.log(`[PREPROCESS] Creating Confluence page in space ${confluenceSpaceKey}...`);

    // Format content as Confluence storage format (XHTML-based)
    const storageContent = `
<h2>Original Task</h2>
<p>${task.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>

<h2>User Story</h2>
<p>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>

<h2>Implementation Status</h2>
<p><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Yellow</ac:parameter><ac:parameter ac:name="title">In Progress</ac:parameter></ac:structured-macro></p>

<h2>Related Links</h2>
<p>GitHub Run: <a href="https://github.com/htilly/SlackONOS/actions/runs/${process.env.GITHUB_RUN_ID || 'unknown'}">View Workflow</a></p>
    `.trim();

    const auth = Buffer.from(`${confluenceEmail}:${confluenceApiToken}`).toString('base64');

    const response = await fetch(`${confluenceUrl}/rest/api/content`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        type: 'page',
        title: title,
        space: { key: confluenceSpaceKey },
        body: {
          storage: {
            value: storageContent,
            representation: 'storage'
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PREPROCESS] Failed to create Confluence page: ${response.status} ${response.statusText}`);
      console.error(`[PREPROCESS] Error details: ${errorText}`);
      return null;
    }

    const data = await response.json();
    const pageUrl = `${confluenceUrl}/wiki${data._links.webui}`;
    console.log(`[PREPROCESS] ✅ Confluence page created: ${pageUrl}`);
    return pageUrl;

  } catch (error) {
    console.error(`[PREPROCESS] Error creating Confluence page: ${error.message}`);
    return null;
  }
}

async function preprocessTask() {
  try {
    console.log(`[PREPROCESS] Converting task to user story using ${model}...`);
    console.log(`[PREPROCESS] Original task: ${task}`);

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent output
      max_tokens: 800, // Increased for technical notes
    });

    const enhancedTask = response.choices[0].message.content.trim();

    console.log(`[PREPROCESS] Enhanced task (user story):`);
    console.log(enhancedTask);

    // Create Confluence page with requirements
    const timestamp = new Date().toISOString().split('T')[0];
    const requester = process.env.REQUESTER || 'unknown';
    const pageTitle = `AICODE: ${task.substring(0, 80)} (${timestamp})`;
    const confluenceUrl = await createConfluencePage(pageTitle, enhancedTask);

    // Output to stdout for workflow to capture
    console.log(`\n[PREPROCESS] ENHANCED_TASK_START`);
    console.log(enhancedTask);
    console.log(`[PREPROCESS] ENHANCED_TASK_END`);

    // Also output as JSON for easier parsing
    const outputData = {
      original: task,
      enhanced: enhancedTask,
      confluenceUrl: confluenceUrl || 'N/A',
      requester: requester,
      timestamp: timestamp
    };
    process.stdout.write(`\nENHANCED_TASK_JSON:${JSON.stringify(outputData)}\n`);

    if (confluenceUrl) {
      console.log(`\n[PREPROCESS] 📝 Requirements documented: ${confluenceUrl}`);
    }

  } catch (error) {
    console.error(`[PREPROCESS] Error during preprocessing: ${error.message}`);
    console.warn(`[PREPROCESS] Falling back to original task`);
    console.log(`[PREPROCESS] Original task: ${task}`);
    // Output original task so workflow can continue
    console.log(`\n[PREPROCESS] ENHANCED_TASK_START`);
    console.log(task);
    console.log(`[PREPROCESS] ENHANCED_TASK_END`);
    process.exit(0); // Exit successfully with original task
  }
}

preprocessTask();
