import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { readRequestBody, isSameOriginRequest } = require('../lib/http-utils.js');

function createRequest(chunks, headers = {}) {
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    }
  };
}

describe('HTTP utilities', function() {
  it('reads request bodies under the configured limit', async function() {
    const body = await readRequestBody(createRequest(['hello', ' world']), { limit: 20 });

    expect(body).to.equal('hello world');
  });

  it('rejects request bodies over the configured limit', async function() {
    try {
      await readRequestBody(createRequest(['hello', ' world']), { limit: 5 });
      throw new Error('Expected body limit error');
    } catch (err) {
      expect(err.statusCode).to.equal(413);
    }
  });

  it('allows requests without Origin and same-origin browser requests', function() {
    expect(isSameOriginRequest({ headers: { host: 'localhost:8181' } })).to.equal(true);
    expect(isSameOriginRequest({
      headers: {
        host: 'localhost:8181',
        origin: 'http://localhost:8181'
      }
    })).to.equal(true);
  });

  it('rejects cross-origin browser requests', function() {
    expect(isSameOriginRequest({
      headers: {
        host: 'localhost:8181',
        origin: 'http://evil.example'
      }
    })).to.equal(false);
  });
});
