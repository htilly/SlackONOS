import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Discord Integration Tests
 * Tests message handling, admin role detection, and reaction handling
 */

describe('Discord Integration', function() {
  
  describe('Track Message Cleanup Logic', function() {
    // Same logic as Slack - 1 hour max age
    const TRACK_MESSAGE_MAX_AGE_MS = 60 * 60 * 1000;
    
    function simulateCleanup(trackMessages, logger = null) {
      const now = Date.now();
      const cutoff = now - TRACK_MESSAGE_MAX_AGE_MS;
      let removedCount = 0;

      for (const [messageId, data] of trackMessages.entries()) {
        if (data.timestamp < cutoff) {
          trackMessages.delete(messageId);
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
      
      trackMessages.set('1234567890123456789', {
        trackName: 'Recent Track',
        timestamp: now - (30 * 60 * 1000)
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(0);
      expect(trackMessages.size).to.equal(1);
    });

    it('should remove old messages (> 1 hour old)', function() {
      const trackMessages = new Map();
      const now = Date.now();
      
      trackMessages.set('1234567890123456789', {
        trackName: 'Old Track',
        timestamp: now - (90 * 60 * 1000)
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(1);
      expect(trackMessages.size).to.equal(0);
    });

    it('should only remove expired messages (mixed ages)', function() {
      const trackMessages = new Map();
      const now = Date.now();
      
      trackMessages.set('111111111111111111', {
        trackName: 'Old Track',
        timestamp: now - (2 * 60 * 60 * 1000)
      });
      trackMessages.set('222222222222222222', {
        trackName: 'Recent Track',
        timestamp: now - (30 * 60 * 1000)
      });
      
      const removed = simulateCleanup(trackMessages);
      
      expect(removed).to.equal(1);
      expect(trackMessages.size).to.equal(1);
      expect(trackMessages.has('222222222222222222')).to.be.true;
    });
  });

  describe('Admin Role Detection', function() {
    // Logic from discord.js - check if user has admin role
    function hasAdminRole(memberRoles, adminRoleNames) {
      if (!memberRoles || !adminRoleNames || adminRoleNames.length === 0) {
        return false;
      }
      
      return memberRoles.some(role => 
        adminRoleNames.includes(role.name) || 
        adminRoleNames.includes(role.id)
      );
    }

    it('should detect admin by role name', function() {
      const memberRoles = [
        { id: 'R123', name: 'DJ' },
        { id: 'R456', name: 'Member' }
      ];
      const adminRoles = ['DJ', 'Admin'];
      
      expect(hasAdminRole(memberRoles, adminRoles)).to.be.true;
    });

    it('should detect admin by role ID', function() {
      const memberRoles = [
        { id: 'R123ADMIN', name: 'Some Role' },
        { id: 'R456', name: 'Member' }
      ];
      const adminRoles = ['R123ADMIN'];
      
      expect(hasAdminRole(memberRoles, adminRoles)).to.be.true;
    });

    it('should return false when no admin role', function() {
      const memberRoles = [
        { id: 'R123', name: 'Member' },
        { id: 'R456', name: 'Guest' }
      ];
      const adminRoles = ['DJ', 'Admin'];
      
      expect(hasAdminRole(memberRoles, adminRoles)).to.be.false;
    });

    it('should handle empty admin roles config', function() {
      const memberRoles = [{ id: 'R123', name: 'DJ' }];
      
      expect(hasAdminRole(memberRoles, [])).to.be.false;
      expect(hasAdminRole(memberRoles, null)).to.be.false;
      expect(hasAdminRole(memberRoles, undefined)).to.be.false;
    });

    it('should handle empty member roles', function() {
      const adminRoles = ['DJ', 'Admin'];
      
      expect(hasAdminRole([], adminRoles)).to.be.false;
      expect(hasAdminRole(null, adminRoles)).to.be.false;
    });
  });

  describe('Channel Allowlist', function() {
    // Logic from discord.js - check if channel is allowed
    function isChannelAllowed(channelId, channelName, allowedChannels) {
      if (!allowedChannels || allowedChannels.length === 0) {
        return true; // No restrictions
      }
      
      return allowedChannels.includes(channelId) || allowedChannels.includes(channelName);
    }

    it('should allow by channel ID', function() {
      const allowed = ['1234567890123456789', 'music'];
      expect(isChannelAllowed('1234567890123456789', 'random-channel', allowed)).to.be.true;
    });

    it('should allow by channel name', function() {
      const allowed = ['1234567890123456789', 'music'];
      expect(isChannelAllowed('9999999999999999999', 'music', allowed)).to.be.true;
    });

    it('should reject non-allowed channels', function() {
      const allowed = ['1234567890123456789', 'music'];
      expect(isChannelAllowed('9999999999999999999', 'random', allowed)).to.be.false;
    });

    it('should allow all channels when no restrictions', function() {
      expect(isChannelAllowed('any', 'any', [])).to.be.true;
      expect(isChannelAllowed('any', 'any', null)).to.be.true;
      expect(isChannelAllowed('any', 'any', undefined)).to.be.true;
    });
  });

  describe('Bot Mention Detection', function() {
    function parseMention(text, botUserId) {
      let cleanText = text;
      let isMention = false;
      
      if (text.includes(`<@${botUserId}>`)) {
        cleanText = text.replace(`<@${botUserId}>`, '').trim();
        isMention = true;
      }
      
      return { cleanText, isMention };
    }

    it('should detect bot mention at start', function() {
      const result = parseMention('<@123456789> add music', '123456789');
      expect(result.isMention).to.be.true;
      expect(result.cleanText).to.equal('add music');
    });

    it('should detect bot mention at end', function() {
      const result = parseMention('play something <@123456789>', '123456789');
      expect(result.isMention).to.be.true;
      expect(result.cleanText).to.equal('play something');
    });

    it('should not detect mention of other users', function() {
      const result = parseMention('<@999999999> hello', '123456789');
      expect(result.isMention).to.be.false;
      expect(result.cleanText).to.equal('<@999999999> hello');
    });

    it('should handle no mention', function() {
      const result = parseMention('add some music', '123456789');
      expect(result.isMention).to.be.false;
      expect(result.cleanText).to.equal('add some music');
    });
  });

  describe('Reaction Emoji Handling', function() {
    // Vote emojis from discord.js
    function isVoteEmoji(emoji) {
      return emoji === '🎵' || emoji === '🎶';
    }

    it('should recognize music note as vote', function() {
      expect(isVoteEmoji('🎵')).to.be.true;
    });

    it('should recognize double music note as vote', function() {
      expect(isVoteEmoji('🎶')).to.be.true;
    });

    it('should not recognize other emojis as vote', function() {
      expect(isVoteEmoji('👍')).to.be.false;
      expect(isVoteEmoji('🔔')).to.be.false;
      expect(isVoteEmoji('❤️')).to.be.false;
    });
  });

  describe('Bot Message Filtering', function() {
    function shouldIgnoreMessage(authorId, isBot, botUserId) {
      return authorId === botUserId || isBot;
    }

    it('should ignore bot own messages', function() {
      expect(shouldIgnoreMessage('BOT123', false, 'BOT123')).to.be.true;
    });

    it('should ignore messages from other bots', function() {
      expect(shouldIgnoreMessage('OTHERBOT', true, 'BOT123')).to.be.true;
    });

    it('should not ignore user messages', function() {
      expect(shouldIgnoreMessage('USER123', false, 'BOT123')).to.be.false;
    });
  });

  describe('Track Message Storage', function() {
    it('should store track info with correct structure', function() {
      const trackMessages = new Map();
      const messageId = '1234567890123456789';
      const trackName = 'Test Track - Artist';
      
      trackMessages.set(messageId, {
        trackName: trackName,
        timestamp: Date.now()
      });
      
      expect(trackMessages.has(messageId)).to.be.true;
      const stored = trackMessages.get(messageId);
      expect(stored.trackName).to.equal(trackName);
      expect(stored.timestamp).to.be.a('number');
    });
  });

  describe('Message Content Handling', function() {
    it('should trim whitespace from message content', function() {
      const text = '   add some music   ';
      expect(text.trim()).to.equal('add some music');
    });

    it('should handle empty message', function() {
      const text = '';
      expect(text.trim()).to.equal('');
    });

    it('should handle message with only whitespace', function() {
      const text = '     ';
      expect(text.trim()).to.equal('');
    });
  });

  describe('Partial Reaction/Message Handling', function() {
    // Test the pattern used in discord.js for handling partial objects
    async function fetchIfPartial(obj) {
      if (obj.partial) {
        await obj.fetch();
        return true;
      }
      return false;
    }

    it('should fetch partial object', async function() {
      const partial = {
        partial: true,
        fetch: sinon.stub().resolves({ partial: false })
      };
      
      const wasFetched = await fetchIfPartial(partial);
      
      expect(wasFetched).to.be.true;
      expect(partial.fetch.calledOnce).to.be.true;
    });

    it('should not fetch non-partial object', async function() {
      const complete = {
        partial: false,
        fetch: sinon.stub().resolves()
      };
      
      const wasFetched = await fetchIfPartial(complete);
      
      expect(wasFetched).to.be.false;
      expect(complete.fetch.called).to.be.false;
    });
  });
});
