/* Smartbase Data SDK - tells Smartbase how to write your users into YOUR custom database table.
   Run it from your SERVER or a build script (it uses your secret API key - never put that key in a web page).

   Node / server:
     const { SmartbaseData } = require('./smartbase-data.js');   // or import
     await SmartbaseData.defineStructure({
       apiKey: process.env.SMARTBASE_SECRET_KEY,          // sb_live_...
       baseUrl: 'https://YOUR-EMAIL-PLATFORM-URL',
       table: 'members',
       fields: { id: 'member_id', email: 'mail', name: 'full_name', last_login_at: 'seen' },
       extra: { plan: 'free' },                            // optional fixed values for new rows
       keyField: 'email'                                   // which field identifies an existing user
     });
*/
(function (root) {
  'use strict';
  var script = typeof document !== 'undefined' ? document.currentScript : null;
  var defaultBase = script && script.src ? new URL(script.src).origin : '';

  function call(method, o, body) {
    o = o || {};
    if (!o.apiKey || !/^sb_live_[0-9a-f]{48}$/.test(o.apiKey)) return Promise.reject(new Error('apiKey (your secret sb_live_ key) is required.'));
    if (typeof document !== 'undefined' && !o.allowInBrowser) return Promise.reject(new Error('Run this on your server, not in a web page: it uses your secret key.'));
    var base = String(o.baseUrl || defaultBase).replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('baseUrl is required.'));
    return fetch(base + '/api/v1/storage/structure', {
      method: method,
      headers: { 'X-Smartbase-Key': o.apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.message || data.error || 'Request failed (' + res.status + ')'); e.details = data; throw e; }
        return data;
      });
    });
  }

  var SmartbaseData = {
    /** Register (or update) how user data is written to your table. Resolves when the platform has checked your table. */
    defineStructure: function (o) {
      o = o || {};
      return call('POST', o, { table: o.table, fields: o.fields, extra: o.extra || {}, keyField: o.keyField });
    },
    /** Read the structure the platform currently uses. */
    getStructure: function (o) { return call('GET', o); }
  };

  root.SmartbaseData = SmartbaseData;
  if (typeof module !== 'undefined' && module.exports) module.exports = { SmartbaseData: SmartbaseData };
})(typeof window !== 'undefined' ? window : globalThis);
