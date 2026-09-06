import { expect } from 'chai';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETUP_JS_PATH = path.join(__dirname, '..', 'public', 'setup', 'setup.js');

/**
 * Security-review finding O-004: `discoverSonos()` in public/setup/setup.js
 * interpolated server-returned `device.name`/`device.model`/`device.ip`
 * directly into `innerHTML` with no escaping anywhere in the file - those
 * values ultimately trace back to the `friendlyName`/`modelName` fields of
 * an SSDP-discovered device's XML description, fully LAN-attacker-controlled
 * data (see O-005). Any device on the LAN could inject markup that executes
 * in the setup wizard the moment an operator clicked "Discover Sonos
 * Devices." The fix adds the same escapeHtml()/escapeAttribute() helpers
 * admin.js already uses and applies them to all three fields.
 *
 * This loads and executes the REAL public/setup/setup.js file (not a
 * reimplementation) inside a minimal DOM-free vm sandbox, following the same
 * established pattern as test/setup-admin-xss.test.mjs for admin.js's O-003
 * fix - the sandbox's `document.createElement` stub mirrors real browser
 * `div.textContent = x; div.innerHTML` serialization (HTML-entity-encodes
 * `& < >` only), which is exactly what escapeHtml()/escapeAttribute() rely
 * on, so this exercises the actual production escaping logic.
 */
function loadSetupJsSandbox() {
  const source = fs.readFileSync(SETUP_JS_PATH, 'utf8');

  function makeElement() {
    let text = '';
    let html = '';
    return {
      className: '',
      dataset: {},
      set textContent(v) {
        text = v === null || v === undefined ? '' : String(v);
        html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
      get textContent() {
        return text;
      },
      set innerHTML(v) {
        html = v;
      },
      get innerHTML() {
        return html;
      },
    };
  }

  const sandbox = {
    window: {
      location: { search: '', pathname: '/setup', hash: '' },
      history: { replaceState: () => {} },
    },
    sessionStorage: {
      _store: {},
      getItem(key) { return this._store[key] || null; },
      setItem(key, value) { this._store[key] = value; },
    },
    document: {
      createElement: () => makeElement(),
      addEventListener: () => {},
    },
    URLSearchParams,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'setup.js' });
  return sandbox;
}

describe('public/setup/setup.js - escapeHtml/escapeAttribute (O-004)', function() {
  let sandbox;

  before(function() {
    sandbox = loadSetupJsSandbox();
  });

  it('HTML-encodes an SSDP-supplied device name containing a script-breaking payload', function() {
    const payload = '<img src=x onerror=alert(document.domain)>';
    expect(sandbox.escapeHtml(payload)).to.not.include('<img');
    expect(sandbox.escapeHtml(payload)).to.include('&lt;img');
  });

  it('escapeAttribute additionally encodes quotes for use inside a quoted attribute', function() {
    const payload = '"><svg onload=alert(1)>';
    const escaped = sandbox.escapeAttribute(payload);
    expect(escaped).to.not.include('"');
    expect(escaped).to.include('&quot;');
  });

  it('renders an ordinary device name/model/ip with no escaping artifacts', function() {
    expect(sandbox.escapeHtml('Living Room')).to.equal('Living Room');
    expect(sandbox.escapeAttribute('192.168.1.50')).to.equal('192.168.1.50');
  });

  it('is null/undefined-safe (a device missing a field must not throw)', function() {
    expect(sandbox.escapeHtml(null)).to.equal('');
    expect(sandbox.escapeHtml(undefined)).to.equal('');
  });
});
