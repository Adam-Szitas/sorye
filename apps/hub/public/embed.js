/**
 * Lightweight iframe host for Sorye micro-apps.
 *
 * Usage:
 *   <script src="https://YOUR_HUB/embed.js"></script>
 *   <div id="sorye-notes" style="height:640px"></div>
 *   <script>
 *     SoryeEmbed.mount('#sorye-notes', {
 *       app: 'notes',
 *       key: 'sk_embed_...',
 *       hubUrl: 'https://YOUR_HUB' // optional when script is served from hub
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  function resolveHubUrl(explicit) {
    if (explicit) return explicit.replace(/\/$/, '');
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (/\/embed\.js(\?|$)/.test(src)) {
        try {
          return new URL(src).origin;
        } catch (e) {
          /* ignore */
        }
      }
    }
    return global.location.origin;
  }

  function pickEl(target) {
    if (typeof target === 'string') return document.querySelector(target);
    return target;
  }

  async function mount(target, options) {
    var el = pickEl(target);
    if (!el) throw new Error('SoryeEmbed: mount target not found');
    if (!options || !options.app || !options.key) {
      throw new Error('SoryeEmbed: options.app and options.key are required');
    }

    var hubUrl = resolveHubUrl(options.hubUrl);
    var origin = global.location.origin;

    el.innerHTML = '';
    var status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:100%;' +
      'min-height:12rem;color:#94a3b8;font:14px/1.4 system-ui,sans-serif';
    status.textContent = 'Loading Sorye…';
    el.appendChild(status);

    var res;
    try {
      res = await fetch(hubUrl + '/api/embed/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: options.key,
          origin: origin,
          app: options.app,
        }),
      });
    } catch (err) {
      status.textContent = 'Could not reach Sorye Hub.';
      throw err;
    }

    var data = await res.json().catch(function () {
      return {};
    });

    if (!res.ok) {
      status.textContent = data.error || 'Embed authorization failed.';
      throw new Error(status.textContent);
    }

    var iframe = document.createElement('iframe');
    iframe.src = data.embedUrl;
    iframe.title = data.appName || options.app;
    iframe.allow = 'clipboard-write; fullscreen';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.style.cssText =
      'width:100%;height:100%;min-height:inherit;border:0;display:block;background:#0b0f17';
    if (options.className) iframe.className = options.className;

    el.innerHTML = '';
    el.appendChild(iframe);

    return {
      iframe: iframe,
      destroy: function () {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },
    };
  }

  global.SoryeEmbed = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
