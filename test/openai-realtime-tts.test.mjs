import { expect } from 'chai';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const tts = require('../lib/openai-realtime-tts.js');

/** Minimal stand-in for OpenAIRealtimeWS: records sent events, lets tests emit server events. */
class FakeRealtime extends EventEmitter {
  constructor({ open = true } = {}) {
    super();
    this.sent = [];
    this.closed = false;
    this.socket = new EventEmitter();
    this.socket.readyState = open ? 1 : 0;
  }
  send(event) { this.sent.push(event); }
  close() { this.closed = true; }
}

function pcmChunk(bytes) {
  return Buffer.from(bytes).toString('base64');
}

describe('OpenAI Realtime TTS', function() {
  describe('model and voice resolution', function() {
    it('maps retired /v1/audio/speech models to the Realtime default', function() {
      for (const legacy of ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'tts-1', 'tts-1-hd', 'TTS-1']) {
        expect(tts.resolveRealtimeTtsModel(legacy)).to.deep.equal({
          model: 'gpt-realtime-2.1-mini',
          replaced: legacy
        });
      }
    });

    it('uses the default model when none is configured', function() {
      expect(tts.resolveRealtimeTtsModel('')).to.deep.equal({ model: 'gpt-realtime-2.1-mini', replaced: null });
      expect(tts.resolveRealtimeTtsModel(undefined).model).to.equal('gpt-realtime-2.1-mini');
    });

    it('keeps an explicitly configured Realtime model', function() {
      expect(tts.resolveRealtimeTtsModel(' gpt-realtime-2.1 ')).to.deep.equal({ model: 'gpt-realtime-2.1', replaced: null });
    });

    it('keeps supported voices and replaces speech-only voices', function() {
      expect(tts.resolveRealtimeTtsVoice('Alloy')).to.deep.equal({ voice: 'alloy', replaced: null });
      expect(tts.resolveRealtimeTtsVoice('cedar')).to.deep.equal({ voice: 'cedar', replaced: null });
      for (const old of ['fable', 'onyx', 'nova']) {
        expect(tts.resolveRealtimeTtsVoice(old)).to.deep.equal({ voice: 'marin', replaced: old });
      }
      expect(tts.resolveRealtimeTtsVoice('')).to.deep.equal({ voice: 'marin', replaced: null });
    });

    it('clamps speed to the Realtime range 0.25–1.5', function() {
      expect(tts.clampRealtimeSpeed(4)).to.equal(1.5);
      expect(tts.clampRealtimeSpeed(0.1)).to.equal(0.25);
      expect(tts.clampRealtimeSpeed(1.2)).to.equal(1.2);
      expect(tts.clampRealtimeSpeed('nope')).to.equal(1);
    });
  });

  describe('buildSessionUpdate', function() {
    it('requests audio-only PCM output with the voice and no turn detection', function() {
      const event = tts.buildSessionUpdate({ model: 'gpt-realtime-2.1-mini', voice: 'marin', speed: 3, instructions: '' });
      expect(event.type).to.equal('session.update');
      expect(event.session.type).to.equal('realtime');
      expect(event.session.output_modalities).to.deep.equal(['audio']);
      expect(event.session.audio.output).to.deep.equal({
        format: { type: 'audio/pcm', rate: 24000 },
        voice: 'marin',
        speed: 1.5
      });
      expect(event.session.audio.input.turn_detection).to.equal(null);
      expect(event.session.instructions).to.match(/exactly as written/);
      expect(event.session.instructions).to.not.match(/Voice direction/);
    });

    it('appends voice direction to the verbatim instructions', function() {
      const event = tts.buildSessionUpdate({ model: 'm', voice: 'marin', speed: 1, instructions: 'calm and friendly' });
      expect(event.session.instructions).to.match(/exactly as written/);
      expect(event.session.instructions).to.match(/Voice direction: calm and friendly$/);
    });
  });

  describe('synthesizeRealtimeSpeech', function() {
    it('sends session, message and response events and returns concatenated PCM', async function() {
      const rt = new FakeRealtime();
      let usedModel;
      const promise = tts.synthesizeRealtimeSpeech({
        client: {},
        text: 'Hello office',
        model: 'gpt-realtime-2.1-mini',
        voice: 'marin',
        createConnection: (client, model) => { usedModel = model; return rt; }
      });

      expect(usedModel).to.equal('gpt-realtime-2.1-mini');
      expect(rt.sent.map(e => e.type)).to.deep.equal(['session.update', 'conversation.item.create', 'response.create']);
      expect(rt.sent[1].item.content).to.deep.equal([{ type: 'input_text', text: 'Hello office' }]);

      rt.emit('response.output_audio.delta', { delta: pcmChunk([1, 2]) });
      rt.emit('response.output_audio.delta', { delta: pcmChunk([3, 4]) });
      rt.emit('response.done', { response: { status: 'completed' } });

      const pcm = await promise;
      expect([...pcm]).to.deep.equal([1, 2, 3, 4]);
      expect(rt.closed).to.equal(true);
    });

    it('waits for the socket to open before sending', async function() {
      const rt = new FakeRealtime({ open: false });
      const promise = tts.synthesizeRealtimeSpeech({
        client: {}, text: 'hi', model: 'm', voice: 'marin', createConnection: () => rt
      });
      expect(rt.sent).to.have.length(0);
      rt.socket.emit('open');
      expect(rt.sent).to.have.length(3);
      rt.emit('response.output_audio.delta', { delta: pcmChunk([9, 9]) });
      rt.emit('response.done', { response: { status: 'completed' } });
      expect([...(await promise)]).to.deep.equal([9, 9]);
    });

    it('rejects on API errors', async function() {
      const rt = new FakeRealtime();
      const promise = tts.synthesizeRealtimeSpeech({
        client: {}, text: 'hi', model: 'm', voice: 'marin', createConnection: () => rt
      });
      rt.emit('error', { error: { message: 'model not found' } });
      try {
        await promise;
        expect.fail('should reject');
      } catch (err) {
        expect(err.message).to.equal('OpenAI Realtime TTS error: model not found');
      }
      expect(rt.closed).to.equal(true);
    });

    it('rejects when the response fails or has no audio', async function() {
      const failed = new FakeRealtime();
      const p1 = tts.synthesizeRealtimeSpeech({ client: {}, text: 'hi', model: 'm', voice: 'marin', createConnection: () => failed });
      failed.emit('response.done', { response: { status: 'failed', status_details: { error: { message: 'quota' } } } });
      await p1.then(() => expect.fail('should reject'), err => expect(err.message).to.match(/failed: quota/));

      const empty = new FakeRealtime();
      const p2 = tts.synthesizeRealtimeSpeech({ client: {}, text: 'hi', model: 'm', voice: 'marin', createConnection: () => empty });
      empty.emit('response.done', { response: { status: 'completed' } });
      await p2.then(() => expect.fail('should reject'), err => expect(err.message).to.match(/no audio/));
    });

    it('rejects when the connection closes before a response', async function() {
      const rt = new FakeRealtime({ open: false });
      const promise = tts.synthesizeRealtimeSpeech({ client: {}, text: 'hi', model: 'm', voice: 'marin', createConnection: () => rt });
      rt.socket.emit('close', 1006);
      await promise.then(() => expect.fail('should reject'), err => expect(err.message).to.match(/closed \(code 1006\)/));
    });

    it('times out', async function() {
      const rt = new FakeRealtime();
      const promise = tts.synthesizeRealtimeSpeech({
        client: {}, text: 'hi', model: 'm', voice: 'marin', timeoutMs: 10, createConnection: () => rt
      });
      await promise.then(() => expect.fail('should reject'), err => expect(err.message).to.match(/timed out after 10ms/));
      expect(rt.closed).to.equal(true);
    });

    it('rejects empty text without connecting', async function() {
      let connected = false;
      await tts.synthesizeRealtimeSpeech({
        client: {}, text: '  ', model: 'm', voice: 'marin', createConnection: () => { connected = true; }
      }).then(() => expect.fail('should reject'), err => expect(err.message).to.match(/No text/));
      expect(connected).to.equal(false);
    });
  });

  describe('WAV helpers', function() {
    it('wraps PCM in a valid 24 kHz mono 16-bit WAV header', function() {
      const pcm = Buffer.alloc(48000); // 1 second of 24 kHz 16-bit mono
      const wav = tts.pcmToWav(pcm);
      expect(wav.length).to.equal(44 + 48000);
      expect(wav.toString('ascii', 0, 4)).to.equal('RIFF');
      expect(wav.toString('ascii', 8, 12)).to.equal('WAVE');
      expect(wav.readUInt32LE(4)).to.equal(36 + 48000);
      expect(wav.readUInt16LE(20)).to.equal(1); // PCM
      expect(wav.readUInt16LE(22)).to.equal(1); // mono
      expect(wav.readUInt32LE(24)).to.equal(24000);
      expect(wav.readUInt16LE(34)).to.equal(16);
      expect(wav.readUInt32LE(40)).to.equal(48000);
    });

    it('computes duration from the WAV header', function() {
      expect(tts.wavDurationSeconds(tts.pcmToWav(Buffer.alloc(48000)))).to.equal(1);
      expect(tts.wavDurationSeconds(tts.pcmToWav(Buffer.alloc(12000)))).to.equal(0.25);
      expect(() => tts.wavDurationSeconds(Buffer.from('not a wav'))).to.throw(/Not a WAV/);
    });
  });
});
