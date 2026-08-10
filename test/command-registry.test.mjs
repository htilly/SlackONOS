import { expect } from 'chai';
import sinon from 'sinon';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createCommandRegistry } = require('../lib/command-registry.js');

describe('Command Registry', function() {
  function makeRegistry() {
    const handlers = {
      addHandlers: {
        add: sinon.stub(),
        addalbum: sinon.stub(),
        addplaylist: sinon.stub(),
        append: sinon.stub(),
      },
      commandHandlers: {
        search: sinon.stub(),
        searchalbum: sinon.stub(),
        searchplaylist: sinon.stub(),
        listQueue: sinon.stub(),
        showQueue: sinon.stub(),
        upNext: sinon.stub(),
        getVolume: sinon.stub(),
        countQueue: sinon.stub(),
        nextTrack: sinon.stub(),
        stop: sinon.stub(),
        flush: sinon.stub(),
        play: sinon.stub(),
        pause: sinon.stub(),
        resume: sinon.stub(),
        previous: sinon.stub(),
        shuffle: sinon.stub(),
        normal: sinon.stub(),
        setVolume: sinon.stub(),
        removeTrack: sinon.stub(),
        purgeHalfQueue: sinon.stub(),
        resetVotes: sinon.stub(),
      },
      voting: {
        gong: sinon.stub(),
        gongcheck: sinon.stub(),
        voteImmune: sinon.stub(),
        vote: sinon.stub(),
        voteImmunecheck: sinon.stub(),
        votecheck: sinon.stub(),
        flushvote: sinon.stub(),
        listImmune: sinon.stub(),
      },
      currentTrack: sinon.stub(),
      showSource: sinon.stub(),
      gongplay: sinon.stub(),
      status: sinon.stub(),
      help: sinon.stub(),
      bestof: sinon.stub(),
      debug: sinon.stub(),
      telemetryStatus: sinon.stub(),
      setCrossfade: sinon.stub(),
      setconfig: sinon.stub(),
      blacklist: sinon.stub(),
      trackblacklist: sinon.stub(),
      tts: sinon.stub(),
      moveTrackAdmin: sinon.stub(),
      stats: sinon.stub(),
      configdump: sinon.stub(),
      aiUnparsed: sinon.stub(),
      listOpenAIModels: sinon.stub(),
      featurerequest: sinon.stub(),
      addToSpotifyPlaylist: sinon.stub(),
      diagnostics: sinon.stub(),
    };

    return {
      handlers,
      registry: createCommandRegistry(handlers),
    };
  }

  it('registers expected public command aliases', function() {
    const { registry } = makeRegistry();

    expect(registry.get('current').aliases).to.deep.equal(['wtf']);
    expect(registry.get('list').aliases).to.deep.equal(['ls', 'playlist']);
    expect(registry.get('listall').admin).to.equal(false);
    expect(registry.get('size').aliases).to.deep.equal(['count', 'count(list)']);
  });

  it('marks admin commands as admin-only', function() {
    const { registry } = makeRegistry();

    expect(registry.get('debug').admin).to.equal(true);
    expect(registry.get('flush').admin).to.equal(true);
    expect(registry.get('setconfig').admin).to.equal(true);
    expect(registry.get('aimodels').admin).to.equal(true);
    expect(registry.get('resetvotes').admin).to.equal(true);
    expect(registry.get('add').admin).to.equal(false);
  });

  it('registers resetvotes with its expected aliases', function() {
    const { registry } = makeRegistry();

    expect(registry.get('resetvotes').aliases).to.deep.equal(['clearvotes', 'votereset']);
  });

  it('uses injected handlers for wrapped commands', function() {
    const { handlers, registry } = makeRegistry();

    registry.get('source').fn(['source'], 'C123', '<@U1>');
    registry.get('list').fn(['list'], 'C123', '<@U1>');
    registry.get('listall').fn(['listall'], 'C123', '<@U1>');
    registry.get('setcrossfade').fn(['setcrossfade', 'on'], 'ADMIN', '<@U1>');
    registry.get('aimodels').fn(['aimodels'], 'ADMIN', '<@U1>');
    registry.get('diagnostics').fn(['diagnostics'], 'ADMIN', '<@U1>');
    registry.get('resetvotes').fn(['resetvotes'], 'ADMIN', '<@U1>');

    expect(handlers.showSource.calledWith('C123')).to.be.true;
    expect(handlers.commandHandlers.listQueue.calledWith(['list'], 'C123')).to.be.true;
    expect(handlers.commandHandlers.showQueue.calledWith('C123')).to.be.true;
    expect(handlers.setCrossfade.calledWith(['setcrossfade', 'on'], 'ADMIN', '<@U1>')).to.be.true;
    expect(handlers.listOpenAIModels.calledWith(['aimodels'], 'ADMIN', '<@U1>')).to.be.true;
    expect(handlers.diagnostics.calledWith(['diagnostics'], 'ADMIN', '<@U1>')).to.be.true;
    expect(handlers.commandHandlers.resetVotes.calledWith(['resetvotes'], 'ADMIN', '<@U1>')).to.be.true;
  });
});
