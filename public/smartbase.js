(function (global) {
  'use strict';

  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src).origin : location.origin;
  var config = { projectId: '', baseUrl: base };
  var KEY = 'smartbase_oauth_state';

  function randomState() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function cleanUrl() {
    var u = new URL(location.href);
    ['smartbase_code', 'smartbase_state', 'smartbase_error'].forEach(function (k) {
      u.searchParams.delete(k);
    });
    return u.toString();
  }

  var GOOGLE_G =
    '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '</svg>';

  var Smartbase = {
    init: function (options) {
      options = options || {};
      if (!options.projectId) throw new Error('Smartbase.init needs a projectId');
      config.projectId = options.projectId;
      if (options.baseUrl) config.baseUrl = options.baseUrl;
    },

    signInWithGoogle: function (options) {
      if (!config.projectId) throw new Error('Call Smartbase.init({ projectId }) first.');
      options = options || {};
      var state = randomState();
      try { sessionStorage.setItem(KEY, state); } catch (e) {}
      var url = new URL(config.baseUrl + '/auth/google/start');
      url.searchParams.set('project', config.projectId);
      url.searchParams.set('redirect_url', options.redirectUrl || cleanUrl());
      url.searchParams.set('state', state);
      location.assign(url.toString());
    },

    getRedirectResult: function () {
      var params = new URL(location.href).searchParams;
      var code = params.get('smartbase_code');
      var error = params.get('smartbase_error');
      var returned = params.get('smartbase_state');
      if (!code && !error) return null;

      var saved = null;
      try {
        saved = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
      } catch (e) {}
      history.replaceState(null, '', cleanUrl());

      if (!saved || saved !== returned) return { error: 'state_mismatch' };
      if (error) return { error: error };
      return { code: code };
    },

    googleButton: function (container, options) {
      var el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) return null;
      options = options || {};
      var button = document.createElement('button');
      button.type = 'button';
      button.style.cssText =
        'display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border:1px solid #dadce0;' +
        'border-radius:6px;background:#fff;color:#3c4043;font:500 14px Arial,sans-serif;cursor:pointer';
      button.innerHTML = GOOGLE_G + '<span></span>';
      button.lastChild.textContent = options.text || 'Sign in with Google';
      button.addEventListener('click', function () {
        Smartbase.signInWithGoogle(options);
      });
      el.appendChild(button);
      return button;
    }
  };

  global.Smartbase = Smartbase;
})(window);
