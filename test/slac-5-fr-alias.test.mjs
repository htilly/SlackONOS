/**
 * Tests for SLAC-5 — Add "fr" Alias for `featurerequest` Command
 *
 * Verifies that:
 *  - "fr" is registered as an alias pointing to the same handler as "featurerequest"
 *  - The existing "featurerequest" command is unchanged
 *  - Help text documents the "fr" alias
 *  - No duplicated handler logic exists for "fr"
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SLAC-5 — "fr" alias for featurerequest', function () {

  // -------------------------------------------------------------------------
  // Command Registration
  // -------------------------------------------------------------------------

  describe('Command Registration (index.js)', function () {

    it('should still have the original "featurerequest" command registered', function () {
      const content = readFile('index.js');
      expect(content).to.include("['featurerequest', { fn: _featurerequest");
    });

    it('should have the "fr" alias registered', function () {
      const content = readFile('index.js');
      expect(content).to.include("['fr', { fn: _featurerequest");
    });

    it('should register "fr" with the same handler function as "featurerequest"', function () {
      const content = readFile('index.js');

      // Both entries must reference _featurerequest — no separate handler
      const featureRequestRegistered = content.includes("['featurerequest', { fn: _featurerequest");
      const frRegistered = content.includes("['fr', { fn: _featurerequest");

      expect(featureRequestRegistered, '"featurerequest" registration with _featurerequest handler').to.be.true;
      expect(frRegistered, '"fr" registration with _featurerequest handler').to.be.true;
    });

    it('should NOT define a separate handler function for "fr"', function () {
      const content = readFile('index.js');

      // There must be no dedicated _fr function — the alias reuses _featurerequest
      expect(content).to.not.include('function _fr(');
      expect(content).to.not.include('async function _fr(');
    });

    it('should have exactly one definition of the _featurerequest handler function', function () {
      const content = readFile('index.js');

      // Count occurrences of the function declaration
      const matches = content.match(/async function _featurerequest\s*\(/g) || [];
      expect(matches).to.have.lengthOf(1);
    });

    it('should have the _featurerequest handler accept (input, channel, userName) parameters', function () {
      const content = readFile('index.js');
      expect(content).to.include('async function _featurerequest(input, channel, userName)');
    });
  });

  // -------------------------------------------------------------------------
  // Handler Behaviour — source-level checks
  // -------------------------------------------------------------------------

  describe('Handler Behaviour', function () {

    it('should use the GitHub Issues API endpoint in the handler', function () {
      const content = readFile('index.js');
      expect(content).to.include('api.github.com/repos/htilly/SlackONOS/issues');
    });

    it('should apply the "enhancement" label when creating a GitHub issue', function () {
      const content = readFile('index.js');
      expect(content).to.include("labels: ['enhancement']");
    });

    it('should include requester information in the issue body', function () {
      const content = readFile('index.js');
      expect(content).to.include('Requested by');
    });
  });

  // -------------------------------------------------------------------------
  // Help Text — user-facing documentation
  // -------------------------------------------------------------------------

  describe('Help Text Documentation', function () {

    it('should document the "fr" alias in the standard help text', function () {
      const content = readFile('templates/help/helpText.txt');
      // The spec requires something like: featurerequest (alias: fr)
      expect(content).to.include('featurerequest');
      expect(content).to.include('fr');
    });

    it('should show "fr" as an alias for "featurerequest" in the standard help text', function () {
      const content = readFile('templates/help/helpText.txt');
      // Verify the alias notation is present (e.g. "alias: `fr`" or "(alias: fr)")
      expect(content).to.match(/featurerequest.*alias.*fr/i);
    });

    it('should still document "featurerequest" in the admin help text', function () {
      const content = readFile('templates/help/helpTextAdmin.txt');
      expect(content).to.include('featurerequest');
    });

    it('should include the feature request entry in the Feedback section of standard help', function () {
      const content = readFile('templates/help/helpText.txt');
      // The Feedback section header must be present
      expect(content).to.include('Feedback');
      // And the featurerequest command must appear after it
      const feedbackIndex = content.indexOf('Feedback');
      const frIndex = content.indexOf('featurerequest', feedbackIndex);
      expect(frIndex).to.be.greaterThan(feedbackIndex);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe('Configuration', function () {

    it('should have githubToken in the example config', function () {
      const content = readFile('config/config.json.example');
      expect(content).to.include('"githubToken"');
    });
  });

  // -------------------------------------------------------------------------
  // Alias parity — both keys must share identical registration shape
  // -------------------------------------------------------------------------

  describe('Alias Parity', function () {

    it('"fr" and "featurerequest" registrations should reference the same handler name', function () {
      const content = readFile('index.js');

      // Extract the handler name used for each registration
      const featureRequestMatch = content.match(/\['featurerequest',\s*\{\s*fn:\s*(\w+)/);
      const frMatch = content.match(/\['fr',\s*\{\s*fn:\s*(\w+)/);

      expect(featureRequestMatch, '"featurerequest" registration found').to.not.be.null;
      expect(frMatch, '"fr" registration found').to.not.be.null;

      const featureRequestHandler = featureRequestMatch[1];
      const frHandler = frMatch[1];

      expect(frHandler).to.equal(featureRequestHandler,
        `"fr" handler (${frHandler}) must equal "featurerequest" handler (${featureRequestHandler})`);
    });

    it('"fr" should not trigger an unknown-command response', function () {
      const content = readFile('index.js');

      // The command map must contain 'fr' so the router never falls through
      // to an unknown-command branch for this input
      expect(content).to.include("'fr'");

      // Confirm the unknown-command guard (if present) would not match 'fr'
      // by ensuring 'fr' is a registered key — already verified above
      const frRegistered = content.includes("['fr', { fn: _featurerequest");
      expect(frRegistered).to.be.true;
    });
  });
});
