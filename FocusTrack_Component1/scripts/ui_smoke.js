/* Headless smoke test for the demo UI scripts.
 *
 * Loads the real application scripts into a Node VM with a minimal DOM stub,
 * points fetch at the running demo server, then invokes every view function
 * (including views registered by later scripts) for both data sources. Any
 * runtime exception fails the run.
 *
 *   UI_BASE=http://127.0.0.1:8000 node scripts/ui_smoke.js \
 *       ui/static/app.js ui/static/session.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const scriptPaths = process.argv.slice(2);
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

const code = `${scriptPaths.map((path) => fs.readFileSync(path, 'utf8')).join('\n;')}
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
vm.runInContext(code, ctx, {
  filename: scriptPaths.map((path) => path.split('/').pop()).join(' + ') || 'ui.js',
});

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
