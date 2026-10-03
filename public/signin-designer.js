/* Smartbase sign-in page designer. Loaded after app.js. */
(function () {
  if (typeof viewLabels === "undefined" || typeof navigate !== "function") return;

  const anchorNav =
    document.querySelector('.nav-item[data-view="google"]') ||
    document.querySelector('.nav-item[data-view="designer"]');
  const anchorSection =
    document.querySelector('.view[data-section="google"]') ||
    document.querySelector('.view[data-section="designer"]');
  if (!anchorNav || !anchorSection) return;

  const jsonHeaders = {"Content-Type": "application/json"};
  const field = "width:100%;margin-top:7px;padding:12px 13px;border:1px solid #dfe2e7;border-radius:9px;background:#fafbfc;color:#20242a;font:inherit";
  const MOVING = ["aurora", "bubbles", "stars", "squares", "shift"];

  const colorF = (id, label) =>
    `<label>${label}<input id="${id}" type="color" style="height:42px;padding:3px"></label>`;
  const rangeF = (id, label, min, max) =>
    `<label id="${id}Row">${label}<input id="${id}" type="range" min="${min}" max="${max}" style="padding:0"></label>`;
  const textF = (id, label, max) =>
    `<label>${label}<input id="${id}" type="text" maxlength="${max}"></label>`;
  const selectF = (id, label, options) =>
    `<label>${label}<select id="${id}" style="${field}">${options
      .map((o) => `<option value="${o[0]}">${o[1]}</option>`)
      .join("")}</select></label>`;
  const checkF = (id, label) =>
    `<label class="check-label"><input id="${id}" type="checkbox"> ${label}</label>`;
  const trio = (inner) => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${inner}</div>`;
  const duo = (inner) => `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">${inner}</div>`;

  viewLabels.signin = "Sign-in page";

  const nav = document.createElement("button");
  nav.type = "button";
  nav.className = "nav-item";
  nav.dataset.view = "signin";
  nav.innerHTML = '<span class="nav-icon">▣</span>Sign-in page';
  anchorNav.insertAdjacentElement("afterend", nav);
  nav.addEventListener("click", () => navigate("signin"));

  const section = document.createElement("section");
  section.className = "view";
  section.dataset.section = "signin";
  section.innerHTML = `
    <div class="page-heading"><div>
      <span class="eyebrow">Authentication</span>
      <h1>Sign-in page</h1>
      <p>Design the page your users see before they choose their Google account.</p>
    </div></div>

    <article class="surface create-project-card" style="max-width:760px">
      <div class="surface-head"><div><span class="mini-label">Project</span><h2 id="spProjectName">No project selected</h2></div></div>
      <div style="display:grid;gap:12px">
        ${checkF("spEnabled", "Show this page before Google's account picker")}
        <p class="form-helper" style="margin:0">Google's own account picker cannot be restyled, so this page appears first. Users tap the button and continue to Google. When this is off, users go straight to Google.</p>
      </div>
    </article>

    <article class="surface create-project-card" style="max-width:760px;margin-top:14px">
      <div class="surface-head"><div><span class="mini-label">Background</span><h2>Choose a template</h2></div></div>
      <div id="spTemplates"></div>
    </article>

    <article class="surface" style="max-width:760px;margin-top:14px">
      <div class="surface-head"><div><span class="mini-label">Live preview</span><h2>What your users see</h2></div></div>
      <iframe id="spPreview" sandbox title="Sign-in page preview" style="width:100%;height:520px;border:1px solid #dfe2e7;border-radius:12px;background:#fff"></iframe>
    </article>

    <article class="surface create-project-card" style="max-width:760px;margin-top:14px">
      <div class="surface-head"><div><span class="mini-label">Customize</span><h2>Background</h2></div></div>
      <div id="spControls" style="display:grid;gap:14px">
        ${trio(colorF("spColor1", "Base") + colorF("spColor2", "Accent 1") + colorF("spColor3", "Accent 2"))}
        ${rangeF("spSpeed", "Motion speed", 1, 10)}
        ${rangeF("spDensity", "How many shapes", 4, 40)}
        ${rangeF("spAngle", "Angle", 0, 360)}

        <h2 style="margin:10px 0 0;font-size:15px">Card</h2>
        ${duo(colorF("spCardBg", "Card color") + colorF("spAccent", "Accent (button)"))}
        ${rangeF("spCardOpacity", "Card transparency (lower is glassier)", 30, 100)}
        ${rangeF("spRadius", "Corner roundness", 0, 40)}
        ${selectF("spWidth", "Card width", [["360", "Narrow"], ["400", "Medium"], ["440", "Wide"]])}
        ${selectF("spFont", "Font", [
          ["Arial, sans-serif", "Arial"],
          ["Verdana, sans-serif", "Verdana"],
          ["Georgia, serif", "Georgia"],
          ["Tahoma, sans-serif", "Tahoma"],
          ["Trebuchet MS, sans-serif", "Trebuchet MS"]
        ])}
        ${checkF("spShowLogo", "Show my logo (set in Email design)")}

        <h2 style="margin:10px 0 0;font-size:15px">Text and button</h2>
        ${textF("spHeading", "Heading", 100)}
        ${textF("spSub", "Message", 200)}
        ${textF("spButtonText", "Button text", 40)}
        ${selectF("spButtonStyle", "Button style", [["light", "Light"], ["dark", "Dark"], ["accent", "Accent color"]])}
        ${duo(colorF("spHeadingColor", "Heading color") + colorF("spTextColor", "Text color"))}
        ${textF("spFooter", "Footer text", 120)}
        <p class="form-helper" style="margin:0">You can use {{projectName}} in any text.</p>
      </div>
    </article>

    <article class="surface create-project-card" style="max-width:760px;margin-top:14px">
      <div style="display:grid;gap:10px">
        <button class="primary" id="spSave" type="button">Save sign-in page</button>
        <button class="secondary" id="spTest" type="button">Save and test with Google</button>
        <button class="secondary" id="spReset" type="button">Reset to defaults</button>
      </div>
    </article>`;
  anchorSection.insertAdjacentElement("afterend", section);

  let design = null;
  let defaults = null;
  let templates = [];
  let timer = null;

  function readDesign() {
    return {
      enabled: $("spEnabled").checked,
      template: design.template,
      color1: $("spColor1").value,
      color2: $("spColor2").value,
      color3: $("spColor3").value,
      speed: Number($("spSpeed").value),
      density: Number($("spDensity").value),
      angle: Number($("spAngle").value),
      heading: $("spHeading").value,
      subheading: $("spSub").value,
      buttonText: $("spButtonText").value,
      buttonStyle: $("spButtonStyle").value,
      accent: $("spAccent").value,
      cardBackground: $("spCardBg").value,
      cardOpacity: Number($("spCardOpacity").value),
      headingColor: $("spHeadingColor").value,
      textColor: $("spTextColor").value,
      cardRadius: Number($("spRadius").value),
      cardWidth: Number($("spWidth").value),
      fontFamily: $("spFont").value,
      showLogo: $("spShowLogo").checked,
      footerText: $("spFooter").value
    };
  }

  function fillControls(d) {
    design = Object.assign({}, d);
    $("spEnabled").checked = !!d.enabled;
    $("spColor1").value = d.color1;
    $("spColor2").value = d.color2;
    $("spColor3").value = d.color3;
    $("spSpeed").value = d.speed;
    $("spDensity").value = d.density;
    $("spAngle").value = d.angle;
    $("spHeading").value = d.heading;
    $("spSub").value = d.subheading;
    $("spButtonText").value = d.buttonText;
    $("spButtonStyle").value = d.buttonStyle;
    $("spAccent").value = d.accent;
    $("spCardBg").value = d.cardBackground;
    $("spCardOpacity").value = d.cardOpacity;
    $("spHeadingColor").value = d.headingColor;
    $("spTextColor").value = d.textColor;
    $("spRadius").value = d.cardRadius;
    $("spWidth").value = String(d.cardWidth);
    $("spFont").value = d.fontFamily;
    $("spShowLogo").checked = !!d.showLogo;
    $("spFooter").value = d.footerText;
    renderTemplates();
    toggleRelevant();
  }

  function toggleRelevant() {
    const t = design.template;
    $("spSpeedRow").style.display = MOVING.includes(t) ? "" : "none";
    $("spDensityRow").style.display = ["bubbles", "stars", "squares"].includes(t) ? "" : "none";
    $("spAngleRow").style.display = ["gradient", "shift"].includes(t) ? "" : "none";
  }

  function renderTemplates() {
    const box = $("spTemplates");
    box.innerHTML = "";
    [["moving", "Moving backgrounds"], ["static", "Still backgrounds"]].forEach(([type, label]) => {
      const head = document.createElement("div");
      head.style.cssText = "font-size:12px;font-weight:700;margin:14px 0 8px";
      head.textContent = label;
      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px";
      templates.filter((t) => t.type === type).forEach((t) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary";
        button.textContent = t.name;
        const active = design.template === t.id;
        button.style.cssText = "padding:11px 8px;font-size:12px;" +
          (active ? "outline:2px solid #6255e8;outline-offset:1px;font-weight:700" : "");
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.addEventListener("click", () => {
          design.template = t.id;
          renderTemplates();
          toggleRelevant();
          schedulePreview();
        });
        grid.appendChild(button);
      });
      box.append(head, grid);
    });
  }

  async function renderPreview() {
    if (!currentProject || !design) return;
    try {
      const data = await api("/api/signin-preview", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({projectId: currentProject.id, design: readDesign()})
      });
      $("spPreview").srcdoc = data.html;
    } catch (err) {
      /* the preview is optional, so a failed refresh is ignored */
    }
  }

  function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(renderPreview, 350);
  }

  async function save() {
    const data = await api("/api/signin-page", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({projectId: currentProject.id, design: readDesign()})
    });
    fillControls(data.design);
    schedulePreview();
  }

  async function loadView() {
    if (!currentProject) {
      $("spProjectName").textContent = "No project selected";
      return;
    }
    $("spProjectName").textContent = currentProject.name;
    const data = await api("/api/signin-page?projectId=" + encodeURIComponent(currentProject.id));
    templates = data.templates;
    defaults = data.defaults;
    fillControls(data.design);
    renderPreview();
  }

  section.addEventListener("input", (event) => {
    if (event.target && event.target.closest("#spControls")) schedulePreview();
  });
  section.addEventListener("change", (event) => {
    if (event.target && event.target.closest("#spControls")) schedulePreview();
  });
  $("spEnabled").addEventListener("change", schedulePreview);

  $("spSave").addEventListener("click", async () => {
    if (!currentProject) { toast("Create or select a project first."); return; }
    try {
      await save();
      toast("Sign-in page saved.");
    } catch (err) {
      toast(err.message);
    }
  });

  $("spTest").addEventListener("click", async () => {
    if (!currentProject) { toast("Create or select a project first."); return; }
    if (!$("spEnabled").checked) {
      toast("Turn on the sign-in page first, otherwise the test goes straight to Google.");
      return;
    }
    try {
      await save();
      location.assign("/auth/google/test-start?project=" + encodeURIComponent(currentProject.id));
    } catch (err) {
      toast(err.message);
    }
  });

  $("spReset").addEventListener("click", () => {
    if (!defaults) return;
    if (!confirm("Reset the sign-in page to the default design?")) return;
    fillControls(Object.assign({}, defaults, {enabled: $("spEnabled").checked}));
    schedulePreview();
  });

  const baseNavigate = navigate;
  navigate = function (view) {
    baseNavigate(view);
    if (view === "signin") loadView().catch((err) => toast(err.message));
  };
})();
