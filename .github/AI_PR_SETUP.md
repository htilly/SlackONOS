# AI-Generated Pull Request Setup

This guide describes how to configure automatic PR creation with AI-generated code suggestions for feature requests.

## Overview

When an issue is created with the `enhancement` label, the workflow will:

1. **Enhance the issue description** - Convert to structured user story format
2. **Create Confluence page** (optional) - Document requirements
3. **Generate implementation with Claude AI** - Analyze codebase and create implementation plan
4. **Create automatic PR** - Commit implementation plan and create PR against `develop` branch

## Configuration

### 1. GitHub Secrets

You need to configure the following secrets in your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

#### Required for AI-PR:
- `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude
  - Get from: https://console.anthropic.com/
  - Format: `sk-ant-api03-...`

#### Optional (for enhanced features):
- `OPENAI_API_KEY` - For preprocessing with OpenAI
- `PREPROCESSING_MODEL` - Optional, default: `gpt-4o-mini`
- `CLAUDE_MODEL` - Optional, default: `claude-sonnet-4-5-20250929`

#### Optional (for Confluence integration):
- `CONFLUENCE_URL` - Your Confluence URL (e.g. `https://your-domain.atlassian.net`)
- `CONFLUENCE_EMAIL` - Your Confluence account email
- `CONFLUENCE_API_TOKEN` - Confluence API token
- `CONFLUENCE_SPACE_KEY` - Space key where pages should be created (default: `AICODE`)
- `CONFLUENCE_PARENT_PAGE_ID` - Parent page ID (optional)

### 2. GitHub CLI (gh) Access

The workflow uses `gh` CLI to create PRs. This works automatically with `GITHUB_TOKEN` provided by GitHub Actions.

### 3. Repository Permissions

Verify that GitHub Actions has the correct permissions:

**Settings → Actions → General → Workflow permissions**
- Select: "Read and write permissions"
- Enable: "Allow GitHub Actions to create and approve pull requests"

## Usage

### Create a Feature Request

1. Go to **Issues → New Issue**
2. Write your feature request
3. Add the **`enhancement`** label
4. Create the issue

### What Happens Automatically

The workflow will:

1. ✅ Enhance issue description with structured user story
2. 📄 Create a Confluence page (if configured)
3. 🤖 Use Claude AI to analyze the codebase
4. 📝 Generate an implementation plan
5. 🌿 Create a new branch: `feature/issue-{number}-implementation`
6. 📤 Commit the file `implementation-{number}.md`
7. 🔀 Create a PR against `develop` branch
8. 💬 Comment on original issue with PR link

### PR Content

The PR will contain:
- A markdown file with Claude's implementation plan
- Analysis of existing code
- Suggestions for which files need changes
- Concrete code examples and instructions

### Next Steps After PR Creation

1. **Review the implementation plan** in the PR
2. **Add actual code changes** based on the plan
3. **Test the implementation**
4. **Merge when ready**

## Manual Trigger

You can also trigger the workflow manually:

1. Go to **Actions → Enhance Feature Requests**
2. Click **Run workflow**
3. Enter issue number
4. Click **Run workflow**

## Troubleshooting

### Workflow Doesn't Run

- Verify that issue has the `enhancement` label
- Check that workflow file exists in main/master branch
- Review Actions log for error messages

### PR Not Created

- Verify that `ANTHROPIC_API_KEY` is configured
- Check that repository has correct permissions (see step 3 above)
- Verify that `gh` CLI works in workflow log

### Low Quality Implementation

- Try using `claude-opus-4.5` instead: set secret `CLAUDE_MODEL=claude-opus-4.5-20251101`
- Ensure issue description is clear and detailed
- Add more context in [generate-implementation.mjs](.github/agent/generate-implementation.mjs)

## Cost

- **Anthropic Claude API**: ~$0.50-2.00 per feature request (depending on model)
- **OpenAI** (optional): ~$0.01-0.10 per preprocessing
- **GitHub Actions**: Free for public repos, included in private repo plans

## Customize the Implementation Generator

Edit [.github/agent/generate-implementation.mjs](.github/agent/generate-implementation.mjs) to:

- Add more project files for context
- Modify system prompt for better output
- Customize how implementation is presented

## Branch Strategy

**Important**: All PRs are automatically created against the `develop` branch. This is configured in the workflow at line 354:

```yaml
--base develop \
```

If you need to change the target branch, modify this line in [.github/workflows/feature-request-enhance.yml](.github/workflows/feature-request-enhance.yml).

## Support

- GitHub Issues: https://github.com/htilly/SlackONOS/issues
- Claude API Docs: https://docs.anthropic.com/
