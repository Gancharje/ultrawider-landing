/**
 * THE POLICY MAY NOT SAY WHAT THE PRODUCT DOES NOT DO (1.0.7 Stage 2D).
 *
 * `privacy.html` on this repository is the page GitHub Pages serves at
 * ultrawider.net/privacy — the CNAME and the README both say so, and the
 * backend serves only `/admin-ui/*`. So this file is the deployed text, and a
 * claim in it is a promise a reviewer can hold us to.
 *
 * Every assertion below is a claim the 1.0.7 extension would falsify. They are
 * written as REFUSALS rather than as a required wording: the page may be
 * rewritten freely, and it may not quietly acquire any of these sentences
 * again.
 *
 * The measured behaviour they mirror lives in the extension repository at
 * `src/shared/diagnostics/data-flow.ts`, which its own tests check against the
 * production senders.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf-8');
/** Whitespace-insensitive: the file is hand-wrapped, and a claim that spans a
 *  line break is still a claim. */
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const says = (s) => text.toLowerCase().includes(s.toLowerCase());

// ── the install identifier ────────────────────────────────────────────────
assert.ok(
  !says('anonymous install id') && !says('anonymous installation id'),
  'the install identifier is stable and links an installation\'s own records: pseudonymous, not anonymous',
);
assert.ok(
  says('pseudonymous'),
  'and the page must say which of the two it is',
);

// ── the two switches are two ──────────────────────────────────────────────
assert.ok(
  says('off until you turn it on') && says('on until you turn them off'),
  'usage telemetry is opt-in and first-session diagnostics are opt-out — the page must distinguish them',
);
assert.ok(
  !/first-session diagnostics[^.]{0,120}(opt-in|strictly opt-in)/i.test(text),
  'the 1.0.7 diagnostics channel is opt-OUT; describing it as opt-in is the one claim that is a release blocker',
);

// ── the opt-out does not silence everything ───────────────────────────────
assert.ok(
  says('uninstall address itself') && says('sent even if you have turned diagnostics off'),
  'the bare iid/had/days uninstall ping keeps being sent, and the page must say so',
);
assert.ok(
  !says('we send nothing at all when you turn') && !says('turning it off stops all'),
  'the opt-out stops the diagnostics channel and the snapshot, not every request',
);

// ── error reports ─────────────────────────────────────────────────────────
assert.ok(
  says('redactor'),
  'error message and stack are free text, and the page must say they are redacted before they leave',
);
assert.ok(
  !/crash and error reports[^.]{0,200}install id \(/i.test(text),
  'the last-resort reporter sends no installation ID; claiming it does overstates what is collected',
);

// ── what is never collected ───────────────────────────────────────────────
for (const claim of ['page urls', 'page titles', 'page content', 'video frames']) {
  assert.ok(says(claim), 'the page must keep naming what is never collected: ' + claim);
}

// ── retention ─────────────────────────────────────────────────────────────
assert.ok(
  says('30 days'),
  'the raw-IP retention window is enforced by a job in the backend and must stay disclosed',
);

console.log('privacy-claims: ok — the page says nothing the 1.0.7 extension would falsify');
