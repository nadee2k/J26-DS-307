/* Headless smoke test for ui/static/app.js.
 *
 * Loads the real application script into a Node VM with a minimal DOM stub,
 * points fetch at the running demo server, then invokes every view function
 * for both data sources. Any runtime exception fails the run.
 *
 *   node /tmp/opencode/ui_smoke.js FocusTrack_Component1/ui/static/app.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const scriptPath = process.argv[2];
const base = process.env.UI_BASE || 'http://127.0.0.1:8000';

function makeEl() {
  const el = {
    innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {},
    className: '', value: '', disabled: false,
    scrollTop: 0, scrollHeight: 0, elements: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, closest() { return null; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
  };
  return el;
}

const code = `${fs.readFileSync(scriptPath, 'utf8')}
globalThis.__VIEWS = VIEWS;
globalThis.__setSource = (s) => { state.source = s; };
globalThis.__state = state;`;

const ctx = {
  console,
  document: {
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  setTimeout: () => 0,
  clearTimeout() {},
  window: { location: { hash: '' }, history: { replaceState() {} }, addEventListener() {} },
  location: { hash: '' },
  fetch: (path, opts) => fetch(/^\w+:\/\//.test(path) ? path : base + path, opts),
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'app.js' });

(async () => {
  let failures = 0;
  for (const source of ['real', 'synthetic']) {
    ctx.__setSource(source);
    for (const [name, fn] of Object.entries(ctx.__VIEWS)) {
      try {
        await fn(true);
        console.log(`${source.padEnd(9)} ${name.padEnd(12)} OK`);
      } catch (err) {
        failures += 1;
        const lines = String(err.stack || err).split('\n').slice(0, 3).join(' | ');
        console.log(`${source.padEnd(9)} ${name.padEnd(12)} FAIL ${lines}`);
      }
    }
  }
  console.log(failures ? `\n${failures} view(s) failed` : '\nall views rendered without exceptions');
  process.exit(failures ? 1 : 0);
})();
