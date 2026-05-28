/**
 * Landing playground — live Smoothie WebGL warp demo.
 *
 * Visitor sees their browser running the exact same quintic-smootherstep
 * NLS shader the extension uses, on a real <video> element. Slider
 * controls curveStrength; draggable divider reveals raw 16:9 (left)
 * vs warped 21:9 (right) at runtime. Scroll-driven warp intensification
 * adds motion as the hero enters/leaves the viewport.
 *
 * Port of `src/content/nodes/node-2-warping/webgl-renderer.ts` — same
 * shader strings, stripped of extension-only concerns (GPU timer query,
 * ContextLifecycle, logger, dispose-after-disposal sentinels).
 *
 * Fallbacks (graceful degradation):
 *   - WebGL2 (or WebGL1) unavailable → hide canvas, show plain <video>
 *   - prefers-reduced-motion: reduce → disable scroll-driven warp
 *   - viewport <= 720px → skip the playground entirely, plain <video>
 *
 * Math source: independently derived smootherstep curve (Perlin, 2002).
 * See PROVENANCE.md in the main extension repo.
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // Shader sources — verbatim from extension's webgl-renderer.ts
  // ─────────────────────────────────────────────────────────────────────

  var VS_SOURCE = [
    'attribute vec2 a_position;',
    'varying vec2 v_texCoord;',
    'void main() {',
    '  v_texCoord = (a_position + 1.0) * 0.5;',
    '  v_texCoord.y = 1.0 - v_texCoord.y;', // Y-flip for HTMLVideoElement origin
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}',
  ].join('\n');

  var FS_SOURCE = [
    'precision highp float;',
    'uniform sampler2D u_texture;',
    'uniform float     u_curveStrength;',
    'varying vec2 v_texCoord;',
    'float smoothNLS(float x, float strength) {',
    '  float s = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);',
    '  return mix(x, s, strength);',
    '}',
    'void main() {',
    '  float x_src = smoothNLS(v_texCoord.x, u_curveStrength);',
    '  gl_FragColor = texture2D(u_texture, vec2(x_src, v_texCoord.y));',
    '}',
  ].join('\n');

  // ─────────────────────────────────────────────────────────────────────
  // Minimal WebGL renderer — single program, single quad, single texture
  // ─────────────────────────────────────────────────────────────────────

  function createRenderer(canvas) {
    var glOptions = {
      preserveDrawingBuffer: false,
      antialias: false,
      premultipliedAlpha: false,
    };
    var gl =
      canvas.getContext('webgl2', glOptions) ||
      canvas.getContext('webgl', glOptions);
    if (!gl) return null;

    function compileShader(type, source) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('Smoothie shader compile failed:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    var vs = compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    var fs = compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) return null;

    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Smoothie program link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    var positionLoc = gl.getAttribLocation(program, 'a_position');
    var frameTexLoc = gl.getUniformLocation(program, 'u_texture');
    var curveStrengthLoc = gl.getUniformLocation(program, 'u_curveStrength');

    // Quad covering NDC [-1..1] in both axes (TRIANGLE_STRIP).
    var quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    var frameTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, frameTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Paint the backbuffer black on init — without this, on browsers
    // where the WebGL canvas defaults to transparent-but-rendered-white
    // (some Chromium builds), the right half of the divider briefly
    // flashes white before the first warp() call binds a video frame.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    function warp(source, dstWidth, dstHeight, curveStrength) {
      if (canvas.width !== dstWidth || canvas.height !== dstHeight) {
        canvas.width = dstWidth;
        canvas.height = dstHeight;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch (e) {
        // Video not ready yet (readyState < 2) — skip frame silently.
        return;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, dstWidth, dstHeight);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(frameTexLoc, 0);
      if (curveStrengthLoc) {
        gl.uniform1f(curveStrengthLoc, curveStrength);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function destroy() {
      gl.deleteTexture(frameTex);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }

    return { warp: warp, destroy: destroy };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Playground wiring — connects renderer to DOM controls + lifecycle
  // ─────────────────────────────────────────────────────────────────────

  function initPlayground() {
    var root = document.querySelector('[data-playground]');
    if (!root) return;

    var video = root.querySelector('video');
    var canvas = root.querySelector('canvas');
    var slider = root.querySelector('input[type="range"]');
    var divider = root.querySelector('[data-divider]');
    var fallback = root.querySelector('[data-fallback]');

    if (!video || !canvas || !slider) {
      console.warn('Playground: missing required elements');
      return;
    }

    // Mobile fallback — playground UX is finicky on small screens.
    var isMobile = window.matchMedia('(max-width: 720px)').matches;
    if (isMobile) {
      root.classList.add('playground-fallback');
      return;
    }

    // Reduced-motion preference disables scroll-driven warp.
    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var renderer = createRenderer(canvas);
    if (!renderer) {
      // WebGL not available — show plain video, hide canvas.
      root.classList.add('playground-fallback');
      if (fallback) fallback.hidden = false;
      return;
    }

    // Aspect-tier-aware default curve strength (matches what extension picks).
    var profile = window.UltrawiderAspect
      ? window.UltrawiderAspect.detectAspectProfile()
      : { concavityDefault: 0.34, concavityMin: 0.28, concavityMax: 0.4 };

    var currentStrength = profile.concavityDefault;
    var scrollBoost = 0; // 0..1, added on top of user-controlled slider value
    var userIsInteracting = false;

    slider.min = String(profile.concavityMin);
    slider.max = String(profile.concavityMax);
    slider.step = '0.01';
    slider.value = String(profile.concavityDefault);

    // ─── Slider: user-controlled strength
    slider.addEventListener('input', function () {
      var v = parseFloat(slider.value);
      if (isFinite(v)) {
        currentStrength = v;
        userIsInteracting = true;
        // Reset auto-boost when user takes manual control
        scrollBoost = 0;
      }
    });

    // ─── Divider drag → CSS clip-path on canvas
    // Default: divider at 50% (half raw, half warped). Dragging right
    // reveals more raw video underneath; dragging left reveals more warp.
    var dividerPercent = 50;

    function setDividerPercent(pct) {
      dividerPercent = Math.max(0, Math.min(100, pct));
      canvas.style.clipPath = 'inset(0 0 0 ' + dividerPercent + '%)';
      divider.style.left = dividerPercent + '%';
      divider.setAttribute('aria-valuenow', String(Math.round(dividerPercent)));
    }
    setDividerPercent(50);

    function pointerToPercent(clientX) {
      var rect = root.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    var dragging = false;
    function startDrag(e) {
      dragging = true;
      divider.classList.add('is-dragging');
      e.preventDefault();
    }
    function moveDrag(e) {
      if (!dragging) return;
      var x = e.touches ? e.touches[0].clientX : e.clientX;
      setDividerPercent(pointerToPercent(x));
    }
    function endDrag() {
      dragging = false;
      divider.classList.remove('is-dragging');
    }

    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    // Keyboard a11y on divider
    divider.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') {
        setDividerPercent(dividerPercent - 5);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        setDividerPercent(dividerPercent + 5);
        e.preventDefault();
      } else if (e.key === 'Home') {
        setDividerPercent(0);
        e.preventDefault();
      } else if (e.key === 'End') {
        setDividerPercent(100);
        e.preventDefault();
      }
    });

    // ─── Scroll-driven warp intensification (auto-boost while hero in view)
    if (!prefersReducedMotion) {
      function updateScrollBoost() {
        if (userIsInteracting) return;
        var rect = root.getBoundingClientRect();
        var viewportH = window.innerHeight || document.documentElement.clientHeight;
        var visibleTop = Math.max(0, -rect.top);
        var heroHeight = rect.height;
        if (heroHeight <= 0) {
          scrollBoost = 0;
          return;
        }
        // Boost grows from 0 to 0.08 over the first 60% of hero scroll.
        // Subtle — not enough to override user intent, but enough to draw
        // attention as the page comes alive.
        var progress = Math.min(1, visibleTop / (heroHeight * 0.6));
        scrollBoost = progress * 0.08;
      }
      document.addEventListener('scroll', updateScrollBoost, { passive: true });
      updateScrollBoost();
    }

    // ─── Render loop — sized to container, uses rVFC when available
    var stopped = false;
    var lastTextureUpload = 0;

    function renderFrame() {
      if (stopped) return;
      // Match the canvas internal resolution to the displayed size,
      // capped so super-wide containers don't blow GPU budget.
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var dstW = Math.max(1, Math.round(rect.width * dpr));
      var dstH = Math.max(1, Math.round(rect.height * dpr));

      // Only render when there's a new frame ready — saves battery on
      // paused video (visitor scrolled away, browser auto-paused).
      var canRender = video.readyState >= 2 && !video.paused;
      if (canRender) {
        var effectiveStrength = Math.min(
          profile.concavityMax,
          currentStrength + scrollBoost,
        );
        renderer.warp(video, dstW, dstH, effectiveStrength);
      }

      // rVFC preferred (fires when next frame is decoded), rAF fallback.
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(renderFrame);
      } else {
        requestAnimationFrame(renderFrame);
      }
    }

    // Kick off when video has decoded its first frame.
    if (video.readyState >= 2) {
      renderFrame();
    } else {
      video.addEventListener('loadeddata', renderFrame, { once: true });
    }

    // Pause WebGL work when hero is out of view (battery on mobile).
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              if (video.paused) video.play().catch(function () {});
            } else {
              video.pause();
            }
          });
        },
        { threshold: 0.05 },
      );
      io.observe(root);
    }

    // ─── Cleanup on unload
    window.addEventListener('beforeunload', function () {
      stopped = true;
      try {
        renderer.destroy();
      } catch (e) {
        // ignore
      }
    });

    // Mark ready so CSS can fade the playground in.
    root.classList.add('playground-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayground);
  } else {
    initPlayground();
  }
})();
