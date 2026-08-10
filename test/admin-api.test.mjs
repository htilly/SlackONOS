import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const createAdminApi = require('../lib/admin-api.js');

function createConfig(initial = {}) {
  const store = { ...initial };
  return {
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value;
    },
    save: (cb) => {
      if (cb) cb(null);
    },
    store
  };
}

function createApi(overrides = {}) {
  const config = overrides.config || createConfig({
    maxVolume: 75,
    spotifyClientId: 'spotify-client',
    spotifyClientSecret: 'spotify-secret',
    sonos: '192.168.1.10'
  });

  const logger = overrides.logger || {
    debug: sinon.stub(),
    error: sinon.stub(),
    info: sinon.stub(),
    setLevel: sinon.stub(),
    warn: sinon.stub()
  };

  return createAdminApi({
    config,
    logger,
    sonos: overrides.sonos || {
      currentTrack: sinon.stub().resolves({ title: 'Track', artist: 'Artist', album: 'Album', position: 10, duration: 100 }),
      deviceDescription: sinon.stub().resolves({ modelDescription: 'Speaker', roomName: 'Room', softwareVersion: '1', hardwareVersion: '2' }),
      getCurrentState: sinon.stub().resolves('playing'),
      getQueue: sinon.stub().resolves({ items: [{ title: 'Next', artist: 'Queue Artist' }] }),
      getVolume: sinon.stub().resolves(42),
      pause: sinon.stub().resolves(),
      play: sinon.stub().resolves(),
      stop: sinon.stub().resolves()
    },
    spotify: overrides.spotify || { searchTrackList: sinon.stub().resolves([]) },
    soundcraft: overrides.soundcraft || { isEnabled: sinon.stub().returns(false) },
    slack: overrides.slack || { isConnected: sinon.stub().returns(true) },
    slackAppToken: overrides.slackAppToken || 'xapp-test',
    slackBotToken: overrides.slackBotToken || 'xoxb-test',
    DiscordSystem: overrides.DiscordSystem || { getDiscordClient: sinon.stub().returns(null) },
    logBuffer: overrides.logBuffer || [],
    maxLogBufferSize: 1000,
    setRuntimeConfigValue: overrides.setRuntimeConfigValue || sinon.stub(),
    syncVotingConfig: overrides.syncVotingConfig || sinon.stub()
  });
}

describe('Admin API module', function() {
  it('updates runtime config callbacks for numeric admin settings', async function() {
    const config = createConfig({ maxVolume: 75 });
    const setRuntimeConfigValue = sinon.stub();
    const api = createApi({ config, setRuntimeConfigValue });

    const result = await api.updateConfigValue('maxVolume', '55');

    expect(result.success).to.equal(true);
    expect(config.store.maxVolume).to.equal(55);
    expect(setRuntimeConfigValue.calledOnceWithExactly('maxVolume', 55)).to.equal(true);
  });

  it('syncs voting config when vote limits change', async function() {
    const config = createConfig({ voteLimit: 6 });
    const setRuntimeConfigValue = sinon.stub();
    const syncVotingConfig = sinon.stub();
    const api = createApi({ config, setRuntimeConfigValue, syncVotingConfig });

    const result = await api.updateConfigValue('voteLimit', '4');

    expect(result.success).to.equal(true);
    expect(config.store.voteLimit).to.equal(4);
    expect(setRuntimeConfigValue.calledOnceWithExactly('voteLimit', 4)).to.equal(true);
    expect(syncVotingConfig.calledOnce).to.equal(true);
  });

  it('allows updating queueThreadThreshold via admin config', async function() {
    const config = createConfig({ queueThreadThreshold: 20 });
    const api = createApi({ config });

    const result = await api.updateConfigValue('queueThreadThreshold', '12');

    expect(result.success).to.equal(true);
    expect(config.store.queueThreadThreshold).to.equal(12);
  });

  it('allows updating OpenAI TTS settings via admin config', async function() {
    const config = createConfig({ ttsProvider: 'google', openaiTtsSpeed: 1 });
    const api = createApi({ config });

    const providerResult = await api.updateConfigValue('ttsProvider', 'openai');
    const speedResult = await api.updateConfigValue('openaiTtsSpeed', '1.25');

    expect(providerResult.success).to.equal(true);
    expect(speedResult.success).to.equal(true);
    expect(config.store.ttsProvider).to.equal('openai');
    expect(config.store.openaiTtsSpeed).to.equal(1.25);
  });

  it('returns now-playing data from Sonos with upcoming queue tracks', async function() {
    const sonos = {
      currentTrack: sinon.stub().resolves({ title: 'Track', artist: 'Artist', album: 'Album', position: 10, duration: 100 }),
      deviceDescription: sinon.stub().resolves({}),
      getCurrentState: sinon.stub().resolves('playing'),
      getQueue: sinon.stub().resolves({ items: [{ title: 'Next', artist: 'Queue Artist' }] }),
      getVolume: sinon.stub().resolves(42)
    };
    const api = createApi({ sonos });

    const result = await api.getNowPlaying();

    expect(result.state).to.equal('playing');
    expect(result.volume).to.equal(42);
    expect(result.track.title).to.equal('Track');
    expect(result.nextTracks).to.deep.equal([{ title: 'Next', artist: 'Queue Artist' }]);
  });

  describe('#updateConfigValue edge cases', function() {
    it('rejects a key that is not on the admin allow-list', async function() {
      const config = createConfig({});
      const api = createApi({ config });

      const result = await api.updateConfigValue('someRandomInternalKey', 'value');

      expect(result).to.deep.equal({ success: false, error: 'Key not allowed to be updated via admin' });
      expect(config.store.someRandomInternalKey).to.equal(undefined);
    });

    it('accepts a valid log level and applies it live via logger.setLevel', async function() {
      const config = createConfig({ logLevel: 'info' });
      const logger = {
        debug: sinon.stub(), error: sinon.stub(), info: sinon.stub(),
        setLevel: sinon.stub(), warn: sinon.stub()
      };
      const api = createApi({ config, logger });

      const result = await api.updateConfigValue('logLevel', 'debug');

      expect(result.success).to.equal(true);
      expect(config.store.logLevel).to.equal('debug');
      expect(logger.setLevel.calledOnceWithExactly('debug')).to.equal(true);
      expect(logger.warn.calledOnce).to.equal(true);
    });

    it('rejects an invalid log level without touching the logger or config', async function() {
      const config = createConfig({ logLevel: 'info' });
      const logger = {
        debug: sinon.stub(), error: sinon.stub(), info: sinon.stub(),
        setLevel: sinon.stub(), warn: sinon.stub()
      };
      const api = createApi({ config, logger });

      const result = await api.updateConfigValue('logLevel', 'shout');

      expect(result.success).to.equal(false);
      expect(result.error).to.match(/Invalid log level/);
      expect(config.store.logLevel).to.equal('info');
      expect(logger.setLevel.called).to.equal(false);
    });

    it('rejects a non-numeric value for a numeric config key', async function() {
      const config = createConfig({ maxVolume: 75 });
      const api = createApi({ config });

      const result = await api.updateConfigValue('maxVolume', 'loud');

      expect(result.success).to.equal(false);
      expect(result.error).to.match(/Must be a number/);
      expect(config.store.maxVolume).to.equal(75);
    });

    it('coerces boolean-ish strings to true', async function() {
      const config = createConfig({ ttsEnabled: false });
      const api = createApi({ config });

      for (const truthy of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) {
        const result = await api.updateConfigValue('ttsEnabled', truthy);
        expect(result.success, `expected "${truthy}" to succeed`).to.equal(true);
        expect(config.store.ttsEnabled, `expected "${truthy}" to coerce to true`).to.equal(true);
      }
    });

    it('coerces non-matching strings to false for boolean config keys', async function() {
      const config = createConfig({ ttsEnabled: true });
      const api = createApi({ config });

      const result = await api.updateConfigValue('ttsEnabled', 'nope');

      expect(result.success).to.equal(true);
      expect(config.store.ttsEnabled).to.equal(false);
    });

    it('coerces a non-string value for a boolean key via Boolean()', async function() {
      const config = createConfig({ crossfadeEnabled: false });
      const api = createApi({ config });

      const result = await api.updateConfigValue('crossfadeEnabled', 1);

      expect(result.success).to.equal(true);
      expect(config.store.crossfadeEnabled).to.equal(true);
    });

    it('logs an error but still reports success when persisting the config fails', async function() {
      const logger = {
        debug: sinon.stub(), error: sinon.stub(), info: sinon.stub(),
        setLevel: sinon.stub(), warn: sinon.stub()
      };
      const config = {
        store: { maxVolume: 75 },
        get(key) { return this.store[key]; },
        set(key, value) { this.store[key] = value; },
        save(cb) { cb(new Error('disk full')); }
      };
      const api = createApi({ config, logger });

      const result = await api.updateConfigValue('maxVolume', '60');

      expect(result.success).to.equal(true);
      expect(config.store.maxVolume).to.equal(60);
      expect(logger.error.calledWithMatch('Failed to save config:')).to.equal(true);
    });

    it('returns a failure result when an unexpected error is thrown', async function() {
      const config = {
        get() { return undefined; },
        set() { throw new Error('unexpected failure'); },
        save() {}
      };
      const api = createApi({ config });

      const result = await api.updateConfigValue('maxVolume', '60');

      expect(result).to.deep.equal({ success: false, error: 'unexpected failure' });
    });
  });
});
