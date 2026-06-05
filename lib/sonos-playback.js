/**
 * Helpers for starting playback from the Sonos queue.
 */

const DEFAULT_QUEUE_TIMEOUT_MS = 2500;
const DEFAULT_QUEUE_INTERVAL_MS = 300;
const QUEUE_SOURCE_DELAY_MS = 300;
const PLAY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toPositiveTrackNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getFirstQueuedTrackNumber(queueResult, fallback = 1) {
  return toPositiveTrackNumber(queueResult && queueResult.FirstTrackNumberEnqueued) ||
    toPositiveTrackNumber(fallback);
}

function queueHasItems(queue) {
  return Boolean(
    queue &&
    (
      (Array.isArray(queue.items) && queue.items.length > 0) ||
      Number(queue.total) > 0
    )
  );
}

async function waitForQueueItems(sonos, logger, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_QUEUE_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let attempt = 1;

  while (Date.now() <= deadline) {
    try {
      const queue = await sonos.getQueue();
      if (queueHasItems(queue)) {
        logger.debug(`Queue verified: ${queue.items ? queue.items.length : queue.total} items ready`);
        return queue;
      }

      logger.debug(`Queue not ready yet (attempt ${attempt}), waiting...`);
    } catch (err) {
      logger.debug(`Queue check failed (attempt ${attempt}): ${err.message}`);
    }

    attempt++;
    await sleep(intervalMs);
  }

  return null;
}

async function getQueueUri(sonos, logger) {
  if (typeof sonos.deviceDescription === 'function') {
    try {
      const deviceInfo = await sonos.deviceDescription();
      const uid = deviceInfo && deviceInfo.UDN && deviceInfo.UDN.replace(/^uuid:/, '');
      if (uid) {
        return `x-rincon-queue:${uid}#0`;
      }
    } catch (err) {
      logger.debug('Could not read Sonos device description: ' + err.message);
    }
  }

  if (typeof sonos.getZoneInfo === 'function') {
    const zoneInfo = await sonos.getZoneInfo();
    if (zoneInfo && zoneInfo.MACAddress) {
      const port = sonos.port || 1400;
      return `x-rincon-queue:RINCON_${zoneInfo.MACAddress.replace(/:/g, '')}0${port}#0`;
    }
  }

  throw new Error('Could not determine Sonos queue URI');
}

function isQueueUri(uri) {
  return typeof uri === 'string' && uri.toLowerCase().startsWith('x-rincon-queue:');
}

async function ensureQueueSelected(sonos, logger) {
  const avTransport = sonos.avTransportService();
  let currentUri = null;

  if (avTransport && typeof avTransport.GetMediaInfo === 'function') {
    try {
      const mediaInfo = await avTransport.GetMediaInfo();
      currentUri = mediaInfo && mediaInfo.CurrentURI;
      if (isQueueUri(currentUri)) {
        logger.debug('Sonos queue is already the active transport source');
        return { changed: false, queueUri: currentUri };
      }
    } catch (err) {
      logger.debug('Could not read current Sonos transport source: ' + err.message);
    }
  }

  const queueUri = await getQueueUri(sonos, logger);
  if (currentUri === queueUri) {
    return { changed: false, queueUri };
  }

  logger.debug('Switching Sonos transport source to queue');
  await avTransport.SetAVTransportURI({
    InstanceID: 0,
    CurrentURI: queueUri,
    CurrentURIMetaData: ''
  });
  await sleep(QUEUE_SOURCE_DELAY_MS);

  return { changed: true, queueUri };
}

async function selectQueueTrack(sonos, logger, trackNumber) {
  const normalizedTrackNumber = toPositiveTrackNumber(trackNumber);
  if (!normalizedTrackNumber) {
    return false;
  }

  try {
    if (typeof sonos.selectTrack === 'function') {
      await sonos.selectTrack(normalizedTrackNumber);
    } else {
      await sonos.avTransportService().Seek({
        InstanceID: 0,
        Unit: 'TRACK_NR',
        Target: String(normalizedTrackNumber)
      });
    }

    logger.debug(`Selected Sonos queue track ${normalizedTrackNumber}`);
    await sleep(PLAY_DELAY_MS);
    return true;
  } catch (err) {
    logger.debug(`Could not select Sonos queue track ${normalizedTrackNumber}: ${err.message}`);
    return false;
  }
}

async function playFromQueue(sonos, logger, options = {}) {
  const waitForQueue = options.waitForQueue !== false;
  const trackNumber = toPositiveTrackNumber(options.trackNumber);
  let queueSelected = false;

  if (waitForQueue) {
    const queue = await waitForQueueItems(sonos, logger, {
      timeoutMs: options.queueTimeoutMs,
      intervalMs: options.queueIntervalMs
    });

    if (!queue) {
      logger.warn('Queue not ready before playback attempt, trying playback anyway');
    }
  }

  try {
    await ensureQueueSelected(sonos, logger);
    queueSelected = true;
  } catch (err) {
    logger.debug('Could not select Sonos queue before playback: ' + err.message);
  }

  if (queueSelected && trackNumber) {
    await selectQueueTrack(sonos, logger, trackNumber);
  }

  if (queueSelected) {
    await sleep(PLAY_DELAY_MS);
  }

  await sonos.play();
  return true;
}

module.exports = {
  playFromQueue,
  ensureQueueSelected,
  getFirstQueuedTrackNumber
};
