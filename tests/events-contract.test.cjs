/**
 * Contract test (round-5 §4): every event welcome.js emits MUST be accepted by
 * the backend, otherwise the beacon is silently dropped (204) and the signal is
 * lost — which is exactly how competitor_probe and tutorial_variant went blind.
 *
 * BACKEND_WHITELIST mirrors VALID_EVENTS in
 *   backend/src/routes/welcome.ts
 * Keep the two in sync — this test fails the moment welcome.js emits an event
 * the backend does not list.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mirror of backend VALID_EVENTS (src/routes/welcome.ts). Superset of what the
// welcome page emits (some entries are extension/popup events).
const BACKEND_WHITELIST = new Set([
  'welcome_view', 'ext_handshake', 'flow_assigned', 'profile_override', 'brief_view',
  'intro_view', 'intro_try_clicked', 'tutorial_fs_click', 'tutorial_fs_entered',
  'hud_detected', 'aha_reached', 'tutorial_failed', 'ff_grant_shown', 'ff_grant_completed',
  'yt_handoff_click', 'pro_panel_view', 'pricing_click', 'install_reason', 'sim_demo_engaged',
  'welcome_dwell', 'post_aha_pressure_assigned', 'competitor_probe', 'tutorial_variant',
  'link_copied', 'email_link_requested', 'uninstall_info_view', 'feedback_click',
  'rescue_open', 'support_click', 'internal_marked',
  'review_prompt_shown', 'review_prompt_clicked', 'review_prompt_dismissed',
]);

const welcomeJs = fs.readFileSync(path.join(__dirname, '..', 'assets', 'welcome.js'), 'utf8');
const emitted = new Set();
for (const m of welcomeJs.matchAll(/sendEvent\(\s*'([a-z_]+)'/g)) emitted.add(m[1]);

assert.ok(emitted.size > 0, 'no sendEvent() literals found — regex/paths broke');

const missing = [...emitted].filter((e) => !BACKEND_WHITELIST.has(e)).sort();
assert.deepEqual(
  missing,
  [],
  'welcome.js emits events the backend whitelist does not accept (silently dropped): ' + missing.join(', '),
);

console.log('PASS — all', emitted.size, 'welcome.js events are backend-whitelisted');
