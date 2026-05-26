/**
 * Aspect-ratio detection + per-tier curve parameters for the landing
 * playground. Plain-JS port of `src/shared/aspect-ratio.ts` from the
 * extension — kept in sync semantically so the demo behaves like the
 * extension on the visitor's actual display.
 *
 * Pure functions, no side effects beyond reading `window.screen`.
 * Exposed via `window.UltrawiderAspect`.
 */
(function () {
  'use strict';

  function aspectProfileFor(ratio) {
    if (ratio >= 3.0) {
      return {
        tier: 'super-ultrawide-32-9',
        concavityDefault: 0.2,
        concavityMin: 0.16,
        concavityMax: 0.28,
      };
    }
    if (ratio >= 2.6) {
      return {
        tier: 'ultrawide-24-9',
        concavityDefault: 0.26,
        concavityMin: 0.22,
        concavityMax: 0.34,
      };
    }
    if (ratio >= 2.1) {
      return {
        tier: 'ultrawide-21-9',
        concavityDefault: 0.32,
        concavityMin: 0.28,
        concavityMax: 0.4,
      };
    }
    // < 2.1 — visitor on 16:9 laptop or similar. Demo still mathematically
    // valid; falls back to 21:9 defaults so the warp is visible.
    return {
      tier: 'standard',
      concavityDefault: 0.32,
      concavityMin: 0.28,
      concavityMax: 0.4,
    };
  }

  function detectScreenAspect() {
    if (typeof window === 'undefined' || !window.screen) return 21 / 9;
    var w = window.screen.width;
    var h = window.screen.height;
    if (!w || !h) return 21 / 9;
    return w / h;
  }

  function detectAspectProfile() {
    return aspectProfileFor(detectScreenAspect());
  }

  window.UltrawiderAspect = {
    aspectProfileFor: aspectProfileFor,
    detectScreenAspect: detectScreenAspect,
    detectAspectProfile: detectAspectProfile,
  };
})();
