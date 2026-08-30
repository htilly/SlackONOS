import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const adminChannelPrivacy = require('../lib/admin-channel-privacy.js');

// Security-review finding O-008: Slack admin authorization is bare channel
// membership. This module doesn't change that (would break existing
// deployments) - it makes the risk visible: a clear log line, a loud
// one-time warning posted to the channel at every startup, and a recurring
// reminder wrapped around every `help` response shown there.
describe('admin-channel-privacy (O-008 visibility)', function() {
  function makeLogger() {
    return { warn: sinon.stub(), info: sinon.stub(), debug: sinon.stub(), error: sinon.stub() };
  }

  describe('#initialize', function() {
    it('throws if no logger is provided', function() {
      expect(() => adminChannelPrivacy.initialize({})).to.throw(/logger/);
    });

    it('accepts minimal deps (logger only)', function() {
      expect(() => adminChannelPrivacy.initialize({ logger: makeLogger() })).to.not.throw();
    });
  });

  describe('#checkAndAnnounce', function() {
    it('returns null and does nothing when adminChannel is falsy (e.g. Discord-only mode)', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().resolves();
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: { conversations: { info: sinon.stub() } } });

      const result = await adminChannelPrivacy.checkAndAnnounce(null);

      expect(result).to.equal(null);
      expect(sendMessage.called).to.be.false;
    });

    it('returns null and logs debug when no Slack web client is available', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().resolves();
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: null });

      const result = await adminChannelPrivacy.checkAndAnnounce('C123');

      expect(result).to.equal(null);
      expect(logger.debug.called).to.be.true;
      expect(sendMessage.called).to.be.false;
    });

    it('confirms a private channel: returns true, logs info, does NOT post a warning', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().resolves();
      const conversationsInfo = sinon.stub().resolves({ channel: { id: 'C123', is_private: true } });
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: { conversations: { info: conversationsInfo } } });

      const result = await adminChannelPrivacy.checkAndAnnounce('C123');

      expect(result).to.equal(true);
      expect(conversationsInfo.calledWith({ channel: 'C123' })).to.be.true;
      expect(logger.info.called).to.be.true;
      expect(logger.warn.called).to.be.false;
      expect(sendMessage.called).to.be.false;
    });

    it('flags a NON-private channel: returns false, logs a clear warning, AND shouts into the channel', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().resolves();
      const conversationsInfo = sinon.stub().resolves({ channel: { id: 'C123', is_private: false } });
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: { conversations: { info: conversationsInfo } } });

      const result = await adminChannelPrivacy.checkAndAnnounce('C123');

      expect(result).to.equal(false);
      expect(logger.warn.calledOnce).to.be.true;
      expect(logger.warn.firstCall.args[0]).to.match(/SECURITY WARNING/i);
      expect(logger.warn.firstCall.args[0]).to.match(/not a private channel/i);
      // "skrik i kanalen" - the announcement must actually be sent, to that channel
      expect(sendMessage.calledOnce).to.be.true;
      expect(sendMessage.firstCall.args[1]).to.equal('C123');
      expect(sendMessage.firstCall.args[0]).to.match(/SECURITY WARNING/i);
    });

    it('treats a failed Slack API call as unknown, not as "private" or "not private"', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().resolves();
      const conversationsInfo = sinon.stub().rejects(new Error('channel_not_found'));
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: { conversations: { info: conversationsInfo } } });

      const result = await adminChannelPrivacy.checkAndAnnounce('C123');

      expect(result).to.equal(null);
      expect(logger.warn.calledOnce).to.be.true;
      expect(logger.warn.firstCall.args[0]).to.include('channel_not_found');
      expect(sendMessage.called).to.be.false; // never shout a claim we can't back up
    });

    it('never throws, even if sendMessage itself rejects', async function() {
      const logger = makeLogger();
      const sendMessage = sinon.stub().rejects(new Error('network down'));
      const conversationsInfo = sinon.stub().resolves({ channel: { id: 'C123', is_private: false } });
      adminChannelPrivacy.initialize({ logger, sendMessage, slackWeb: { conversations: { info: conversationsInfo } } });

      let thrown = null;
      let result;
      try {
        result = await adminChannelPrivacy.checkAndAnnounce('C123');
      } catch (err) {
        thrown = err;
      }

      expect(thrown).to.equal(null);
      expect(result).to.equal(null); // the outer catch treats this as "unknown" too
    });
  });

  describe('#wrapHelpMessage', function() {
    it('wraps the message with the compact warning before and after when isPrivate is false', function() {
      const wrapped = adminChannelPrivacy.wrapHelpMessage('HELP TEXT HERE', false);

      const warning = adminChannelPrivacy.warningText(true);
      expect(wrapped).to.equal(`${warning}\n\nHELP TEXT HERE\n\n${warning}`);
      expect(wrapped.indexOf(warning)).to.equal(0); // appears first...
      expect(wrapped.lastIndexOf(warning)).to.be.greaterThan(wrapped.indexOf('HELP TEXT HERE')); // ...and last
    });

    it('does not touch the message when the channel is confirmed private', function() {
      expect(adminChannelPrivacy.wrapHelpMessage('HELP TEXT HERE', true)).to.equal('HELP TEXT HERE');
    });

    it('does not touch the message when privacy is unknown (null) - never claim an unconfirmed risk', function() {
      expect(adminChannelPrivacy.wrapHelpMessage('HELP TEXT HERE', null)).to.equal('HELP TEXT HERE');
    });
  });

  describe('#warningText', function() {
    it('both variants mention that the channel is not private', function() {
      expect(adminChannelPrivacy.warningText(true)).to.match(/not private/i);
      expect(adminChannelPrivacy.warningText(false)).to.match(/not configured as a private/i);
    });

    it('the compact variant is meaningfully shorter than the full startup announcement', function() {
      expect(adminChannelPrivacy.warningText(true).length).to.be.lessThan(adminChannelPrivacy.warningText(false).length);
    });
  });
});
