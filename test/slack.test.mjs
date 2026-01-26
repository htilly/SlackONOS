import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Slack Integration Tests
 * Tests message handling, cleanup logic, and channel ID detection
 */

describe('Slack Integration', function() {
  
  describe('Track Message Cleanup Logic', function() {
    // Simulate the cleanup logic from slack.js
    const TRACK_MESSAGE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
    
    function simulateCleanup(trackMessages, logger = null) {
      const now = Date.now();
      const cutoff = now - TRACK_MESSAGE_MAX_AGE_MS;
      let removedCount = 0;

      for (const [messageKey, data] of trackMessages.entries()) {
        if (data.timestamp < cutoff) {
          trackMessages.delete(messageKey);
          removedCount++;
        }
      }

      if (removedCount > 0 && logger) {
        logger.debug(`Cleaned up ${removedCount} old track messages`);
      }
      
      return removedCount;
    }

    it('should keep recent messages (< 1 hour old)', function() {
      const trackMessages = new Map();
      const now = Date.now();
      
      trackMessages.set('C123:1234567890.123456', {
        trackName: 'Recent Track',
        timestamp: now - (30 * 60 * 1000) // 30 minutes ago
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(0);
      expect(trackMessages.size).to.equal(1);
    });

    it('should remove old messages (> 1 hour old)', function() {
      const trackMessages = new Map();
      const now = Date.now();
      
      trackMessages.set('C123:1234567890.123456', {
        trackName: 'Old Track',
        timestamp: now - (90 * 60 * 1000) // 90 minutes ago
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(1);
      expect(trackMessages.size).to.equal(0);
    });

    it('should only remove expired messages (mixed ages)', function() {
      const trackMessages = new Map();
      const now = Date.now();
      
      trackMessages.set('C123:old.message', {
        trackName: 'Old Track',
        timestamp: now - (2 * 60 * 60 * 1000) // 2 hours ago
      });
      trackMessages.set('C123:recent.message', {
        trackName: 'Recent Track',
        timestamp: now - (30 * 60 * 1000) // 30 minutes ago
      });
      trackMessages.set('C123:very.old.message', {
        trackName: 'Very Old Track',
        timestamp: now - (5 * 60 * 60 * 1000) // 5 hours ago
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(2);
      expect(trackMessages.size).to.equal(1);
      expect(trackMessages.has('C123:recent.message')).to.be.true;
    });

    it('should handle empty map gracefully', function() {
      const trackMessages = new Map();
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(0);
    });

    it('should call logger when messages removed', function() {
      const trackMessages = new Map();
      const now = Date.now();
      const logger = { debug: sinon.stub() };
      
      trackMessages.set('C123:old.message', {
        trackName: 'Old Track',
        timestamp: now - (2 * 60 * 60 * 1000)
      });
      
      simulateCleanup(trackMessages, logger);
      
      expect(logger.debug.calledOnce).to.be.true;
      expect(logger.debug.firstCall.args[0]).to.include('Cleaned up 1');
    });
  });

  describe('Channel ID Detection', function() {
    // Logic from slack.js sendMessage - skip Discord channel IDs
    function isDiscordChannelId(channelId) {
      return /^[0-9]{17,22}$/.test(channelId);
    }

    function isSlackChannelId(channelId) {
      // Slack channel IDs start with C, D, G, or W
      return /^[CDGW][A-Z0-9]{8,}$/.test(channelId);
    }

    it('should identify Slack channel IDs', function() {
      expect(isSlackChannelId('C01ABCDEF12')).to.be.true;
      expect(isSlackChannelId('C123456789')).to.be.true;
      expect(isSlackChannelId('D01ABCDEF12')).to.be.true; // DMs
      expect(isSlackChannelId('G01ABCDEF12')).to.be.true; // Groups
    });

    it('should identify Discord channel IDs as non-Slack', function() {
      expect(isDiscordChannelId('1234567890123456789')).to.be.true; // 19 digits
      expect(isDiscordChannelId('12345678901234567890')).to.be.true; // 20 digits
      expect(isDiscordChannelId('123456789012345678901')).to.be.true; // 21 digits
    });

    it('should not identify Slack IDs as Discord', function() {
      expect(isDiscordChannelId('C01ABCDEF12')).to.be.false;
      expect(isDiscordChannelId('D01ABCDEF12')).to.be.false;
    });

    it('should handle edge cases', function() {
      expect(isDiscordChannelId('')).to.be.false;
      expect(isDiscordChannelId('123')).to.be.false; // Too short
      expect(isDiscordChannelId('12345678901234567890123')).to.be.false; // Too long (23 digits)
    });
  });

  describe('Message Text Parsing', function() {
    // Simulate bot mention stripping
    function stripBotMention(text, botUserId) {
      return text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
    }

    it('should strip bot mention from beginning', function() {
      const text = '<@U123BOT> add some music';
      const result = stripBotMention(text, 'U123BOT');
      expect(result).to.equal('add some music');
    });

    it('should strip bot mention from middle', function() {
      const text = 'hey <@U123BOT> play something';
      const result = stripBotMention(text, 'U123BOT');
      expect(result).to.equal('hey  play something');
    });

    it('should handle multiple mentions', function() {
      const text = '<@U123BOT> hello <@U123BOT>';
      const result = stripBotMention(text, 'U123BOT');
      expect(result).to.equal('hello');
    });

    it('should leave text unchanged if no mention', function() {
      const text = 'add some music';
      const result = stripBotMention(text, 'U123BOT');
      expect(result).to.equal('add some music');
    });
  });

  describe('Message Subtype Filtering', function() {
    // Logic from slack.js - which subtypes to ignore
    function shouldIgnoreSubtype(subtype) {
      if (!subtype) return false;
      // Only allow file_share and thread_broadcast subtypes
      return subtype !== 'file_share' && subtype !== 'thread_broadcast';
    }

    it('should not ignore messages without subtype', function() {
      expect(shouldIgnoreSubtype(undefined)).to.be.false;
      expect(shouldIgnoreSubtype(null)).to.be.false;
    });

    it('should not ignore file_share subtype', function() {
      expect(shouldIgnoreSubtype('file_share')).to.be.false;
    });

    it('should not ignore thread_broadcast subtype', function() {
      expect(shouldIgnoreSubtype('thread_broadcast')).to.be.false;
    });

    it('should ignore message_changed subtype', function() {
      expect(shouldIgnoreSubtype('message_changed')).to.be.true;
    });

    it('should ignore message_deleted subtype', function() {
      expect(shouldIgnoreSubtype('message_deleted')).to.be.true;
    });

    it('should ignore bot_message subtype', function() {
      expect(shouldIgnoreSubtype('bot_message')).to.be.true;
    });

    it('should ignore channel_join subtype', function() {
      expect(shouldIgnoreSubtype('channel_join')).to.be.true;
    });
  });

  describe('Reaction Emoji Handling', function() {
    // Vote emojis from slack.js
    const voteEmojis = ['thumbsup', '👍', '+1', 'thumbs_up', 'thumbs-up', 'up', 'upvote', 'vote'];
    
    function isVoteEmoji(emoji) {
      return voteEmojis.includes(emoji);
    }

    it('should recognize thumbsup as vote', function() {
      expect(isVoteEmoji('thumbsup')).to.be.true;
    });

    it('should recognize unicode thumbs up as vote', function() {
      expect(isVoteEmoji('👍')).to.be.true;
    });

    it('should recognize +1 as vote', function() {
      expect(isVoteEmoji('+1')).to.be.true;
    });

    it('should recognize various vote emoji aliases', function() {
      expect(isVoteEmoji('thumbs_up')).to.be.true;
      expect(isVoteEmoji('thumbs-up')).to.be.true;
      expect(isVoteEmoji('up')).to.be.true;
      expect(isVoteEmoji('upvote')).to.be.true;
      expect(isVoteEmoji('vote')).to.be.true;
    });

    it('should not recognize random emojis as vote', function() {
      expect(isVoteEmoji('heart')).to.be.false;
      expect(isVoteEmoji('fire')).to.be.false;
      expect(isVoteEmoji('100')).to.be.false;
      expect(isVoteEmoji('bell')).to.be.false;
    });
  });

  describe('Track Message Storage', function() {
    it('should store track info with correct structure', function() {
      const trackMessages = new Map();
      const channelId = 'C123CHANNEL';
      const messageTs = '1234567890.123456';
      const trackName = 'Test Track - Artist';
      
      const messageKey = `${channelId}:${messageTs}`;
      trackMessages.set(messageKey, {
        trackName: trackName,
        channelId: channelId,
        timestamp: Date.now()
      });
      
      expect(trackMessages.has(messageKey)).to.be.true;
      const stored = trackMessages.get(messageKey);
      expect(stored.trackName).to.equal(trackName);
      expect(stored.channelId).to.equal(channelId);
      expect(stored.timestamp).to.be.a('number');
    });

    it('should create unique keys from channel and timestamp', function() {
      const key1 = 'C123:1234567890.111111';
      const key2 = 'C123:1234567890.222222';
      const key3 = 'C456:1234567890.111111';
      
      expect(key1).to.not.equal(key2);
      expect(key1).to.not.equal(key3);
      expect(key2).to.not.equal(key3);
    });
  });
});
