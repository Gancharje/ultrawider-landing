/**
 * Google Ads tag (AW-953520341) — the base gtag loader for the MARKETING
 * pages of the landing.
 *
 * OWNER DECISION (2026-09-02): this loader is NOT included on the
 * goodbye/uninstall surface. The uninstall page is what a person lands on
 * the moment they remove the extension; firing Google Ads / DoubleClick
 * remarketing and conversion requests from it was measured (a render
 * attempted gtag/js and its collect/pagead requests carried the page title)
 * and the owner removed it there. Loading it here is still the prerequisite
 * for the Store-Click conversion event (fired from the install button) and
 * for remarketing on the pages that opt in by including this file.
 *
 * Kept in its own file — with a name that says what it is — so that no page
 * gets advertising by accident of sharing an error-reporting asset.
 */
(function () {
  var GADS_ID = 'AW-953520341';
  if (window.gtag) return; // already loaded via the inline snippet on this page
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GADS_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  window.gtag('js', new Date());
  window.gtag('config', GADS_ID);
})();
