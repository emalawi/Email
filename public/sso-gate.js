/* The Email platform has no accounts of its own. If you are not signed in here, this page sends you through Smartbase,
   which brings you straight back signed in. It works in every browser because it does not depend on pop-up windows. */
(function () {
  var KEY = 'sb_sso_tries';
  function apply(smartUrl, why) {
    var auth = document.getElementById('auth');
    if (!auth || document.getElementById('ssoGate')) return;
    ['signupForm', 'loginForm'].forEach(function (id) { var f = document.getElementById(id); if (f) f.style.setProperty('display', 'none', 'important'); });
    Array.prototype.forEach.call(auth.querySelectorAll('.auth-tab'), function (t) { t.style.setProperty('display', 'none', 'important'); });
    var box = document.createElement('div'); box.id = 'ssoGate'; box.style.cssText = 'display:grid;gap:14px;text-align:center;padding:8px 0';
    var h = document.createElement('h2'); h.textContent = 'Sign in with Smartbase'; h.style.margin = '0';
    var p = document.createElement('p'); p.style.cssText = 'margin:0;color:#6b7280;line-height:1.5';
    p.textContent = why === 'cookies'
      ? 'Smartbase signed you in, but your browser did not keep the sign-in. Allow cookies for this site (turn off "block all cookies" / tracking prevention for it) and try again.'
      : 'This platform uses your Smartbase account. Press the button and you will be signed in automatically.';
    var a = document.createElement('a'); a.textContent = 'Continue with Smartbase'; a.href = smartUrl + '/?open=email'; a.style.cssText = 'display:block;padding:13px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600';
    a.addEventListener('click', function () { try { sessionStorage.removeItem(KEY); } catch (e) {} });
    box.appendChild(h); box.appendChild(p); box.appendChild(a);
    var form = document.getElementById('loginForm') || document.getElementById('signupForm');
    if (form && form.parentNode) form.parentNode.insertBefore(box, form); else auth.appendChild(box);
  }
  var tries = 0; try { tries = +(sessionStorage.getItem(KEY) || 0); } catch (e) {}
  fetch('/api/sso-info').then(function (r) { return r.json(); }).then(function (info) {
    if (!info || !/^https:\/\//.test(info.smartUrl)) return;
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
      var fromSso = /[?&]sso=1(&|$)/.test(location.search);
      if (r.ok) { try { sessionStorage.removeItem(KEY); } catch (e) {} if (fromSso) history.replaceState(null, '', location.pathname); return; }
      if (!fromSso && tries < 2) { try { sessionStorage.setItem(KEY, String(tries + 1)); } catch (e) {} location.replace(info.smartUrl + '/?open=email'); return; }
      apply(info.smartUrl, fromSso ? 'cookies' : 'manual');
    }).catch(function () { apply(info.smartUrl, 'manual'); });
  }).catch(function () {});
})();
