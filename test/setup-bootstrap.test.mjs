import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  getSetupBootstrapToken,
  isAuthorizedSetupBootstrapRequest,
  timingSafeEqualString
} = require('../lib/setup-bootstrap.js');

function createConfig(token = '') {
  return {
    get: (key) => key === 'setupBootstrapToken' ? token : undefined
  };
}

function createRequest(remoteAddress, headers = {}) {
  return {
    headers,
    socket: { remoteAddress }
  };
}

describe('Setup bootstrap authorization', function() {
  it('allows localhost bootstrap without a token', function() {
    const allowed = isAuthorizedSetupBootstrapRequest(
      createRequest('127.0.0.1'),
      { query: {} },
      { config: createConfig() }
    );

    expect(allowed).to.equal(true);
  });

  it('rejects remote bootstrap when no token is configured', function() {
    const allowed = isAuthorizedSetupBootstrapRequest(
      createRequest('192.168.1.50'),
      { query: {} },
      { config: createConfig() }
    );

    expect(allowed).to.equal(false);
  });

  it('allows remote bootstrap with a matching header token', function() {
    const allowed = isAuthorizedSetupBootstrapRequest(
      createRequest('192.168.1.50', { 'x-setup-token': 'secret-token' }),
      { query: {} },
      { config: createConfig('secret-token') }
    );

    expect(allowed).to.equal(true);
  });

  it('allows remote bootstrap with a matching query token', function() {
    const allowed = isAuthorizedSetupBootstrapRequest(
      createRequest('192.168.1.50'),
      { query: { setupToken: 'secret-token' } },
      { config: createConfig('secret-token') }
    );

    expect(allowed).to.equal(true);
  });

  it('prefers environment setup token over config', function() {
    const token = getSetupBootstrapToken(createConfig('config-token'), {
      SETUP_BOOTSTRAP_TOKEN: 'env-token'
    });

    expect(token).to.equal('env-token');
  });

  it('uses constant-time string compare for equal-length values', function() {
    expect(timingSafeEqualString('secret', 'secret')).to.equal(true);
    expect(timingSafeEqualString('secret', 'public')).to.equal(false);
    expect(timingSafeEqualString('secret', 'short')).to.equal(false);
  });
});
