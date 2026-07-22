/**
 * Independence test for the landing experiment bucketing (round-5 §1).
 *
 * The tutorial (live|noTut) and post-aha (current|calm) splits MUST be
 * independent — the aha only happens in the 'live' tutorial arm, so if the two
 * are correlated, nobody who reaches the aha can ever land in 'calm' and the
 * post-aha experiment is dead on arrival. This asserts all four combinations
 * appear and that within the 'live' arm the current/calm split is ~50/50, and
 * proves the OLD djb2 %2 approach would FAIL this test.
 */
const assert = require('node:assert/strict');
const { bucket2 } = require('../assets/experiments.js');

const N = 10000;
const combos = Object.create(null);
let live = 0;
let liveCurrent = 0;
for (let i = 0; i < N; i++) {
  const iid = 'a1b2c3d4-' + i + '-9f8e7d6c'; // UUID-ish, varied
  const tut = bucket2('tutorial', iid, ['live', 'noTut']);
  const paha = bucket2('post_aha_pressure', iid, ['current', 'calm']);
  combos[tut + '+' + paha] = (combos[tut + '+' + paha] || 0) + 1;
  if (tut === 'live') { live++; if (paha === 'current') liveCurrent++; }
}

for (const c of ['live+current', 'live+calm', 'noTut+current', 'noTut+calm']) {
  assert.ok(combos[c] > 0, `combination '${c}' never occurred — buckets are correlated`);
}
const currentFrac = liveCurrent / live;
assert.ok(currentFrac > 0.4 && currentFrac < 0.6, `within 'live', current fraction ${currentFrac.toFixed(3)} not in 40–60%`);

// Regression guard: the OLD djb2 %2 approach (a prefix cannot change a low-bit
// parity) MUST collapse to <4 combos — proving this test has teeth.
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return h; }
const oldCombos = new Set();
for (let i = 0; i < N; i++) {
  const iid = 'a1b2c3d4-' + i + '-9f8e7d6c';
  const tut = djb2(iid) % 2 === 0 ? 'live' : 'noTut';
  const paha = djb2('paha:' + iid) % 2 === 0 ? 'current' : 'calm';
  oldCombos.add(tut + '+' + paha);
}
assert.ok(oldCombos.size < 4, `old djb2 %2 unexpectedly produced ${oldCombos.size} combos`);

console.log('PASS — 4 independent combos:', combos);
console.log("  within 'live': current/calm =", currentFrac.toFixed(3), '/', (1 - currentFrac).toFixed(3));
console.log('  old djb2 %2 collapsed to', oldCombos.size, 'combos:', [...oldCombos].join(', '));
