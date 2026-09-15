// Minimal test harness (Node 16+ has no `node --test`). Usage: node tests/js/rank.test.mjs
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

setTimeout(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   - ${name}`); }
    catch (e) { failed++; console.log(`FAIL - ${name}\n${e.stack || e}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}, 0);
