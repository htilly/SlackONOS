// Create Confluence page for feature request
// Uses native fetch (Node 20+)

const enhancedTask = process.env.ENHANCED_TASK || "";
const task = process.env.TASK || "";
const requester = process.env.REQUESTER || "unknown";
const issueNumber = process.env.ISSUE_NUMBER || "unknown";
const confluenceUrl = process.env.CONFLUENCE_URL || "";
const confluenceEmail = process.env.CONFLUENCE_EMAIL || "";
const confluenceApiToken = process.env.CONFLUENCE_API_TOKEN || "";
const confluenceSpaceKey = process.env.CONFLUENCE_SPACE_KEY || "AICODE";
const confluenceParentPageId = process.env.CONFLUENCE_PARENT_PAGE_ID || "";
const githubRunId = process.env.GITHUB_RUN_ID || "unknown";
const githubRepo = process.env.GITHUB_REPOSITORY || "unknown";

// Exit gracefully if Confluence not configured
if (!confluenceUrl || !confluenceEmail || !confluenceApiToken) {
  console.log("[CONFLUENCE] Confluence credentials not configured, skipping page creation");
  process.exit(0);
}

try {
  const timestamp = new Date().toISOString().split('T')[0];
  const pageTitle = `AICODE: ${task.substring(0, 80)} (${timestamp})`;

  const storageContent = `
<h2>Original Task</h2>
<p>${task.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>

<h2>User Story</h2>
<p>${enhancedTask.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>

<h2>Implementation Status</h2>
<p><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Yellow</ac:parameter><ac:parameter ac:name="title">In Progress</ac:parameter></ac:structured-macro></p>

<h2>Related Links</h2>
<p>GitHub Issue: <a href="https://github.com/${githubRepo}/issues/${issueNumber}">#${issueNumber}</a></p>
<p>GitHub Run: <a href="https://github.com/${githubRepo}/actions/runs/${githubRunId}">View Workflow</a></p>
  `.trim();

  const auth = Buffer.from(`${confluenceEmail}:${confluenceApiToken}`).toString('base64');

  const pageData = {
    type: 'page',
    title: pageTitle,
    space: { key: confluenceSpaceKey },
    body: {
      storage: {
        value: storageContent,
        representation: 'storage'
      }
    }
  };

  if (confluenceParentPageId) {
    pageData.ancestors = [{ id: confluenceParentPageId }];
  }

  console.log(`[CONFLUENCE] Creating page: ${pageTitle}`);

  const response = await fetch(`${confluenceUrl}/rest/api/content`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(pageData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[CONFLUENCE] Failed to create page: ${response.status} ${response.statusText}`);
    console.error(`[CONFLUENCE] Error details: ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  const pageUrl = `${confluenceUrl}/wiki${data._links.webui}`;
  console.log(`[CONFLUENCE] ✅ Confluence page created: ${pageUrl}`);
  console.log(`CONFLUENCE_URL:${pageUrl}`);

  process.exit(0);
} catch (error) {
  console.error(`[CONFLUENCE] Error creating page: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
