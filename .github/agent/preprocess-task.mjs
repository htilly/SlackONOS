import OpenAI from "openai";

/**
 * Preprocess Task - Convert one-liner task descriptions to structured user stories
 * 
 * This script takes a natural language task description and converts it to a
 * structured user story format using OpenAI, making it clearer for code generation.
 */

const task = process.env.TASK || "";
const openaiApiKey = process.env.OPENAI_API_KEY;
const model = process.env.PREPROCESSING_MODEL || "gpt-4o-mini";

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
- [Criterion 3]"

Guidelines:
- Identify the user role (administrator, developer, end user, etc.)
- Extract the main action/feature requested
- Clarify the benefit or goal
- Break down the task into specific, testable acceptance criteria
- Maintain all technical context and requirements
- Keep it concise but comprehensive
- If the task is already well-structured, enhance it rather than completely rewriting

Output ONLY the user story, no explanations or markdown formatting.`;

const userPrompt = `Convert this task description into a structured user story:

${task}`;

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
      max_tokens: 500, // User stories should be concise
    });
    
    const enhancedTask = response.choices[0].message.content.trim();
    
    console.log(`[PREPROCESS] Enhanced task (user story):`);
    console.log(enhancedTask);
    
    // Output to stdout for workflow to capture
    console.log(`\n[PREPROCESS] ENHANCED_TASK_START`);
    console.log(enhancedTask);
    console.log(`[PREPROCESS] ENHANCED_TASK_END`);
    
    // Also output as JSON for easier parsing
    process.stdout.write(`\nENHANCED_TASK_JSON:${JSON.stringify({ original: task, enhanced: enhancedTask })}\n`);
    
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
