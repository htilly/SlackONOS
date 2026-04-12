/**
 * Tests for SLAC-4: Add "fr" alias for the `featurerequest` command
 *
 * Verifies that:
 *  - `fr` is registered in index.js pointing to the same handler as `featurerequest`
 *  - Both commands share identical handler function references
 *  - Help text documents `fr` as an alias for `featurerequest`
 *  - Admin help text continues to document `featurerequest`
 *  - The existing `featurerequest` registration is unchanged
 *  - Configuration still includes `githubToken`
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file relative to the project root (process.cwd()).
 */
function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SLAC-4 — "fr" alias for featurerequest', function () {

  // -------------------------------------------------------------------------
  // Command Registration (index.js)
  // -------------------------------------------------------------------------

  describe('Command Registration in index.js', function () {

    it('should still have featurerequest command registered', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include("['featurerequest', { fn: _featurerequest");
    });

    it('should have fr alias registered', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include("['fr', { fn: _featurerequest");
    });

    it('should point fr to the same _featurerequest handler as featurerequest', function () {
      const content = readProjectFile('index.js');

      // Extract the handler name used for featurerequest
      const featureRequestMatch = content.match(/\['featurerequest',\s*\{\s*fn:\s*(\w+)/);
      expect(featureRequestMatch, 'featurerequest registration not found').to.not.be.null;
      const featureRequestHandler = featureRequestMatch[1];

      // Extract the handler name used for fr
      const frMatch = content.match(/\['fr',\s*\{\s*fn:\s*(\w+)/);
      expect(frMatch, 'fr registration not found').to.not.be.null;
      const frHandler = frMatch[1];

      expect(frHandler).to.equal(
        featureRequestHandler,
        `fr should use the same handler as featurerequest (expected "${featureRequestHandler}", got "${frHandler}")`
      );
    });

    it('should define the _featurerequest handler function', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include('async function _featurerequest(input, channel, userName)');
    });

    it('fr alias registration should appear after featurerequest registration', function () {
      const content = readProjectFile('index.js');

      const featureRequestIdx = content.indexOf("['featurerequest', { fn: _featurerequest");
      const frIdx = content.indexOf("['fr', { fn: _featurerequest");

      expect(featureRequestIdx).to.be.greaterThan(
        -1,
        'featurerequest command registration not found in index.js'
      );
      expect(frIdx).to.be.greaterThan(
        -1,
        'fr alias registration not found in index.js'
      );
      expect(frIdx).to.be.greaterThan(
        featureRequestIdx,
        'fr alias should be registered after featurerequest'
      );
    });

    it('should not register fr more than once', function () {
      const content = readProjectFile('index.js');

      // Count occurrences of the fr registration line
      const occurrences = (content.match(/\['fr',\s*\{\s*fn:\s*_featurerequest/g) || []).length;
      expect(occurrences).to.equal(1, 'fr alias should be registered exactly once');
    });

    it('should not register featurerequest more than once', function () {
      const content = readProjectFile('index.js');

      const occurrences = (
        content.match(/\['featurerequest',\s*\{\s*fn:\s*_featurerequest/g) || []
      ).length;
      expect(occurrences).to.equal(1, 'featurerequest should be registered exactly once');
    });
  });

  // -------------------------------------------------------------------------
  // Handler Implementation (index.js)
  // -------------------------------------------------------------------------

  describe('Feature Request Handler Implementation in index.js', function () {

    it('should call the GitHub Issues API endpoint', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include('api.github.com/repos/htilly/SlackONOS/issues');
    });

    it('should apply the enhancement label to created issues', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include("labels: ['enhancement']");
    });

    it('should include requester information in the issue body', function () {
      const content = readProjectFile('index.js');
      expect(content).to.include('Requested by');
    });
  });

  // -------------------------------------------------------------------------
  // Help Text — templates/help/helpText.txt
  // -------------------------------------------------------------------------

  describe('User-facing help text (templates/help/helpText.txt)', function () {

    it('should document featurerequest command', function () {
      const content = readProjectFile('templates/help/helpText.txt');
      expect(content).to.include('featurerequest');
    });

    it('should document fr as an alias for featurerequest', function () {
      const content = readProjectFile('templates/help/helpText.txt');
      expect(content).to.include('fr');
    });

    it('should show fr as an alias alongside featurerequest on the same line or entry', function () {
      const content = readProjectFile('templates/help/helpText.txt');

      // The alias notation should appear in the same logical entry, e.g.:
      //   `featurerequest` (alias: `fr`) ...
      // We look for both tokens within a reasonable proximity (same line).
      const lines = content.split('\n');
      const featureRequestLine = lines.find(
        (line) => line.includes('featurerequest') && line.includes('fr')
      );

      expect(featureRequestLine).to.not.be.undefined;
    });

    it('should use the alias notation pattern for fr', function () {
      const content = readProjectFile('templates/help/helpText.txt');
      // Expect something like: (alias: `fr`) or alias: fr
      expect(content).to.match(/alias.*fr|fr.*alias/i);
    });

    it('should describe the feature request purpose', function () {
      const content = readProjectFile('templates/help/helpText.txt');
      // The entry should mention GitHub or feature request creation
      expect(content).to.match(/GitHub|feature request|issue/i);
    });
  });

  // -------------------------------------------------------------------------
  // Admin Help Text — templates/help/helpTextAdmin.txt
  // -------------------------------------------------------------------------

  describe('Admin help text (templates/help/helpTextAdmin.txt)', function () {

    it('should document featurerequest command', function () {
      const content = readProjectFile('templates/help/helpTextAdmin.txt');
      expect(content).to.include('featurerequest');
    });
  });

  // -------------------------------------------------------------------------
  // Configuration — config/config.json.example
  // -------------------------------------------------------------------------

  describe('Configuration (config/config.json.example)', function () {

    it('should include githubToken field', function () {
      const content = readProjectFile('config/config.json.example');
      expect(content).to.include('"githubToken"');
    });
  });

  // -------------------------------------------------------------------------
  // Behavioural parity — both commands share identical registration shape
  // -------------------------------------------------------------------------

  describe('Behavioural parity between featurerequest and fr', function () {

    it('featurerequest and fr registrations should have the same structure', function () {
      const content = readProjectFile('index.js');

      // Capture the full registration object for featurerequest
      const featureRequestMatch = content.match(
        /\['featurerequest',\s*(\{[^}]+\})/
      );
      expect(featureRequestMatch, 'featurerequest registration block not found').to.not.be.null;

      // Capture the full registration object for fr
      const frMatch = content.match(/\['fr',\s*(\{[^}]+\})/);
      expect(frMatch, 'fr registration block not found').to.not.be.null;

      // Normalise whitespace for comparison
      const normalise = (str) => str.replace(/\s+/g, ' ').trim();
      expect(normalise(frMatch[1])).to.equal(
        normalise(featureRequestMatch[1]),
        'fr and featurerequest should have identical registration objects'
      );
    });

    it('fr handler reference should be _featurerequest (not a different function)', function () {
      const content = readProjectFile('index.js');

      const frMatch = content.match(/\['fr',\s*\{\s*fn:\s*(\w+)/);
      expect(frMatch, 'fr registration not found').to.not.be.null;

      expect(frMatch[1]).to.equal(
        '_featurerequest',
        'fr must point to _featurerequest, not a wrapper or different function'
      );
    });

    it('featurerequest handler reference should be _featurerequest', function () {
      const content = readProjectFile('index.js');

      const match = content.match(/\['featurerequest',\s*\{\s*fn:\s*(\w+)/);
      expect(match, 'featurerequest registration not found').to.not.be.null;

      expect(match[1]).to.equal(
        '_featurerequest',
        'featurerequest must point to _featurerequest'
      );
    });
  });
});
