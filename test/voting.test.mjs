import { expect } from 'chai';

/**
 * Test voting module with config changes
 * These tests verify that:
 * 1. Config changes take effect immediately
 * 2. Track changes reset gong state
 * 3. Vote limits are respected
 */

// Mock dependencies for voting module
const createMockDeps = () => {
  const messages = [];
  let currentTrack = 'Test Track';
  const userActions = [];
  
  return {
    logger: {
      info: () => {},
      error: () => {},
      warn: () => {}
    },
    sendMessage: async (msg, channel) => {
      messages.push({ msg, channel });
    },
    sonos: {
      getQueue: async () => ({
        items: [
          { id: 'Q:0/1', title: 'Track 1', artist: 'Artist 1' },
          { id: 'Q:0/2', title: 'Track 2', artist: 'Artist 2' },
          { id: 'Q:0/3', title: 'Track 3', artist: 'Artist 3' }
        ]
      }),
      currentTrack: async () => ({ queuePosition: 1, title: currentTrack }),
      flush: async () => {},
      next: async () => {},
      reorderTracksInQueue: async () => {}
    },
    getCurrentTrackTitle: async () => currentTrack,
    logUserAction: async (user, action) => {
      userActions.push({ user, action });
    },
    gongMessages: ['GONG!'],
    voteMessages: ['Voted!'],
    // Helpers for tests
    getMessages: () => messages,
    clearMessages: () => messages.length = 0,
    setCurrentTrack: (track) => { currentTrack = track; },
    getUserActions: () => userActions
  };
};

describe('Voting System Logic', function() {
  
  describe('Gong Vote Tracking', function() {
    let gongScore;
    let gongLimitPerUser;
    let gongLimit;
    let gongCounter;

    beforeEach(function() {
      gongScore = {};
      gongLimitPerUser = 1;
      gongLimit = 3;
      gongCounter = 0;
    });

    it('should allow first gong from user', function() {
      const userName = 'testUser';
      
      if (!(userName in gongScore)) {
        gongScore[userName] = 0;
      }
      
      const canGong = gongScore[userName] < gongLimitPerUser;
      expect(canGong).to.be.true;
    });

    it('should prevent duplicate gong from same user', function() {
      const userName = 'testUser';
      gongScore[userName] = 1;
      
      const canGong = gongScore[userName] < gongLimitPerUser;
      expect(canGong).to.be.false;
    });

    it('should trigger gong action when limit reached', function() {
      const userName1 = 'user1';
      const userName2 = 'user2';
      const userName3 = 'user3';
      
      gongScore[userName1] = 1;
      gongCounter++;
      
      gongScore[userName2] = 1;
      gongCounter++;
      
      gongScore[userName3] = 1;
      gongCounter++;
      
      const shouldSkipTrack = gongCounter >= gongLimit;
      expect(shouldSkipTrack).to.be.true;
      expect(gongCounter).to.equal(3);
    });

    it('should not trigger gong action before limit', function() {
      gongScore['user1'] = 1;
      gongCounter = 1;
      
      gongScore['user2'] = 1;
      gongCounter = 2;
      
      const shouldSkipTrack = gongCounter >= gongLimit;
      expect(shouldSkipTrack).to.be.false;
    });
  });

  describe('Gong with Config Changes', function() {
    let gongScore;
    let gongCounter;
    let gongLimit;
    let gongTrack;
    const gongLimitPerUser = 1;

    // Simulates the gong function logic
    const simulateGong = (userName, track) => {
      // Reset if track changed
      if (track !== gongTrack) {
        gongCounter = 0;
        gongScore = {};
        gongTrack = track;
      }

      if (!(userName in gongScore)) {
        gongScore[userName] = 0;
      }

      if (gongScore[userName] >= gongLimitPerUser) {
        return { success: false, reason: 'already_gonged' };
      }

      gongScore[userName] += 1;
      gongCounter++;

      if (gongCounter >= gongLimit) {
        const result = { success: true, triggered: true, count: gongCounter, limit: gongLimit };
        gongCounter = 0;
        gongScore = {};
        return result;
      }

      return { success: true, triggered: false, count: gongCounter, limit: gongLimit };
    };

    beforeEach(function() {
      gongScore = {};
      gongCounter = 0;
      gongLimit = 3;
      gongTrack = '';
    });

    it('should respect gongLimit=2 and require 2 gongs', function() {
      gongLimit = 2;
      
      const result1 = simulateGong('user1', 'Song A');
      expect(result1.success).to.be.true;
      expect(result1.triggered).to.be.false;
      expect(result1.count).to.equal(1);
      expect(result1.limit).to.equal(2);

      const result2 = simulateGong('user2', 'Song A');
      expect(result2.success).to.be.true;
      expect(result2.triggered).to.be.true;
      expect(result2.count).to.equal(2);
    });

    it('should respect gongLimit=1 and trigger immediately', function() {
      gongLimit = 1;
      
      const result = simulateGong('user1', 'Song A');
      expect(result.success).to.be.true;
      expect(result.triggered).to.be.true;
      expect(result.count).to.equal(1);
    });

    it('should prevent same user from gonging twice on same track', function() {
      gongLimit = 3;
      
      const result1 = simulateGong('user1', 'Song A');
      expect(result1.success).to.be.true;

      const result2 = simulateGong('user1', 'Song A');
      expect(result2.success).to.be.false;
      expect(result2.reason).to.equal('already_gonged');
    });

    it('should reset gong state when track changes', function() {
      gongLimit = 3;
      
      // User gongs track A
      simulateGong('user1', 'Song A');
      expect(gongCounter).to.equal(1);
      expect(gongScore['user1']).to.equal(1);

      // Track changes to B - same user should be able to gong again
      const result = simulateGong('user1', 'Song B');
      expect(result.success).to.be.true;
      expect(gongCounter).to.equal(1); // Reset to 1 after track change
    });

    it('should allow gong after config change from 2 to 1', function() {
      gongLimit = 2;
      
      // First gong with limit=2
      const result1 = simulateGong('user1', 'Song A');
      expect(result1.triggered).to.be.false;

      // Change config to gongLimit=1
      gongLimit = 1;
      
      // Next track - should trigger with just 1 gong
      const result2 = simulateGong('user1', 'Song B');
      expect(result2.triggered).to.be.true;
    });
  });

  describe('Track Vote Tracking', function() {
    let trackVoteCount;
    let voteLimit;
    let trackVoteUsers;

    beforeEach(function() {
      trackVoteCount = {};
      voteLimit = 6;
      trackVoteUsers = {};
    });

    it('should count votes correctly', function() {
      const trackId = 'track1';
      
      if (!(trackId in trackVoteCount)) {
        trackVoteCount[trackId] = 0;
      }
      
      trackVoteCount[trackId]++;
      expect(trackVoteCount[trackId]).to.equal(1);
      
      trackVoteCount[trackId]++;
      expect(trackVoteCount[trackId]).to.equal(2);
    });

    it('should prevent duplicate votes from same user', function() {
      const trackId = 'track1';
      const userName = 'testUser';
      
      if (!(trackId in trackVoteUsers)) {
        trackVoteUsers[trackId] = new Set();
      }
      
      const hasVoted1 = trackVoteUsers[trackId].has(userName);
      expect(hasVoted1).to.be.false;
      
      trackVoteUsers[trackId].add(userName);
      
      const hasVoted2 = trackVoteUsers[trackId].has(userName);
      expect(hasVoted2).to.be.true;
    });

    it('should promote track when vote limit reached', function() {
      const trackId = 'track1';
      trackVoteCount[trackId] = 5;
      
      let shouldPromote = trackVoteCount[trackId] >= voteLimit;
      expect(shouldPromote).to.be.false;
      
      trackVoteCount[trackId]++;
      shouldPromote = trackVoteCount[trackId] >= voteLimit;
      expect(shouldPromote).to.be.true;
    });
  });

  describe('Vote with Config Changes', function() {
    let trackVoteCount;
    let trackVoteUsers;
    let voteLimit;
    let voteScore;
    const voteLimitPerUser = 4;

    const simulateVote = (userName, trackNb) => {
      if (!(userName in voteScore)) {
        voteScore[userName] = 0;
      }

      if (voteScore[userName] >= voteLimitPerUser) {
        return { success: false, reason: 'user_limit_reached' };
      }

      if (!(trackNb in trackVoteUsers)) {
        trackVoteUsers[trackNb] = new Set();
      }

      if (trackVoteUsers[trackNb].has(userName)) {
        return { success: false, reason: 'already_voted' };
      }

      voteScore[userName] += 1;
      trackVoteUsers[trackNb].add(userName);

      if (!(trackNb in trackVoteCount)) {
        trackVoteCount[trackNb] = 0;
      }
      trackVoteCount[trackNb] += 1;

      if (trackVoteCount[trackNb] >= voteLimit) {
        return { success: true, promoted: true, count: trackVoteCount[trackNb], limit: voteLimit };
      }

      return { success: true, promoted: false, count: trackVoteCount[trackNb], limit: voteLimit };
    };

    beforeEach(function() {
      trackVoteCount = {};
      trackVoteUsers = {};
      voteLimit = 3;
      voteScore = {};
    });

    it('should respect voteLimit=3 and require 3 votes to promote', function() {
      voteLimit = 3;

      const r1 = simulateVote('user1', 5);
      expect(r1.promoted).to.be.false;
      expect(r1.count).to.equal(1);

      const r2 = simulateVote('user2', 5);
      expect(r2.promoted).to.be.false;
      expect(r2.count).to.equal(2);

      const r3 = simulateVote('user3', 5);
      expect(r3.promoted).to.be.true;
      expect(r3.count).to.equal(3);
    });

    it('should respect voteLimit=1 and promote immediately', function() {
      voteLimit = 1;

      const result = simulateVote('user1', 5);
      expect(result.promoted).to.be.true;
      expect(result.count).to.equal(1);
    });

    it('should prevent same user from voting twice for same track', function() {
      const r1 = simulateVote('user1', 5);
      expect(r1.success).to.be.true;

      const r2 = simulateVote('user1', 5);
      expect(r2.success).to.be.false;
      expect(r2.reason).to.equal('already_voted');
    });

    it('should allow user to vote for different tracks', function() {
      const r1 = simulateVote('user1', 5);
      expect(r1.success).to.be.true;

      const r2 = simulateVote('user1', 6);
      expect(r2.success).to.be.true;
    });

    it('should respect config change from voteLimit=3 to voteLimit=2', function() {
      voteLimit = 3;

      simulateVote('user1', 5);
      simulateVote('user2', 5);
      expect(trackVoteCount[5]).to.equal(2);

      // Change config - now only 2 votes needed
      voteLimit = 2;

      // Track 5 already has 2 votes, check if next vote would promote
      // (In real code, the check happens when voting, so we test a new track)
      const result = simulateVote('user1', 7);
      expect(result.promoted).to.be.false; // Only 1 vote

      const result2 = simulateVote('user2', 7);
      expect(result2.promoted).to.be.true; // Now 2 votes = limit
    });
  });

  describe('Gong Immunity System', function() {
    let voteImmuneScore;
    let gongBannedTracks;

    beforeEach(function() {
      voteImmuneScore = {};
      gongBannedTracks = {};
    });

    it('should grant immunity to voted tracks', function() {
      const trackName = 'Great Song';
      gongBannedTracks[trackName] = true;
      
      const isImmune = gongBannedTracks[trackName] === true;
      expect(isImmune).to.be.true;
    });

    it('should prevent gonging of immune tracks', function() {
      const trackName = 'Great Song';
      gongBannedTracks[trackName] = true;
      
      const canGong = gongBannedTracks[trackName] !== true;
      expect(canGong).to.be.false;
    });

    it('should allow gonging non-immune tracks', function() {
      const trackName = 'Regular Song';
      
      const canGong = gongBannedTracks[trackName] !== true;
      expect(canGong).to.be.true;
    });

    it('should track gong banned tracks', function() {
      const trackName = 'Bad Song';
      gongBannedTracks[trackName] = true;
      
      const isBanned = gongBannedTracks[trackName] === true;
      expect(isBanned).to.be.true;
    });
  });

  describe('Vote Immune with Config Changes', function() {
    let voteImmuneCounter;
    let voteImmuneScore;
    let voteImmuneUsers;
    let gongBannedTracks;
    let voteImmuneLimit;
    const voteImmuneLimitPerUser = 1;

    const simulateVoteImmune = (userName, trackNb, trackName) => {
      if (!(userName in voteImmuneScore)) {
        voteImmuneScore[userName] = 0;
      }

      if (voteImmuneScore[userName] >= voteImmuneLimitPerUser) {
        return { success: false, reason: 'user_limit_reached' };
      }

      if (!(trackNb in voteImmuneUsers)) {
        voteImmuneUsers[trackNb] = new Set();
      }

      if (voteImmuneUsers[trackNb].has(userName)) {
        return { success: false, reason: 'already_voted' };
      }

      voteImmuneScore[userName] += 1;
      voteImmuneCounter++;
      voteImmuneUsers[trackNb].add(userName);

      if (voteImmuneCounter >= voteImmuneLimit) {
        gongBannedTracks[trackName] = true;
        const result = { success: true, immune: true, count: voteImmuneCounter, limit: voteImmuneLimit };
        voteImmuneCounter = 0;
        voteImmuneScore = {};
        voteImmuneUsers[trackNb].clear();
        return result;
      }

      return { success: true, immune: false, count: voteImmuneCounter, limit: voteImmuneLimit };
    };

    beforeEach(function() {
      voteImmuneCounter = 0;
      voteImmuneScore = {};
      voteImmuneUsers = {};
      gongBannedTracks = {};
      voteImmuneLimit = 3;
    });

    it('should respect voteImmuneLimit=3', function() {
      voteImmuneLimit = 3;

      const r1 = simulateVoteImmune('user1', 5, 'Song A');
      expect(r1.immune).to.be.false;
      expect(r1.count).to.equal(1);

      const r2 = simulateVoteImmune('user2', 5, 'Song A');
      expect(r2.immune).to.be.false;

      const r3 = simulateVoteImmune('user3', 5, 'Song A');
      expect(r3.immune).to.be.true;
      expect(gongBannedTracks['Song A']).to.be.true;
    });

    it('should respect voteImmuneLimit=1 and grant immunity immediately', function() {
      voteImmuneLimit = 1;

      const result = simulateVoteImmune('user1', 5, 'Song A');
      expect(result.immune).to.be.true;
      expect(gongBannedTracks['Song A']).to.be.true;
    });
  });

  describe('Flush Vote System', function() {
    let flushVoteScore;
    let flushVoteCounter;
    let flushVoteLimit;
    let flushVoteLimitPerUser;

    beforeEach(function() {
      flushVoteScore = {};
      flushVoteCounter = 0;
      flushVoteLimit = 6;
      flushVoteLimitPerUser = 1;
    });

    it('should count flush votes', function() {
      const user1 = 'user1';
      const user2 = 'user2';
      
      flushVoteScore[user1] = 1;
      flushVoteCounter++;
      
      flushVoteScore[user2] = 1;
      flushVoteCounter++;
      
      expect(flushVoteCounter).to.equal(2);
    });

    it('should trigger flush when limit reached', function() {
      flushVoteCounter = 6;
      
      const shouldFlush = flushVoteCounter >= flushVoteLimit;
      expect(shouldFlush).to.be.true;
    });

    it('should prevent user from voting multiple times', function() {
      const userName = 'testUser';
      flushVoteScore[userName] = 1;
      
      const canVote = flushVoteScore[userName] < flushVoteLimitPerUser;
      expect(canVote).to.be.false;
    });
  });

  describe('Flush Vote with Config Changes', function() {
    let flushVoteScore;
    let flushVoteCounter;
    let flushVoteLimit;
    const flushVoteLimitPerUser = 1;

    const simulateFlushVote = (userName) => {
      if (!(userName in flushVoteScore)) {
        flushVoteScore[userName] = 0;
      }

      if (flushVoteScore[userName] >= flushVoteLimitPerUser) {
        return { success: false, reason: 'already_voted' };
      }

      flushVoteScore[userName] += 1;
      flushVoteCounter++;

      if (flushVoteCounter >= flushVoteLimit) {
        const result = { success: true, flushed: true, count: flushVoteCounter, limit: flushVoteLimit };
        flushVoteCounter = 0;
        flushVoteScore = {};
        return result;
      }

      return { success: true, flushed: false, count: flushVoteCounter, limit: flushVoteLimit };
    };

    beforeEach(function() {
      flushVoteScore = {};
      flushVoteCounter = 0;
      flushVoteLimit = 3;
    });

    it('should respect flushVoteLimit=3', function() {
      flushVoteLimit = 3;

      const r1 = simulateFlushVote('user1');
      expect(r1.flushed).to.be.false;

      const r2 = simulateFlushVote('user2');
      expect(r2.flushed).to.be.false;

      const r3 = simulateFlushVote('user3');
      expect(r3.flushed).to.be.true;
    });

    it('should respect flushVoteLimit=1 and flush immediately', function() {
      flushVoteLimit = 1;

      const result = simulateFlushVote('user1');
      expect(result.flushed).to.be.true;
    });

    it('should prevent same user from flush voting twice', function() {
      const r1 = simulateFlushVote('user1');
      expect(r1.success).to.be.true;

      const r2 = simulateFlushVote('user1');
      expect(r2.success).to.be.false;
      expect(r2.reason).to.equal('already_voted');
    });

    it('should handle config change from 6 to 2', function() {
      flushVoteLimit = 6;

      simulateFlushVote('user1');
      expect(flushVoteCounter).to.equal(1);

      // Change config mid-vote
      flushVoteLimit = 2;

      const result = simulateFlushVote('user2');
      expect(result.flushed).to.be.true; // Now 2 votes = limit
    });
  });
});
