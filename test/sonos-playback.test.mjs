import { expect } from 'chai';
import sinon from 'sinon';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const {
  getFirstQueuedTrackNumber,
  playFromQueue
} = require('../lib/sonos-playback.js');

describe('Sonos Playback Helpers', function() {
  let avTransport;
  let logger;
  let sonos;

  beforeEach(function() {
    avTransport = {
      GetMediaInfo: sinon.stub().resolves({ CurrentURI: 'x-rincon:external-source' }),
      SetAVTransportURI: sinon.stub().resolves(),
      Seek: sinon.stub().resolves()
    };

    logger = {
      debug: sinon.stub(),
      warn: sinon.stub()
    };

    sonos = {
      avTransportService: sinon.stub().returns(avTransport),
      deviceDescription: sinon.stub().resolves({ UDN: 'uuid:RINCON_00112233445501400' }),
      getQueue: sinon.stub().resolves({
        items: [{ title: 'Track 1', artist: 'Artist 1' }],
        total: 1
      }),
      play: sinon.stub().resolves()
    };
  });

  afterEach(function() {
    sinon.restore();
  });

  it('switches to the Sonos queue before selecting a track and playing', async function() {
    await playFromQueue(sonos, logger, { trackNumber: 1 });

    expect(avTransport.SetAVTransportURI.calledOnce).to.equal(true);
    expect(avTransport.SetAVTransportURI.firstCall.args[0]).to.deep.equal({
      InstanceID: 0,
      CurrentURI: 'x-rincon-queue:RINCON_00112233445501400#0',
      CurrentURIMetaData: ''
    });
    expect(avTransport.Seek.calledOnceWith({
      InstanceID: 0,
      Unit: 'TRACK_NR',
      Target: '1'
    })).to.equal(true);
    expect(sonos.play.calledOnce).to.equal(true);
    expect(avTransport.SetAVTransportURI.calledBefore(avTransport.Seek)).to.equal(true);
    expect(avTransport.Seek.calledBefore(sonos.play)).to.equal(true);
  });

  it('does not switch source when the Sonos queue is already active', async function() {
    avTransport.GetMediaInfo.resolves({
      CurrentURI: 'x-rincon-queue:RINCON_00112233445501400#0'
    });

    await playFromQueue(sonos, logger, { trackNumber: 1 });

    expect(avTransport.SetAVTransportURI.called).to.equal(false);
    expect(avTransport.Seek.calledOnce).to.equal(true);
    expect(sonos.play.calledOnce).to.equal(true);
  });

  it('falls back to plain play if the queue source cannot be selected', async function() {
    sonos.avTransportService = sinon.stub().throws(new Error('No AVTransport'));

    await playFromQueue(sonos, logger, { waitForQueue: false, trackNumber: 1 });

    expect(sonos.play.calledOnce).to.equal(true);
    expect(logger.debug.calledWithMatch('Could not select Sonos queue before playback')).to.equal(true);
  });

  it('extracts the first queued track number from Sonos queue results', function() {
    expect(getFirstQueuedTrackNumber({ FirstTrackNumberEnqueued: '3' }, 1)).to.equal(3);
    expect(getFirstQueuedTrackNumber({}, 2)).to.equal(2);
    expect(getFirstQueuedTrackNumber({}, null)).to.equal(null);
  });
});
