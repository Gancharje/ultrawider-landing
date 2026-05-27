/**
 * Math section — interactive shader demo.
 *
 * Wires one slider [data-math-slider] to three things in real time:
 *   1. The SVG curve graph [data-math-curve] — path regenerated from
 *      the current curveStrength via the same blend formula as the
 *      extension's fragment shader.
 *   2. The face WebGL canvas [data-math-canvas] — uses the SAME GLSL
 *      shader as the production renderer; the 16:9 source image is
 *      rendered into a 21:9 canvas via the quintic remap. At s=0 the
 *      face is uniformly horizontally stretched (fat); at s≈0.34 the
 *      centre matches the 1.31× monitor-stretch and faces look
 *      natural; at s=1 the centre over-compresses (thin face).
 *   3. The live equation [data-math-strength] — shows the current
 *      strength value mid-formula.
 *
 * Self-contained, no deps. Soft-fails to a static image if WebGL is
 * unavailable.
 */
(function () {
  'use strict';

  // Identical to the extension's fragment shader (see
  // src/content/nodes/node-2-warping/webgl-renderer.ts). Comments
  // trimmed for landing-bundle weight.
  var FS_SOURCE =
    'precision highp float;' +
    'uniform sampler2D u_texture;' +
    'uniform float u_curveStrength;' +
    'varying vec2 v_texCoord;' +
    'float smoothNLS(float x, float s) {' +
    '  float n = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);' +
    '  return mix(x, n, s);' +
    '}' +
    'void main() {' +
    '  float x_src = smoothNLS(v_texCoord.x, u_curveStrength);' +
    '  gl_FragColor = texture2D(u_texture, vec2(x_src, v_texCoord.y));' +
    '}';

  var VS_SOURCE =
    'attribute vec2 a_position;' +
    'varying vec2 v_texCoord;' +
    'void main() {' +
    '  v_texCoord = (a_position + 1.0) * 0.5;' +
    '  v_texCoord.y = 1.0 - v_texCoord.y;' +
    '  gl_Position = vec4(a_position, 0.0, 1.0);' +
    '}';

  function compileShader(gl, src, type) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('math-demo shader compile:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function smootherstep(x) {
    return x * x * x * (x * (x * 6 - 15) + 10);
  }
  function mix(a, b, t) { return (1 - t) * a + t * b; }

  // SVG curve generator — 40 segment polyline, viewBox 0..400 with
  // y inverted (0 top, 400 bottom).
  function curvePathFor(strength) {
    var steps = 40;
    var W = 400, H = 400;
    var d = '';
    for (var i = 0; i <= steps; i++) {
      var x = i / steps;
      var y = mix(x, smootherstep(x), strength);
      var sx = (x * W).toFixed(2);
      var sy = (H - y * H).toFixed(2);
      d += (i === 0 ? 'M ' : ' L ') + sx + ' ' + sy;
    }
    return d;
  }

  function init() {
    var canvas    = document.querySelector('[data-math-canvas]');
    var sourceImg = document.querySelector('[data-math-source]');
    var slider    = document.querySelector('[data-math-slider]');
    var curveEl   = document.querySelector('[data-math-curve]');
    var displayEl = document.querySelector('[data-math-strength]');

    if (!canvas || !sourceImg || !slider || !curveEl || !displayEl) return;

    var gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false })
          || canvas.getContext('experimental-webgl');

    // Helper updates that don't need GL (graph + label).
    function updateCurveAndLabel() {
      var s = parseFloat(slider.value);
      curveEl.setAttribute('d', curvePathFor(s));
      displayEl.textContent = s.toFixed(2);
    }

    // WebGL unavailable — fall back to the static image and still drive
    // the graph + label.
    if (!gl) {
      canvas.style.display = 'none';
      sourceImg.style.display = 'block';
      sourceImg.style.opacity = '1';
      slider.addEventListener('input', updateCurveAndLabel);
      updateCurveAndLabel();
      return;
    }

    // Compile + link.
    var vs = compileShader(gl, VS_SOURCE, gl.VERTEX_SHADER);
    var fs = compileShader(gl, FS_SOURCE, gl.FRAGMENT_SHADER);
    if (!vs || !fs) {
      canvas.style.display = 'none';
      sourceImg.style.display = 'block';
      slider.addEventListener('input', updateCurveAndLabel);
      updateCurveAndLabel();
      return;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('math-demo program link:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Fullscreen quad (two triangles via TRIANGLE_STRIP).
    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Texture.
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    var strengthLoc = gl.getUniformLocation(program, 'u_curveStrength');
    var texLoc      = gl.getUniformLocation(program, 'u_texture');
    gl.uniform1i(texLoc, 0);

    var textureReady = false;
    function uploadTexture() {
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceImg);
        textureReady = true;
      } catch (e) {
        // CORS / not-loaded — bail.
        console.error('math-demo texture upload:', e);
        textureReady = false;
      }
    }

    function resizeViewport() {
      var rect = canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(2, Math.floor(rect.width * dpr));
      var h = Math.max(2, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function render() {
      if (!textureReady) return;
      resizeViewport();
      var s = parseFloat(slider.value);
      gl.uniform1f(strengthLoc, s);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function update() {
      updateCurveAndLabel();
      render();
    }

    // Image may already be cached.
    if (sourceImg.complete && sourceImg.naturalWidth > 0) {
      uploadTexture();
      update();
    } else {
      sourceImg.addEventListener('load', function () {
        uploadTexture();
        update();
      });
      sourceImg.addEventListener('error', function () {
        canvas.style.display = 'none';
        sourceImg.style.display = 'block';
        sourceImg.style.opacity = '1';
      });
    }

    slider.addEventListener('input', update);

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { render(); }, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
