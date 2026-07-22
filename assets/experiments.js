/**
 * Deterministic, INDEPENDENT experiment bucketing (round-5 §1).
 *
 * The old code used djb2 `% 2` with a string prefix per experiment. For djb2
 * (and FNV) the low bit is just the XOR of the input char parities, so a fixed
 * prefix only flips it by a constant — every experiment ends up perfectly
 * correlated (or anti-correlated). Result: the tutorial and post-aha splits
 * moved together, so nobody who reached the aha (live arm only) ever saw the
 * 'calm' post-aha arm.
 *
 * Fix: FNV-1a followed by a full fmix32 avalanche so EVERY output bit depends on
 * every input bit, then namespace each experiment with its own key. Different
 * keys now assign the same install id independently.
 *
 * UMD: usable as `window.UWExperiments` in the browser and `require()` in Node
 * (so the independence is unit-tested without a browser).
 */
(function (root) {
  'use strict';

  function fnv1a32(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // fmix32 (MurmurHash3 finalizer): avalanche so the low bits are usable.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** Independent 2-way assignment. `key` namespaces the experiment. */
  function bucket2(key, iid, arms) {
    return arms[fnv1a32(key + '|' + (iid || '')) % 2];
  }

  var api = { fnv1a32: fnv1a32, bucket2: bucket2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UWExperiments = api;
})(typeof window !== 'undefined' ? window : this);
