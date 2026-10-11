/* Smartbase controls: sign-in options, users & storage, account control, broadcasts. Loaded after app.js. */
(function () {
  if (typeof viewLabels === "undefined" || typeof navigate !== "function") return;
  const anchorNav = document.querySelector('.nav-item[data-view="signin"]') || document.querySelector('.nav-item[data-view="designer"]');
  const anchorSection = document.querySelector('.view[data-section="signin"]') || document.querySelector('.view[data-section="designer"]');
  if (!anchorNav || !anchorSection) return;

  const J = {"Content-Type": "application/json"};
  const field = "width:100%;margin-top:7px;padding:12px 13px;border:1px solid #dfe2e7;border-radius:9px;background:#fafbfc;color:#20242a;font:inherit";
  const pre = "background:#0f172a;color:#e2e8f0;padding:12px;border-radius:9px;overflow:auto;font-size:12.5px;white-space:pre-wrap;word-break:break-all";
  const card = (title, label, inner) => `<article class="surface create-project-card" style="max-width:820px;margin-top:14px"><div class="surface-head"><div><span class="mini-label">${label}</span><h2>${title}</h2></div></div><div style="display:grid;gap:12px">${inner}</div></article>`;
  const note = (t) => `<p class="form-helper" style="margin:0">${t}</p>`;
  const btn = (id, t, cls) => `<button type="button" class="${cls || "toolbar-button"}" id="${id}">${t}</button>`;
  const radio = (name, v, label, checked) => `<label class="check-label"><input type="radio" name="${name}" value="${v}" ${checked ? "checked" : ""}> ${label}</label>`;
  const val = (id) => (document.getElementById(id) || {}).value || "";
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = () => fn().catch((e) => toast(e.message || "Something went wrong.")); };
  const body = (o) => ({method: "POST", headers: J, body: JSON.stringify({projectId: currentProject.id, ...o})});
  const put = (o) => ({method: "PUT", headers: J, body: JSON.stringify({projectId: currentProject.id, ...o})});
  const radioVal = (name) => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
  const needProject = () => { if (!currentProject) { toast("Create or select a project first."); return false; } return true; };

  function addView(id, label, icon, heading, intro) {
    viewLabels[id] = label;
    const nav = document.createElement("button");
    nav.type = "button"; nav.className = "nav-item"; nav.dataset.view = id;
    nav.innerHTML = `<span class="nav-icon">${icon}</span>${label}`;
    nav.addEventListener("click", () => navigate(id));
    anchorNav.insertAdjacentElement("afterend", nav);
    const section = document.createElement("section");
    section.className = "view"; section.dataset.section = id;
    section.innerHTML = `<div class="page-heading"><div><span class="eyebrow">Smartbase</span><h1>${heading}</h1><p>${intro}</p></div></div><div id="${id}Body"></div>`;
    anchorSection.insertAdjacentElement("afterend", section);
    return document.getElementById(id + "Body");
  }
  // keep sidebar order: Sign-in options, Users & storage, Broadcasts
  const bBroadcast = addView("broadcasts", "Broadcasts", "✉", "Broadcasts", "Send an email to all your users at once and see how many opened it.");
  const bStorage = addView("storage", "Users & storage", "▦", "Users & storage", "Choose where your users are stored, control accounts per device and keep a copy of your data.");
  const bOptions = addView("options", "Sign-in options", "◎", "Sign-in options", "Choose which Google app and which domain your users see when they sign in.");

  let C = null;
  const load = async () => { C = await api("/api/controls?projectId=" + encodeURIComponent(currentProject.id)); return C; };
  const fail0 = (el, msg) => { el.innerHTML = `<article class="surface create-project-card" style="max-width:820px"><p>${escapeHtml(msg)}</p></article>`; };

  /* ================= Sign-in options ================= */
  async function renderOptions() {
    if (!needProject()) return fail0(bOptions, "Create or select a project first.");
    await load();
    const d = C.domain, snip = d.snippets, host = escapeHtml(d.host || "");
    const verified = d.mode === "custom" && d.verifiedAt;
    bOptions.innerHTML =
      card("Google app", "1 · App", `
        <p style="margin:0"><b>${C.google.custom ? "Your own Google app" : "Smartbase default Google app"}</b>${C.google.custom ? " — Client ID " + escapeHtml(C.google.clientId) : ""}</p>
        ${note(C.google.custom ? "Google shows the name and logo you set on your own consent screen." : "Your users see Google's page saying \"Continue to Smartbase\". To show your own name instead, add your own Google app.")}
        ${btn("opGoogle", C.google.custom ? "Manage Google app" : "Use my own Google app")}`) +
      card("Sign-in domain", "2 · Domain", `
        ${radio("domMode", "default", "Default — Google redirects through " + escapeHtml(new URL(C.defaultCallback).host), d.mode !== "custom")}
        ${radio("domMode", "custom", "Custom domain — Google redirects through your own domain (like Firebase)", d.mode === "custom")}
        <div id="domCustom" style="display:${d.mode === "custom" ? "grid" : "none"};gap:10px">
          <label>Your domain<input id="domHost" style="${field}" placeholder="dance.com" value="${host}"></label>
          ${C.google.custom ? "" : note("A custom domain needs your own Google app (Google only allows redirect addresses you register yourself). Add it above first.")}
        </div>
        ${btn("domSave", "Save", "toolbar-button primary")}
        ${d.mode === "custom" && snip ? `
          <div style="display:grid;gap:10px;border-top:1px solid #e5e7eb;padding-top:12px">
            <b>Set up ${host} ${verified ? '<span style="color:#15803d">· verified ✓</span>' : '<span style="color:#b45309">· not verified yet</span>'}</b>
            ${note("<b>Step 1.</b> In Google Cloud Console → your OAuth client → <i>Authorized redirect URIs</i>, add:")}
            <pre style="${pre}">${escapeHtml(snip.googleRedirect)}</pre>
            ${note("<b>Step 2.</b> Make your domain forward <code>/__smartbase/*</code> to Smartbase. Pick your hosting:")}
            <select id="domSnipSel" style="${field}"><option value="cloudflareWorker">Cloudflare Worker</option><option value="nginx">Nginx</option><option value="vercel">Vercel (vercel.json)</option><option value="netlify">Netlify (_redirects)</option></select>
            <pre id="domSnip" style="${pre}">${escapeHtml(snip.cloudflareWorker)}</pre>
            ${note("<b>Step 3.</b> Check the forwarding works:")}
            ${btn("domVerify", "Verify domain")}
            ${note("<b>Step 4.</b> Point your website's SDK at your domain:")}
            <pre style="${pre}">${escapeHtml(snip.sdk)}</pre>
            ${note("What Google prints above the account list (\"Continue to …\") is decided by Google from your app's consent-screen name and your redirect domain. Set the app name and authorized domain in Google Cloud to match.")}
          </div>` : ""}`);
    on("opGoogle", async () => navigate("google"));
    document.querySelectorAll('input[name="domMode"]').forEach((r) => r.addEventListener("change", () => { document.getElementById("domCustom").style.display = radioVal("domMode") === "custom" ? "grid" : "none"; }));
    on("domSave", async () => { C = await api("/api/controls/domain", put({mode: radioVal("domMode"), host: val("domHost")})); toast("Saved."); renderOptions(); });
    on("domVerify", async () => { const r = await api("/api/controls/domain/verify", body({})).catch((e) => ({success: false, message: e.message})); toast(r.verified ? "Domain verified." : r.message || "Could not verify."); renderOptions(); });
    const sel = document.getElementById("domSnipSel");
    if (sel) sel.onchange = () => { document.getElementById("domSnip").textContent = snip[sel.value]; };
  }

  /* ================= Users & storage ================= */
  let dbs = [], stats = null, events = [];
  async function renderStorage() {
    if (!needProject()) return fail0(bStorage, "Create or select a project first.");
    await load();
    const s = C.storage, sb = s.smartbase, mode = s.mode, ac = C.accountControl;
    if (sb.hasRead && sb.hasWrite) dbs = (await api("/api/controls/smart/databases?projectId=" + currentProject.id).catch(() => ({databases: []}))).databases;
    if (ac.enabled) stats = (await api("/api/controls/account-stats?projectId=" + currentProject.id).catch(() => ({}))).stats || null; else stats = null;
    if (mode === "external") events = (await api("/api/controls/events?projectId=" + currentProject.id).catch(() => ({events: []}))).events; else events = [];

    const smartPanel = `
      <div style="display:grid;gap:12px;border-top:1px solid #e5e7eb;padding-top:12px">
        <b>Smartbase database</b>
        ${note("Your users are saved in a database on Smartbase (" + escapeHtml(s.smartbaseUrl) + "). Create a <b>read</b> key and a <b>write</b> key in your Smartbase API Center and paste them here.")}
        ${sb.hasRead && sb.hasWrite ? `<p style="margin:0;color:#15803d">Connected ✓ <button type="button" class="toolbar-button" id="smDisc" style="margin-left:8px">Disconnect</button></p>` : `
          <label>Write key<input id="smW" type="password" autocomplete="off" style="${field}"></label>
          <label>Read key<input id="smR" type="password" autocomplete="off" style="${field}"></label>
          ${btn("smConnect", "Connect")}`}
        ${sb.hasRead && sb.hasWrite ? `
          <label>Database<select id="smDb" style="${field}">${dbs.map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === sb.databaseId ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}</select></label>
          ${radio("smKind", "template", "Use an empty database with the ready-made user structure (recommended)", sb.kind !== "custom")}
          ${radio("smKind", "custom", "Custom database — I define my own table with SQL", sb.kind === "custom")}
          <div id="smCustom" style="display:${sb.kind === "custom" ? "grid" : "none"};gap:10px">
            <label>Your table name<input id="smTable" style="${field}" value="${escapeHtml(sb.kind === "custom" ? sb.table : "")}" placeholder="members"></label>
            <label>Create your table with SQL (optional)<textarea id="smSql" rows="4" style="${field};font-family:monospace" placeholder="CREATE TABLE members (member_id TEXT PRIMARY KEY, mail TEXT, full_name TEXT);"></textarea></label>
            ${btn("smRunSql", "Run SQL")}
          </div>
          ${btn("smUse", "Use this database", "toolbar-button primary")}
          <p style="margin:0">${sb.ready ? `<span style="color:#15803d">Ready ✓ — table <b>${escapeHtml(sb.table)}</b> in <b>${escapeHtml(sb.databaseName)}</b></span>` : sb.databaseId && sb.kind === "custom" ? '<span style="color:#b45309">Waiting for your SDK to define the structure (see below).</span>' : ""}</p>
          ${sb.kind === "custom" ? `
            <div style="border-top:1px solid #e5e7eb;padding-top:12px;display:grid;gap:8px">
              <b>Required: install the Smartbase Data SDK</b>
              ${note("For a custom table, Smartbase must know which column holds what. Add this SDK to your server or build script (it uses your secret project API key) and run it once:")}
              <pre style="${pre}">// download ${escapeHtml(C.sdkUrl)} into your project\nconst { SmartbaseData } = require('./smartbase-data.js');\nawait SmartbaseData.defineStructure({\n  apiKey: process.env.SMARTBASE_SECRET_KEY,\n  baseUrl: '${escapeHtml(location.origin)}',\n  table: '${escapeHtml(sb.table || "members")}',\n  fields: { id: 'member_id', email: 'mail', name: 'full_name' },\n  extra: { plan: 'free' },\n  keyField: 'email'\n});</pre>
              ${note("Allowed fields: " + C.standardFields.join(", ") + ". Smartbase checks every column exists before it starts writing.")}
            </div>` : ""}` : ""}
      </div>`;
    const extPanel = `
      <div style="display:grid;gap:12px;border-top:1px solid #e5e7eb;padding-top:12px">
        <b>External gateway</b>
        ${note("Smartbase keeps no personal user data. Each sign-in is sent, signed, to a web address on your own server. Verify the <code>X-Smartbase-Signature</code> header (HMAC-SHA256 of <code>timestamp + '.' + body</code>) with your signing secret.")}
        <label>Your gateway URL<input id="exUrl" style="${field}" placeholder="https://api.yoursite.com/smartbase/users" value="${escapeHtml(s.external.url)}"></label>
        ${btn("exSave", s.external.configured ? "Save URL and create a new signing secret" : "Save and create signing secret")}
        <div id="exSecret"></div>
        ${s.external.configured ? btn("exTest", "Send test event") : ""}
        ${events.length ? `<b>Deliveries waiting to be retried</b><div style="font-size:13px">${events.map((e) => `${escapeHtml(e.kind)} · ${escapeHtml(e.created_at.slice(0, 16))} · ${escapeHtml(e.last_error)}`).join("<br>")}</div>${btn("exRetry", "Retry now")}` : ""}
      </div>`;
    bStorage.innerHTML =
      card("Where are your users stored?", "1 · Storage", `
        ${radio("stMode", "default", "<b>Smartbase default</b> — stored in your project, nothing to set up", mode === "default")}
        ${radio("stMode", "smartbase", "<b>My Smartbase database</b> — stored in a database you own on Smartbase", mode === "smartbase")}
        ${radio("stMode", "external", "<b>My own server</b> — nothing is kept; each sign-in is sent to your gateway", mode === "external")}
        <div id="stPanels">${smartPanel}${extPanel}</div>
        ${btn("stSave", "Use this storage", "toolbar-button primary")}
        ${note("Currently active: <b>" + escapeHtml({default: "Smartbase default", smartbase: "My Smartbase database", external: "My own server"}[mode]) + "</b>")}`) +
      card("Account control", "2 · Accounts", `
        <label class="check-label"><input type="checkbox" id="acOn" ${ac.enabled ? "checked" : ""}> Turn on account control (“one account, one device”)</label>
        ${radio("acMode", "monitor", "<b>Monitor</b> — only track. Nobody is blocked. Gives you user counts without duplicates.", ac.mode !== "enforce")}
        ${radio("acMode", "enforce", "<b>Enforce</b> — a device can only be used with one account. Other accounts on that device are refused.", ac.mode === "enforce")}
        ${btn("acSave", "Save", "toolbar-button primary")}
        ${note("Devices are recognised by an id stored in the browser (update your site to the latest smartbase.js). A person who clears their browser data or switches browser looks like a new device, so this reduces duplicates but is not unbreakable.")}
        ${stats ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">${[["Accounts", stats.accounts], ["Devices", stats.devices], ["Shared devices", stats.sharedDevices], ["Likely real users", stats.estimatedUniqueUsers], ["Duplicate accounts", stats.duplicateAccounts], ["Blocked attempts", stats.blockedAttempts]].map((x) => `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:22px;font-weight:700">${x[1]}</div><div style="font-size:12px;color:#6b7280">${x[0]}</div></div>`).join("")}</div>` : ""}`) +
      card("Database copy", "3 · Backup", `
        ${note("Download a copy of your users' database as one HTML file you can open offline in any browser: browse tables, search, sort and export CSV. It is a read-only snapshot (up to 5,000 rows per table).")}
        ${btn("dbCopy", "Download database copy")}`);
    const toggle = () => { const m = radioVal("stMode"); document.getElementById("stPanels").children[0].style.display = m === "smartbase" ? "grid" : "none"; document.getElementById("stPanels").children[1].style.display = m === "external" ? "grid" : "none"; };
    document.querySelectorAll('input[name="stMode"]').forEach((r) => r.addEventListener("change", toggle)); toggle();
    document.querySelectorAll('input[name="smKind"]').forEach((r) => r.addEventListener("change", () => { document.getElementById("smCustom").style.display = radioVal("smKind") === "custom" ? "grid" : "none"; }));
    const again = () => renderStorage();
    on("smConnect", async () => { await api("/api/controls/smart/connect", body({writeKey: val("smW"), readKey: val("smR")})); toast("Connected."); again(); });
    on("smDisc", async () => { await api("/api/controls/smart/disconnect", body({})); again(); });
    on("smUse", async () => { C = await api("/api/controls/smart/use-database", body({databaseId: val("smDb"), kind: radioVal("smKind"), table: val("smTable")})); toast("Saved."); again(); });
    on("smRunSql", async () => { const r = await api("/api/controls/smart/custom-sql", body({sql: val("smSql")})); toast(r.message || "Done."); });
    on("stSave", async () => { await api("/api/controls/storage", put({mode: radioVal("stMode")})); toast("Storage updated."); again(); });
    on("exSave", async () => { const r = await api("/api/controls/external", body({url: val("exUrl")})); document.getElementById("exSecret").innerHTML = `<p style="margin:0"><b>Signing secret (shown once — copy it now):</b></p><pre style="${pre}">${escapeHtml(r.signingSecret)}</pre>`; toast("Gateway saved."); });
    on("exTest", async () => { const r = await api("/api/controls/external/test", body({})); toast(r.message); });
    on("exRetry", async () => { const r = await api("/api/controls/events/retry", body({})); toast(`Sent ${r.sent}, failed ${r.failed}.`); again(); });
    on("acSave", async () => { await api("/api/controls/account", put({enabled: document.getElementById("acOn").checked, mode: radioVal("acMode")})); toast("Saved."); again(); });
    on("dbCopy", async () => { const r = await fetch("/api/db-copy?projectId=" + encodeURIComponent(currentProject.id), {credentials: "same-origin"}); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Could not create the copy."); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = currentProject.name.replace(/[^\w.-]+/g, "_") + "-database-copy.html"; a.click(); });
  }

  /* ================= Broadcasts ================= */
  async function renderBroadcasts() {
    if (!needProject()) return fail0(bBroadcast, "Create or select a project first.");
    const data = await api("/api/broadcasts?projectId=" + encodeURIComponent(currentProject.id));
    const me = (document.getElementById("accountEmail") || {}).textContent || "";
    bBroadcast.innerHTML =
      card("New broadcast", "Compose", `
        ${data.audience === null ? note("Broadcasts are not available when users are stored on your own server — Smartbase has no list to send to.") : note("Audience: <b>" + data.audience + "</b> users with an email address (people who unsubscribed are left out).")}
        <label>Subject<input id="bcSubject" style="${field}" maxlength="200" placeholder="What's new at {{projectName}}"></label>
        <label>Heading<input id="bcHeading" style="${field}" maxlength="120" placeholder="Big news"></label>
        <label>Message<textarea id="bcMessage" rows="6" style="${field}" maxlength="5000"></textarea></label>
        <label>Button text<input id="bcBtnText" style="${field}" maxlength="40" value="Open"></label>
        <label>Button link (optional — your website is used if empty)<input id="bcBtnUrl" style="${field}" placeholder="https://"></label>
        <label>Send a test to<input id="bcTo" type="email" style="${field}" value="${escapeHtml(me.includes("@") ? me : "")}"></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${btn("bcTest", "Send test")}${data.audience === null ? "" : btn("bcSend", "Send to all users", "toolbar-button primary")}</div>
        <div id="bcProgress"></div>
        ${note("Emails are sent from the Smartbase Gmail account in batches, with a daily limit. Every email has an unsubscribe link. “Opened” counts people whose email app loads images; some apps load them automatically, so treat it as an estimate.")}`) +
      card("Sent broadcasts", "Tracking", data.broadcasts.length ? `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#6b7280"><th>Subject</th><th>Sent</th><th>Opened</th><th>Failed</th><th>Status</th></tr></thead><tbody>${data.broadcasts.map((b) => `<tr style="border-top:1px solid #eef0f3"><td style="padding:8px 6px">${escapeHtml(b.subject)}<div style="font-size:12px;color:#9ca3af">${escapeHtml((b.created_at || "").slice(0, 16).replace("T", " "))}</div></td><td>${b.sent} / ${b.total}</td><td>${b.opened} (${b.openRate}%)</td><td>${b.failed}</td><td>${escapeHtml(b.status)}</td></tr>`).join("")}</tbody></table></div>` : note("Nothing sent yet."));
    const content = () => ({subject: val("bcSubject"), heading: val("bcHeading"), message: val("bcMessage"), buttonText: val("bcBtnText"), buttonUrl: val("bcBtnUrl")});
    on("bcTest", async () => { const r = await api("/api/broadcasts/test", body({...content(), to: val("bcTo")})); toast(r.message); });
    on("bcSend", async () => {
      if (!confirm("Send this email to " + data.audience + " users now?")) return;
      const out = document.getElementById("bcProgress");
      const created = await api("/api/broadcasts", body(content()));
      let p = null;
      for (let i = 0; i < 200; i++) {
        const r = await api("/api/broadcasts/send", body({broadcastId: created.id})).catch((e) => ({error: e.message}));
        if (r.error) { out.innerHTML = `<p style="color:#b91c1c;margin:0">${escapeHtml(r.error)}</p>`; break; }
        p = r.progress;
        out.innerHTML = `<div style="height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(((p.sent + p.failed) / p.total) * 100)}%;background:#2563eb"></div></div><p style="margin:6px 0 0">Sent ${p.sent} of ${p.total}${p.failed ? " · " + p.failed + " failed" : ""}</p>`;
        if (!p.pending) break;
      }
      if (p && !p.pending) toast("Broadcast finished."); renderBroadcasts();
    });
  }

  const baseNavigate = navigate;
  navigate = function (view) {
    baseNavigate(view);
    const fail1 = (e) => toast(e.message || "Something went wrong.");
    if (view === "options") renderOptions().catch(fail1);
    if (view === "storage") renderStorage().catch(fail1);
    if (view === "broadcasts") renderBroadcasts().catch(fail1);
  };
})();
