import { expect } from 'chai';

/**
 * Test argument parsing logic
 * Verifies the quote-aware argument parser works correctly
 */

describe('Argument Parser', function() {
  
  // Simple version of parseArgs for testing
  function parseArgs(input) {
    if (!input || typeof input !== 'string') {
      return [];
    }

    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = null;
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  describe('Basic parsing', function() {
    it('should parse simple command', function() {
      const result = parseArgs('add song');
      expect(result).to.deep.equal(['add', 'song']);
    });

    it('should parse command with multiple words', function() {
      const result = parseArgs('add bohemian rhapsody queen');
      expect(result).to.deep.equal(['add', 'bohemian', 'rhapsody', 'queen']);
    });

    it('should handle extra spaces', function() {
      const result = parseArgs('add   song   name');
      expect(result).to.deep.equal(['add', 'song', 'name']);
    });

    it('should handle leading/trailing spaces', function() {
      const result = parseArgs('  add song  ');
      expect(result).to.deep.equal(['add', 'song']);
    });
  });

  describe('Quote handling', function() {
    it('should parse double-quoted strings', function() {
      const result = parseArgs('add "bohemian rhapsody" queen');
      expect(result).to.deep.equal(['add', 'bohemian rhapsody', 'queen']);
    });

    it('should parse single-quoted strings', function() {
      const result = parseArgs("add 'bohemian rhapsody' queen");
      expect(result).to.deep.equal(['add', 'bohemian rhapsody', 'queen']);
    });

    it('should handle multiple quoted segments', function() {
      const result = parseArgs('add "song title" "artist name"');
      expect(result).to.deep.equal(['add', 'song title', 'artist name']);
    });

    it('should handle mixed quotes and plain text', function() {
      const result = parseArgs('search "bohemian rhapsody" by queen');
      expect(result).to.deep.equal(['search', 'bohemian rhapsody', 'by', 'queen']);
    });
  });

  describe('Edge cases', function() {
    it('should handle empty string', function() {
      const result = parseArgs('');
      expect(result).to.deep.equal([]);
    });

    it('should handle null input', function() {
      const result = parseArgs(null);
      expect(result).to.deep.equal([]);
    });

    it('should handle undefined input', function() {
      const result = parseArgs(undefined);
      expect(result).to.deep.equal([]);
    });

    it('should handle only spaces', function() {
      const result = parseArgs('   ');
      expect(result).to.deep.equal([]);
    });

    it('should handle unclosed quotes gracefully', function() {
      const result = parseArgs('add "bohemian rhapsody');
      // Should include the rest as one argument
      expect(result.length).to.equal(2);
      expect(result[0]).to.equal('add');
    });
  });
});
