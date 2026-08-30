import { expect } from 'chai';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS_PATH = path.join(__dirname, '..', 'public', 'setup', 'admin.js');

/**
 * Security-review finding O-003: `createConfigItem()` in public/setup/admin.js
 * rendered config values into a double-quoted HTML `value="..."` attribute
 * using `escapeHtml()`, which encodes `<`, `>`, `&` but NOT `"` or `'`. A
 * config value containing a literal `"` could therefore break out of the
 * attribute and inject a new one (e.g. an event handler), executing in the
 * authenticated web admin's browser session the next time they opened
 * /admin. The fix swaps in the already-existing, quote-aware
 * escapeAttribute() for that one call site.
 *
 * This test loads and executes the REAL public/setup/admin.js file (not a
 * reimplementation) inside a minimal DOM-free vm sandbox - the closest thing
 * to an end-to-end test available without adding a browser/DOM testing
 * dependency to the project. The sandbox's `document.createElement` stub
 * mirrors real browser behavior for `div.textContent = x; div.innerHTML`
 * (HTML-entity-encodes `& < >` only), which is exactly the behavior
 * escapeHtml()/escapeAttribute() depend on - so this exercises the actual
 * production escaping logic, not a mock of it.
 */
function loadAdminJsSandbox() {
  const source = fs.readFileSync(ADMIN_JS_PATH, 'utf8');

  function makeElement() {
    let text = '';
    let html = '';
    return {
      className: '',
      dataset: {},
      set textContent(v) {
        text = v === null || v === undefined ? '' : String(v);
        // Mirrors real DOM serialization of a text node back through innerHTML.
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
    window: {},
    document: {
      createElement: () => makeElement(),
      addEventListener: () => {},
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'admin.js' });
  return sandbox;
}

describe('public/setup/admin.js - createConfigItem XSS hardening (O-003)', function() {
  let sandbox;

  before(function() {
    sandbox = loadAdminJsSandbox();
  });

  it('does not let a double-quote in a config value break out of the value="..." attribute', function() {
    const payload = '"><img src=x onerror=alert(1)>';
    const div = sandbox.createConfigItem({ key: 'defaultTheme', type: 'string', label: 'Default Theme' }, payload);

    // The exploit succeeds if a literal, unescaped `"` reaches the output -
    // it would close the value="..." attribute early and let the rest of
    // the payload become new, attacker-controlled tag attributes/markup.
    const valueAttrMatch = div.innerHTML.match(/value="([^]*?)"\s/);
    expect(valueAttrMatch, 'expected a value="..." attribute in the rendered HTML').to.not.equal(null);
    expect(valueAttrMatch[1]).to.not.include('"');
    expect(valueAttrMatch[1]).to.not.include('<img');
    // The whole rendered fragment must never contain a live, unescaped <img> tag.
    expect(div.innerHTML).to.not.match(/<img[^&]*onerror=/);
  });

  it('HTML-encodes the quote so the payload is inert text inside the attribute', function() {
    const payload = '" onmouseover="alert(document.domain)';
    const div = sandbox.createConfigItem({ key: 'openaiTtsModel', type: 'string', label: 'TTS Model' }, payload);

    expect(div.innerHTML).to.include('&quot;');
    expect(div.innerHTML).to.not.match(/value="[^"]*"\s+onmouseover=/);
  });

  it('still renders an ordinary config value with no escaping artifacts', function() {
    const div = sandbox.createConfigItem({ key: 'defaultTheme', type: 'string', label: 'Default Theme' }, 'lounge');

    expect(div.innerHTML).to.include('value="lounge"');
  });

  it('still HTML-encodes <, >, and & in config values (pre-existing, unchanged behavior)', function() {
    const div = sandbox.createConfigItem({ key: 'defaultTheme', type: 'string', label: 'Default Theme' }, '<b>&</b>');

    expect(div.innerHTML).to.include('value="&lt;b&gt;&amp;&lt;/b&gt;"');
  });
});
