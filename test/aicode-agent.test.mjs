/**
 * Integration test for AI Code Agent
 * 
 * This test verifies the aicode command is properly registered and can be called.
 * It does NOT test the GitHub Actions workflow or OpenAI integration (those require real credentials).
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

describe('AI Code Agent Integration', function() {
  describe('Command Registration', function() {
    it('should have aicode command registered in index.js', function() {
      const indexPath = path.join(process.cwd(), 'index.js');
      const content = fs.readFileSync(indexPath, 'utf8');
      
      // Check command is registered
      expect(content).to.include("['aicode', { fn: _aicode, admin: true }]");
      
      // Check handler function exists
      expect(content).to.include('async function _aicode(input, channel, userName)');
    });
  });

  describe('GitHub Actions Workflow', function() {
    it('should have aicode-agent.yml workflow file', function() {
      const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'aicode-agent.yml');
      expect(fs.existsSync(workflowPath)).to.be.true;
      
      const content = fs.readFileSync(workflowPath, 'utf8');
      
      // Verify it's actually a YAML file, not a JavaScript file
      expect(content).to.not.include('#!/usr/bin/env node');
      expect(content).to.not.include('import fs from');
      
      // Check it's triggered by repository_dispatch
      expect(content).to.include('repository_dispatch:');
      expect(content).to.include('types: [aicode]');
      
      // Check it runs the agent (supports multiple providers now)
      expect(content).to.include('node .github/agent/agent.mjs');
      
      // Check it runs tests
      expect(content).to.include('npm test');
      
      // Check it creates PR on success
      expect(content).to.include('peter-evans/create-pull-request');
    });
  });

  describe('Agent Script', function() {
    it('should have agent.mjs script', function() {
      const agentPath = path.join(process.cwd(), '.github', 'agent', 'agent.mjs');
      expect(fs.existsSync(agentPath)).to.be.true;
      
      const content = fs.readFileSync(agentPath, 'utf8');
      
      // Check it imports required modules (supports multiple AI providers)
      expect(content).to.include('import { execSync } from "child_process"');
      // Check for multi-provider support (Claude, OpenAI, or Gemini)
      expect(content).to.match(/(@anthropic-ai\/sdk|@google\/generative-ai|openai|AI_PROVIDER)/);
      
      // Check it has safety checks
      expect(content).to.include('webauthn-handler.js');
      expect(content).to.include('auth-handler.js');
      expect(content).to.match(/Safety Violation|SAFETY VIOLATION/i);
      
      // Check it validates diff format
      expect(content).to.include('diff --git');
      
      // Check it has line limit
      expect(content).to.include('300');
    });
  });

  describe('Configuration', function() {
    it('should have githubToken and slackWebhookUrl in config example', function() {
      const configPath = path.join(process.cwd(), 'config', 'config.json.example');
      const content = fs.readFileSync(configPath, 'utf8');
      
      expect(content).to.include('"githubToken"');
      expect(content).to.include('"slackWebhookUrl"');
      expect(content).to.include('_comment_aicode');
    });
  });

  describe('Documentation', function() {
    it('should have AI Code Agent section in README', function() {
      const readmePath = path.join(process.cwd(), 'README.md');
      const content = fs.readFileSync(readmePath, 'utf8');
      
      expect(content).to.include('## AI Code Agent (Experimental)');
      expect(content).to.include('aicode <task description>');
      expect(content).to.include('### Requirements');
      expect(content).to.include('### Safety Features');
    });
  });
});

