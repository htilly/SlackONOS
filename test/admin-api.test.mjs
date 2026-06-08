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
});
