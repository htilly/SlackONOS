import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { cleanCommandText: cleanText } = require('../lib/command-router.js');

/**
 * Test text cleaning/sanitization logic
 * Verifies that Slack formatting markers, HTML entities, and other artifacts are properly removed
 */

describe('Text Cleaning', function() {
  describe('HTML entity decoding', function() {
    it('should decode &gt; to >', function() {
      const result = cleanText('&gt; trackblacklist');
      expect(result).to.equal('trackblacklist');
    });

    it('should decode &lt; to <', function() {
      const result = cleanText('value &lt; 10');
      expect(result).to.equal('value < 10');
    });

    it('should decode &amp; to &', function() {
      const result = cleanText('rock &amp; roll');
      expect(result).to.equal('rock & roll');
    });

    it('should decode multiple entities in one string', function() {
      const result = cleanText('&gt; add &quot;song&quot; &amp; artist');
      expect(result).to.equal('add "song" & artist');
    });
  });

  describe('Slack formatting removal', function() {
    it('should remove backticks from inline code', function() {
      const result = cleanText('`trackblacklist`');
      expect(result).to.equal('trackblacklist');
    });

    it('should remove backticks from code blocks', function() {
      const result = cleanText('`add song name`');
      expect(result).to.equal('add song name');
    });

    it('should remove standalone backticks', function() {
      const result = cleanText('add `my` song');
      expect(result).to.equal('add my song');
    });

    it('should remove bold markers', function() {
      const result = cleanText('add *bold song*');
      expect(result).to.equal('add bold song');
    });

    it('should remove italic markers', function() {
      const result = cleanText('add _italic song_');
      expect(result).to.equal('add italic song');
    });

    it('should remove mixed formatting', function() {
      const result = cleanText('*add* `trackblacklist` _now_');
      expect(result).to.equal('add trackblacklist now');
    });
  });

  describe('Quote marker removal', function() {
    it('should remove leading > quote marker', function() {
      const result = cleanText('> trackblacklist');
      expect(result).to.equal('trackblacklist');
    });

    it('should remove leading &gt; HTML entity', function() {
      const result = cleanText('&gt; trackblacklist');
      expect(result).to.equal('trackblacklist');
    });

    it('should remove > with multiple spaces', function() {
      const result = cleanText('>    trackblacklist');
      expect(result).to.equal('trackblacklist');
    });

    it('should only remove leading quote marker', function() {
      const result = cleanText('compare > value');
      expect(result).to.equal('compare > value');
    });
  });

  describe('Number prefix removal', function() {
    it('should remove "1. " prefix', function() {
      const result = cleanText('1. trackblacklist');
      expect(result).to.equal('trackblacklist');
    });

    it('should remove "42. " prefix', function() {
      const result = cleanText('42. add song');
      expect(result).to.equal('add song');
    });

    it('should handle number prefix with multiple spaces', function() {
      const result = cleanText('3.    flush');
      expect(result).to.equal('flush');
    });
  });

  describe('Combined cleaning', function() {
    it('should handle copy-pasted Slack command with all formatting', function() {
      const result = cleanText('&gt; `trackblacklist add *Last Christmas*`');
      expect(result).to.equal('trackblacklist add Last Christmas');
    });

    it('should handle quoted search result', function() {
      const result = cleanText('1. &gt; `add "my song"`');
      expect(result).to.equal('add "my song"');
    });

    it('should handle complex real-world example', function() {
      const result = cleanText('&gt; *setconfig* `gongLimit` _5_');
      expect(result).to.equal('setconfig gongLimit 5');
    });

    it('should preserve quoted strings within commands', function() {
      const result = cleanText('`add "song with spaces"`');
      expect(result).to.equal('add "song with spaces"');
    });

    it('should trim whitespace', function() {
      const result = cleanText('  &gt;   trackblacklist   ');
      expect(result).to.equal('trackblacklist');
    });
  });

  describe('Edge cases', function() {
    it('should handle empty string', function() {
      const result = cleanText('');
      expect(result).to.equal('');
    });

    it('should handle only whitespace', function() {
      const result = cleanText('   ');
      expect(result).to.equal('');
    });

    it('should handle only formatting markers', function() {
      const result = cleanText('`*_*_`');
      expect(result).to.equal('');
    });

    it('should preserve plain text without any formatting', function() {
      const result = cleanText('add song name');
      expect(result).to.equal('add song name');
    });

    it('should handle nested formatting gracefully', function() {
      const result = cleanText('`*nested*`');
      expect(result).to.equal('nested');
    });
  });
});
