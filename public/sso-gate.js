/* The Email platform has no accounts of its own: replace the sign-up / log-in forms with a link to Smartbase. */
(function () {
  function apply(smartUrl) {
    var auth = document.getElementById('auth');
    if (!auth || document.getElementById('ssoGate')) return;
    ['signupForm', 'loginForm'].forEach(function (id) { var f = document.getElementById(id); if (f) f.style.setProperty('display', 'none', 'important'); });
    Array.prototype.forEach.call(auth.querySelectorAll('.auth-tab'), function (t) { t.style.setProperty('display', 'none', 'important'); });
    var box = document.createElement('div'); box.id = 'ssoGate'; box.style.cssText = 'display:grid;gap:14px;text-align:center;padding:8px 0';
    var h = document.createElement('h2'); h.textContent = 'Sign in with Smartbase'; h.style.margin = '0';
    var p = document.createElement('p'); p.textContent = 'This platform uses your Smartbase account. Open Smartbase and choose "Auth & Email" in the menu — you will be signed in automatically.'; p.style.cssText = 'margin:0;color:#6b7280;line-height:1.5';
    var a = document.createElement('a'); a.textContent = 'Open Smartbase'; a.href = smartUrl; a.style.cssText = 'display:block;padding:13px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600';
    box.appendChild(h); box.appendChild(p); box.appendChild(a);
    var form = document.getElementById('loginForm') || document.getElementById('signupForm');
    if (form && form.parentNode) form.parentNode.insertBefore(box, form); else auth.appendChild(box);
  }
  fetch('/api/sso-info').then(function (r) { return r.json(); }).then(function (i) { if (i && /^https:\/\//.test(i.smartUrl)) apply(i.smartUrl); }).catch(function () {});
})();
