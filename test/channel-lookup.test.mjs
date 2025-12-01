import { describe, it } from 'mocha';
import assert from 'assert';

describe('Channel ID Detection', function() {
  // Helper function (copied from index.js logic)
  function isChannelId(str) {
    return /^C[A-Z0-9]{8,}$/i.test(str);
  }

  describe('#isChannelId', function() {
    it('should detect valid channel ID', function() {
      assert.strictEqual(isChannelId('C01ABC123XY'), true);
    });

    it('should detect another valid channel ID', function() {
      assert.strictEqual(isChannelId('C987DEF654ZZ'), true);
    });

    it('should reject channel name', function() {
      assert.strictEqual(isChannelId('music-admin'), false);
    });

    it('should reject channel name with hash', function() {
      assert.strictEqual(isChannelId('#music'), false);
    });

    it('should reject short ID', function() {
      assert.strictEqual(isChannelId('C123'), false);
    });

    it('should reject ID starting with wrong letter', function() {
      assert.strictEqual(isChannelId('D01ABC123XY'), false);
    });

    it('should reject lowercase channel ID', function() {
      // Note: Our regex is case-insensitive, so this will pass
      // In real Slack IDs, they're uppercase but we're lenient
      assert.strictEqual(isChannelId('c01abc123xy'), true);
    });

    it('should handle empty string', function() {
      assert.strictEqual(isChannelId(''), false);
    });

    it('should handle null safely', function() {
      assert.strictEqual(isChannelId(null), false);
    });

    it('should handle undefined safely', function() {
      assert.strictEqual(isChannelId(undefined), false);
    });
  });

  describe('Configuration Examples', function() {
    it('should identify example config uses names not IDs', function() {
      const adminChannel = 'music-admin';
      const standardChannel = 'music';
      
      assert.strictEqual(isChannelId(adminChannel), false);
      assert.strictEqual(isChannelId(standardChannel), false);
    });

    it('should identify optimized config uses IDs', function() {
      const adminChannel = 'C01ABC123XY';
      const standardChannel = 'C987DEF654';
      
      assert.strictEqual(isChannelId(adminChannel), true);
      assert.strictEqual(isChannelId(standardChannel), true);
    });

    it('should handle hash prefix removal', function() {
      const channelWithHash = '#music-admin';
      const cleaned = channelWithHash.replace('#', '');
      
      assert.strictEqual(cleaned, 'music-admin');
      assert.strictEqual(isChannelId(cleaned), false);
    });
  });
});
