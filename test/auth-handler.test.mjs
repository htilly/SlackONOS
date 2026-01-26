import { expect } from 'chai';
import sinon from 'sinon';

/**
 * Auth Handler Tests
 * Tests password hashing, session management, rate limiting, and cookie handling
 * 
 * Note: We test the pure functions. HTTP handlers are tested via integration tests.
 */

// Import the module (CommonJS)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const authHandler = require('../lib/auth-handler.js');

describe('Auth Handler', function() {
  
  describe('Password Hashing', function() {
    this.timeout(5000); // bcrypt can be slow
    
    it('should hash a password', async function() {
      const password = 'testPassword123';
      const hash = await authHandler.hashPassword(password);
      
      expect(hash).to.be.a('string');
      expect(hash).to.have.length.greaterThan(50); // bcrypt hashes are ~60 chars
      expect(hash).to.match(/^\$2[ab]\$\d{2}\$/); // bcrypt format
    });
    
    it('should generate different hashes for same password', async function() {
      const password = 'testPassword123';
      const hash1 = await authHandler.hashPassword(password);
      const hash2 = await authHandler.hashPassword(password);
      
      expect(hash1).to.not.equal(hash2); // Different salts
    });
    
    it('should verify correct password', async function() {
      const password = 'testPassword123';
      const hash = await authHandler.hashPassword(password);
      
      const isValid = await authHandler.verifyPassword(password, hash);
      expect(isValid).to.be.true;
    });
    
    it('should reject incorrect password', async function() {
      const password = 'testPassword123';
      const hash = await authHandler.hashPassword(password);
      
      const isValid = await authHandler.verifyPassword('wrongPassword', hash);
      expect(isValid).to.be.false;
    });
    
    it('should handle null hash gracefully', async function() {
      const isValid = await authHandler.verifyPassword('password', null);
      expect(isValid).to.be.false;
    });
    
    it('should handle undefined hash gracefully', async function() {
      const isValid = await authHandler.verifyPassword('password', undefined);
      expect(isValid).to.be.false;
    });
    
    it('should handle empty hash gracefully', async function() {
      const isValid = await authHandler.verifyPassword('password', '');
      expect(isValid).to.be.false;
    });
  });

  describe('Session Management', function() {
    let sessionId;
    
    afterEach(function() {
      // Clean up any created sessions
      if (sessionId) {
        authHandler.deleteSession(sessionId);
        sessionId = null;
      }
    });
    
    it('should create a session', function() {
      sessionId = authHandler.createSession('testUser');
      
      expect(sessionId).to.be.a('string');
      expect(sessionId).to.have.length(64); // 32 bytes hex = 64 chars
    });
    
    it('should retrieve a valid session', function() {
      sessionId = authHandler.createSession('testUser');
      
      const session = authHandler.getSession(sessionId);
      expect(session).to.not.be.null;
      expect(session.userId).to.equal('testUser');
      expect(session.created).to.be.a('number');
      expect(session.expires).to.be.a('number');
      expect(session.expires).to.be.greaterThan(Date.now());
    });
    
    it('should return null for non-existent session', function() {
      const session = authHandler.getSession('nonexistent123');
      expect(session).to.be.null;
    });
    
    it('should return null for null session ID', function() {
      const session = authHandler.getSession(null);
      expect(session).to.be.null;
    });
    
    it('should return null for undefined session ID', function() {
      const session = authHandler.getSession(undefined);
      expect(session).to.be.null;
    });
    
    it('should delete a session', function() {
      sessionId = authHandler.createSession('testUser');
      
      // Verify session exists
      let session = authHandler.getSession(sessionId);
      expect(session).to.not.be.null;
      
      // Delete session
      authHandler.deleteSession(sessionId);
      
      // Verify session is gone
      session = authHandler.getSession(sessionId);
      expect(session).to.be.null;
      
      sessionId = null; // Already deleted
    });
    
    it('should update lastActivity on session access', function(done) {
      sessionId = authHandler.createSession('testUser');
      
      const session1 = authHandler.getSession(sessionId);
      const activity1 = session1.lastActivity;
      
      // Wait a bit and access again
      setTimeout(() => {
        const session2 = authHandler.getSession(sessionId);
        expect(session2.lastActivity).to.be.at.least(activity1);
        done();
      }, 10);
    });
    
    it('should create unique session IDs', function() {
      const id1 = authHandler.createSession('user1');
      const id2 = authHandler.createSession('user2');
      const id3 = authHandler.createSession('user3');
      
      expect(id1).to.not.equal(id2);
      expect(id2).to.not.equal(id3);
      expect(id1).to.not.equal(id3);
      
      // Cleanup
      authHandler.deleteSession(id1);
      authHandler.deleteSession(id2);
      authHandler.deleteSession(id3);
    });
  });

  describe('Rate Limiting', function() {
    const testIp = '192.168.1.100';
    
    afterEach(function() {
      // Reset rate limit after each test
      authHandler.resetRateLimit(testIp);
    });
    
    it('should allow first request', function() {
      const result = authHandler.checkRateLimit(testIp);
      
      expect(result.allowed).to.be.true;
      expect(result.remaining).to.equal(4); // 5 attempts - 1
    });
    
    it('should count multiple attempts', function() {
      authHandler.checkRateLimit(testIp); // 1
      authHandler.checkRateLimit(testIp); // 2
      const result = authHandler.checkRateLimit(testIp); // 3
      
      expect(result.allowed).to.be.true;
      expect(result.remaining).to.equal(2); // 5 - 3
    });
    
    it('should block after exceeding limit', function() {
      for (let i = 0; i < 5; i++) {
        authHandler.checkRateLimit(testIp);
      }
      
      const result = authHandler.checkRateLimit(testIp);
      
      expect(result.allowed).to.be.false;
      expect(result.remaining).to.equal(0);
      expect(result.resetTime).to.be.a('number');
    });
    
    it('should reset rate limit on demand', function() {
      // Use up attempts
      for (let i = 0; i < 5; i++) {
        authHandler.checkRateLimit(testIp);
      }
      
      // Verify blocked
      let result = authHandler.checkRateLimit(testIp);
      expect(result.allowed).to.be.false;
      
      // Reset
      authHandler.resetRateLimit(testIp);
      
      // Should be allowed again
      result = authHandler.checkRateLimit(testIp);
      expect(result.allowed).to.be.true;
      expect(result.remaining).to.equal(4);
    });
    
    it('should track different IPs independently', function() {
      const ip1 = '10.0.0.1';
      const ip2 = '10.0.0.2';
      
      // Use up attempts on ip1
      for (let i = 0; i < 5; i++) {
        authHandler.checkRateLimit(ip1);
      }
      
      // ip1 should be blocked
      expect(authHandler.checkRateLimit(ip1).allowed).to.be.false;
      
      // ip2 should still be allowed
      expect(authHandler.checkRateLimit(ip2).allowed).to.be.true;
      
      // Cleanup
      authHandler.resetRateLimit(ip1);
      authHandler.resetRateLimit(ip2);
    });
  });

  describe('Cookie Handling', function() {
    describe('getSessionIdFromCookie', function() {
      it('should extract session ID from cookie header', function() {
        const cookie = 'sessionId=abc123def456';
        const result = authHandler.getSessionIdFromCookie(cookie);
        
        expect(result).to.equal('abc123def456');
      });
      
      it('should handle multiple cookies', function() {
        const cookie = 'theme=dark; sessionId=abc123; lang=en';
        const result = authHandler.getSessionIdFromCookie(cookie);
        
        expect(result).to.equal('abc123');
      });
      
      it('should handle URL-encoded session ID', function() {
        const encoded = encodeURIComponent('special+session/id=test');
        const cookie = `sessionId=${encoded}`;
        const result = authHandler.getSessionIdFromCookie(cookie);
        
        expect(result).to.equal('special+session/id=test');
      });
      
      it('should return null for missing sessionId cookie', function() {
        const cookie = 'theme=dark; lang=en';
        const result = authHandler.getSessionIdFromCookie(cookie);
        
        expect(result).to.be.null;
      });
      
      it('should return null for null cookie header', function() {
        const result = authHandler.getSessionIdFromCookie(null);
        expect(result).to.be.null;
      });
      
      it('should return null for undefined cookie header', function() {
        const result = authHandler.getSessionIdFromCookie(undefined);
        expect(result).to.be.null;
      });
      
      it('should return null for empty cookie header', function() {
        const result = authHandler.getSessionIdFromCookie('');
        expect(result).to.be.null;
      });
    });
    
    describe('setSessionCookie', function() {
      it('should set HTTP-only cookie', function() {
        const res = { setHeader: sinon.stub() };
        authHandler.setSessionCookie(res, 'test123', false);
        
        expect(res.setHeader.calledOnce).to.be.true;
        expect(res.setHeader.firstCall.args[0]).to.equal('Set-Cookie');
        
        const cookieValue = res.setHeader.firstCall.args[1];
        expect(cookieValue).to.include('sessionId=test123');
        expect(cookieValue).to.include('HttpOnly');
        expect(cookieValue).to.include('SameSite=Strict');
        expect(cookieValue).to.include('Path=/');
      });
      
      it('should add Secure flag when requested', function() {
        const res = { setHeader: sinon.stub() };
        authHandler.setSessionCookie(res, 'test123', true);
        
        const cookieValue = res.setHeader.firstCall.args[1];
        expect(cookieValue).to.include('Secure');
      });
      
      it('should not add Secure flag when not requested', function() {
        const res = { setHeader: sinon.stub() };
        authHandler.setSessionCookie(res, 'test123', false);
        
        const cookieValue = res.setHeader.firstCall.args[1];
        expect(cookieValue).to.not.include('Secure');
      });
      
      it('should URL-encode session ID', function() {
        const res = { setHeader: sinon.stub() };
        authHandler.setSessionCookie(res, 'test=123', false);
        
        const cookieValue = res.setHeader.firstCall.args[1];
        expect(cookieValue).to.include('sessionId=test%3D123');
      });
    });
    
    describe('clearSessionCookie', function() {
      it('should set expired cookie', function() {
        const res = { setHeader: sinon.stub() };
        authHandler.clearSessionCookie(res);
        
        expect(res.setHeader.calledOnce).to.be.true;
        const cookieValue = res.setHeader.firstCall.args[1];
        expect(cookieValue).to.include('sessionId=');
        expect(cookieValue).to.include('Max-Age=0');
      });
    });
  });

  describe('Client IP Detection', function() {
    it('should extract IP from x-forwarded-for header', function() {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
        connection: { remoteAddress: '127.0.0.1' }
      };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('203.0.113.195');
    });
    
    it('should extract IP from x-real-ip header', function() {
      const req = {
        headers: { 'x-real-ip': '203.0.113.195' },
        connection: { remoteAddress: '127.0.0.1' }
      };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('203.0.113.195');
    });
    
    it('should fall back to connection.remoteAddress', function() {
      const req = {
        headers: {},
        connection: { remoteAddress: '192.168.1.50' }
      };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('192.168.1.50');
    });
    
    it('should fall back to socket.remoteAddress', function() {
      const req = {
        headers: {},
        socket: { remoteAddress: '10.0.0.1' }
      };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('10.0.0.1');
    });
    
    it('should return unknown for missing IP', function() {
      const req = { headers: {} };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('unknown');
    });
    
    it('should trim whitespace from x-forwarded-for', function() {
      const req = {
        headers: { 'x-forwarded-for': '  203.0.113.195  , 70.41.3.18' },
        connection: { remoteAddress: '127.0.0.1' }
      };
      
      const ip = authHandler.getClientIp(req);
      expect(ip).to.equal('203.0.113.195');
    });
  });

  describe('verifyAuth', function() {
    let sessionId;
    
    afterEach(function() {
      if (sessionId) {
        authHandler.deleteSession(sessionId);
        sessionId = null;
      }
    });
    
    it('should return authenticated for valid session', function() {
      sessionId = authHandler.createSession('admin');
      const req = {
        headers: { cookie: `sessionId=${sessionId}` }
      };
      
      const result = authHandler.verifyAuth(req);
      
      expect(result.authenticated).to.be.true;
      expect(result.session).to.not.be.undefined;
      expect(result.session.userId).to.equal('admin');
    });
    
    it('should return not authenticated for missing cookie', function() {
      const req = { headers: {} };
      
      const result = authHandler.verifyAuth(req);
      
      expect(result.authenticated).to.be.false;
    });
    
    it('should return not authenticated for invalid session', function() {
      const req = {
        headers: { cookie: 'sessionId=invalid123' }
      };
      
      const result = authHandler.verifyAuth(req);
      
      expect(result.authenticated).to.be.false;
    });
  });

  describe('isPasswordSet', function() {
    it('should return boolean', function() {
      const result = authHandler.isPasswordSet();
      expect(result).to.be.a('boolean');
    });
  });

  describe('getAdminUsername', function() {
    it('should return a string', function() {
      const username = authHandler.getAdminUsername();
      expect(username).to.be.a('string');
    });
    
    it('should return non-empty username', function() {
      const username = authHandler.getAdminUsername();
      expect(username.length).to.be.greaterThan(0);
    });
  });
});
