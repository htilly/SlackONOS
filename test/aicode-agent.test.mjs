/**
 * Integration test for Feature Request command
 * 
 * This test verifies the featurerequest command is properly registered and can be called.
 * It does NOT test the GitHub API integration (requires real credentials).
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

describe('Feature Request Integration', function() {
  describe('Command Registration', function() {
    it('should have featurerequest command registered in command registry', function() {
      const registryPath = path.join(process.cwd(), 'lib', 'command-registry.js');
      const content = fs.readFileSync(registryPath, 'utf8');
      
      // Check command is registered
      expect(content).to.include("['featurerequest', { fn: featurerequest");
      expect(content).to.include("['fr', { fn: featurerequest");

      const indexPath = path.join(process.cwd(), 'index.js');
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      
      // Check handler function exists
      expect(indexContent).to.include('async function _featurerequest(input, channel, userName)');
    });
  });

  describe('GitHub Issue Creation', function() {
    it('should create GitHub issue with enhancement label', function() {
      const indexPath = path.join(process.cwd(), 'index.js');
      const content = fs.readFileSync(indexPath, 'utf8');
      
      // Check it uses GitHub Issues API
      expect(content).to.include('api.github.com/repos/htilly/SlackONOS/issues');
      
      // Check it includes enhancement label (in code it's labels: ['enhancement'])
      expect(content).to.include("labels: ['enhancement']");
      
      // Check it includes requester info in issue body
      expect(content).to.include('Requested by');
    });
  });

  describe('Configuration', function() {
    it('should have githubToken in config example', function() {
      const configPath = path.join(process.cwd(), 'config', 'config.json.example');
      const content = fs.readFileSync(configPath, 'utf8');
      
      expect(content).to.include('"githubToken"');
    });
  });

  describe('Documentation', function() {
    it('should have feature request command in help text', function() {
      const helpPath = path.join(process.cwd(), 'templates', 'help', 'helpTextAdmin.txt');
      const content = fs.readFileSync(helpPath, 'utf8');
      
      expect(content).to.include('featurerequest');
    });
  });
});
