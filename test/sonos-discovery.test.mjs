import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fetchDeviceInfo } = require('../lib/sonos-discovery.js');

/**
 * Regression coverage for security-review finding O-005: fetchDeviceInfo()
 * used to pass an SSDP-supplied LOCATION URL straight to http.get() with no
 * validation - any LAN host could point the server at loopback, cloud
 * metadata, or another internal host by forging its LOCATION header. The fix
 * requires plain http, an IPv4 host matching the actual UDP responder, a
 * non-loopback/link-local/multicast address, and the fixed port a real
 * Sonos serves its description from (1400) before ever calling http.get().
 *
 * http.get is a Node core-module method, shared as the same singleton
 * object whether obtained via `import` (here) or the `require('http')`
 * sonos-discovery.js does internally - stubbing it here reaches the real
 * call site with no network I/O.
 */
describe('sonos-discovery - fetchDeviceInfo SSRF gating (O-005)', function() {
  let httpGetStub;

  afterEach(function() {
    if (httpGetStub) httpGetStub.restore();
  });

  function makeFakeRequest() {
    const req = new EventEmitter();
    req.destroy = sinon.stub();
    req.setTimeout = sinon.stub();
    return req;
  }

  const FALLBACK_UNKNOWN = (ip) => ({ ip, name: `Sonos Device (${ip})`, model: 'Unknown' });

  it('never calls http.get when the LOCATION host does not match the actual UDP responder', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('http://10.0.0.99:1400/xml/device_description.xml', '10.0.0.5');
    expect(httpGetStub.called).to.be.false;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('10.0.0.5'));
  });

  it('rejects https (only plain http is a legitimate Sonos description fetch)', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('https://10.0.0.5:1400/xml/device_description.xml', '10.0.0.5');
    expect(httpGetStub.called).to.be.false;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('10.0.0.5'));
  });

  it('rejects a port other than 1400 (the real Sonos description port)', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('http://10.0.0.5:8080/xml/device_description.xml', '10.0.0.5');
    expect(httpGetStub.called).to.be.false;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('10.0.0.5'));
  });

  it('rejects loopback, even when the UDP responder itself claims to be loopback', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('http://127.0.0.1:1400/xml/device_description.xml', '127.0.0.1');
    expect(httpGetStub.called).to.be.false;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('127.0.0.1'));
  });

  it('rejects the cloud-metadata address (169.254.169.254)', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('http://169.254.169.254:1400/x', '169.254.169.254');
    expect(httpGetStub.called).to.be.false;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('169.254.169.254'));
  });

  it('rejects a non-IPv4 hostname', async function() {
    httpGetStub = sinon.stub(http, 'get');
    const result = await fetchDeviceInfo('http://attacker.example.com:1400/x', 'attacker.example.com');
    expect(httpGetStub.called).to.be.false;
  });

  it('fetches and parses a genuine same-host, port-1400 target', async function() {
    const fakeRes = new EventEmitter();
    const fakeReq = makeFakeRequest();
    httpGetStub = sinon.stub(http, 'get').callsFake((location, cb) => {
      process.nextTick(() => cb(fakeRes));
      return fakeReq;
    });

    const promise = fetchDeviceInfo('http://192.168.1.50:1400/xml/device_description.xml', '192.168.1.50');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeRes.emit('data', Buffer.from(
      '<root><device><friendlyName>Living Room</friendlyName><modelName>Sonos One</modelName></device></root>'
    ));
    fakeRes.emit('end');

    const result = await promise;
    expect(httpGetStub.calledOnce).to.be.true;
    expect(result).to.deep.equal({ ip: '192.168.1.50', name: 'Living Room', model: 'Sonos One' });
  });

  it('caps the response body and aborts rather than accumulating an unbounded reply', async function() {
    const fakeRes = new EventEmitter();
    const fakeReq = makeFakeRequest();
    httpGetStub = sinon.stub(http, 'get').callsFake((location, cb) => {
      process.nextTick(() => cb(fakeRes));
      return fakeReq;
    });

    const promise = fetchDeviceInfo('http://192.168.1.50:1400/xml/device_description.xml', '192.168.1.50');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeRes.emit('data', Buffer.alloc(70000, 'a')); // over the 64KB cap

    const result = await promise;
    expect(fakeReq.destroy.called).to.be.true;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('192.168.1.50'));
  });

  it('truncates an implausibly long friendlyName rather than carrying it around unbounded', async function() {
    const fakeRes = new EventEmitter();
    const fakeReq = makeFakeRequest();
    httpGetStub = sinon.stub(http, 'get').callsFake((location, cb) => {
      process.nextTick(() => cb(fakeRes));
      return fakeReq;
    });

    const longName = 'X'.repeat(500);
    const promise = fetchDeviceInfo('http://192.168.1.50:1400/xml/device_description.xml', '192.168.1.50');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeRes.emit('data', Buffer.from(
      `<root><device><friendlyName>${longName}</friendlyName><modelName>Sonos One</modelName></device></root>`
    ));
    fakeRes.emit('end');

    const result = await promise;
    expect(result.name.length).to.equal(128);
  });

  it('falls back gracefully on a request error even for a safe target', async function() {
    const fakeReq = makeFakeRequest();
    httpGetStub = sinon.stub(http, 'get').callsFake(() => fakeReq);

    const promise = fetchDeviceInfo('http://192.168.1.50:1400/xml/device_description.xml', '192.168.1.50');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeReq.emit('error', new Error('ECONNREFUSED'));

    const result = await promise;
    expect(result).to.deep.equal(FALLBACK_UNKNOWN('192.168.1.50'));
  });
});
