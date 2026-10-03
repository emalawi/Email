let developer = null;
let projects = [];
let currentProject = null;
let currentTemplate = null;

const $ = (id) => document.getElementById(id);

function show(id, visible = true) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !visible);
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__smartbaseToast);
  window.__smartbaseToast = setTimeout(() => el.classList.remove("show"), 2500);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* =========================
   AUTH
========================= */
function switchAuth(mode) {
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.auth === mode);
  });
  show("signupForm", mode === "signup");
  show("loginForm", mode === "login");
}

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchAuth(tab.dataset.auth));
});

$("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/signup", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: $("signupName").value,
        email: $("signupEmail").value,
        password: $("signupPassword").value
      })
    });
    toast(data.message || "Account created. Check your email.");
    $("signupForm").reset();
    switchAuth("login");
    $("loginEmail").value = $("signupEmail").value || "";
  } catch (err) {
    toast(err.message);
  }
});

$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: $("loginEmail").value,
        password: $("loginPassword").value
      })
    });
    developer = data.developer;
    localStorage.setItem("smartbaseDeveloperId", developer.id);
    enterDashboard();
    await loadProjects();
    toast("Welcome back.");
  } catch (err) {
    toast(err.message);
  }
});

function enterDashboard() {
  $("auth").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  updateDeveloperUI();
}

async function logout() {
  developer = null;
  projects = [];
  currentProject = null;
  currentTemplate = null;
  localStorage.removeItem("smartbaseDeveloperId");
  $("dashboard").classList.add("hidden");
  $("auth").classList.remove("hidden");
  switchAuth("login");
  toast("You have been logged out.");
}

/* =========================
   NAVIGATION
========================= */
const viewLabels = {
  overview: "Overview",
  projects: "Projects",
  designer: "Email design",
  templates: "Templates",
  logs: "Activity",
  api: "API docs",
  keys: "API keys",
  settings: "Settings"
};

function navigate(view) {
  const target = viewLabels[view] ? view : "overview";
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active-view", section.dataset.section === target);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === target);
  });
  $("breadcrumb").textContent = viewLabels[target];
  $("sidebar")?.classList.remove("open");
  if (target === "api") updateApiExample();
  if (target === "keys") updateKeyUI();
}

document.querySelectorAll("[data-view]").forEach((item) => {
  item.addEventListener("click", () => navigate(item.dataset.view));
});

$("openSidebar")?.addEventListener("click", () => $("sidebar")?.classList.add("open"));
$("closeSidebar")?.addEventListener("click", () => $("sidebar")?.classList.remove("open"));

/* =========================
   PROJECTS
========================= */
$("projectForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!developer) {
    toast("Please login first.");
    return;
  }

  try {
    const data = await api("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Developer-Id": developer.id
      },
      body: JSON.stringify({
        name: $("projectName").value,
        website: $("projectWebsite").value
      })
    });

    $("projectForm").reset();

    $("projectResult").innerHTML = `
      <div class="successBox">
        <strong>Project created successfully.</strong>
        <p>Your API key:</p>
        <code id="newProjectKey">${escapeHtml(data.project.apiKey)}</code>
        <p class="warningText">Keep this API key private. Do not expose it in frontend JavaScript.</p>
      </div>
    `;

    toast("Project created.");
    await loadProjects();
    navigate("projects");
  } catch (err) {
    toast(err.message);
  }
});

async function loadProjects() {
  if (!developer) return;

  try {
    const data = await api("/api/projects", {
      headers: {"X-Developer-Id": developer.id}
    });

    projects = data.projects || [];
    populateProjectSelectors();
    renderProjectList();

    if (projects.length) {
      const preferred = currentProject ? projects.find((p) => p.id === currentProject.id) : null;
      currentProject = preferred || projects[0];

      $("projectSelect").value = currentProject.id;
      $("designerProjectSelect").value = currentProject.id;

      await loadTemplate();
      updateProjectUI();
      updateApiExample();
      updateKeyUI();
    } else {
      currentProject = null;
      currentTemplate = null;
      updateProjectUI();
      updateKeyUI();
      updatePreview();
    }
  } catch (err) {
    toast(err.message);
  }
}

function populateProjectSelectors() {
  ["projectSelect", "designerProjectSelect"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = "";

    if (!projects.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No projects";
      select.appendChild(option);
      return;
    }

    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });
  });
}

async function selectProject(id) {
  currentProject = projects.find((project) => project.id === id) || null;
  if (!currentProject) return;

  $("projectSelect").value = currentProject.id;
  $("designerProjectSelect").value = currentProject.id;

  await loadTemplate();
  updateProjectUI();
  updateApiExample();
  updateKeyUI();
  markSaved("Ready");
}

$("projectSelect")?.addEventListener("change", async () => {
  await selectProject($("projectSelect").value);
});

$("designerProjectSelect")?.addEventListener("change", async () => {
  await selectProject($("designerProjectSelect").value);
});

function renderProjectList() {
  const list = $("projectList");
  const count = $("projectCount");
  if (!list || !count) return;

  count.textContent = `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;

  if (!projects.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◇</div><strong>No projects yet</strong><p>Create your first project to see it here.</p></div>`;
    return;
  }

  list.innerHTML = projects.map((project) => `
    <div class="project-row">
      <div class="project-row-main">
        <div class="project-row-avatar">${escapeHtml((project.name || "S").charAt(0).toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <span>${escapeHtml(project.website || "No website URL")}</span>
        </div>
      </div>
      <div class="project-row-actions">
        <button type="button" data-project-design="${escapeAttribute(project.id)}">Design</button>
        <button type="button" data-project-key="${escapeAttribute(project.id)}">Key</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-project-design]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectProject(button.dataset.projectDesign);
      navigate("designer");
    });
  });

  list.querySelectorAll("[data-project-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectProject(button.dataset.projectKey);
      navigate("keys");
    });
  });
}

function updateProjectUI() {
  const name = currentProject?.name || "No project yet";
  const website = currentProject?.website || "Create a project to start designing.";

  setText("selectedProjectName", name);
  setText("selectedProjectWebsite", website);
  setText("workspaceName", currentProject?.name || "Smartbase");
  setText("keyProjectName", name);
  setText("settingsProject", name);
  setText("settingsWebsite", website);
}

/* =========================
   TEMPLATE
========================= */
async function loadTemplate() {
  if (!currentProject) return;

  try {
    const data = await api(
      `/api/template?projectId=${encodeURIComponent(currentProject.id)}`,
      {headers: {"X-Developer-Id": developer.id}}
    );

    currentTemplate = data.template || {};
    fillDesigner(currentTemplate);
    updatePreview();
    markSaved("Saved");
  } catch (err) {
    toast(err.message);
  }
}

function getTemplateFromDesigner() {
  return {
    subject: value("subject"),
    heading: value("heading"),
    message: value("message"),
    buttonText: value("buttonText"),
    buttonUrl: "{{verification_url}}",
    brandColor: value("brandColor"),
    background: value("bgColor"),
    companyName: value("companyName"),
    logoDataUrl: currentTemplate?.logoDataUrl || "",
    logoPosition: value("logoPosition"),
    logoWidth: Number(value("logoWidth")) || 100,
    headerImageDataUrl: currentTemplate?.headerImageDataUrl || "",
    headingColor: value("headingColor"),
    headingSize: Number(value("headingSize")) || 28,
    textColor: value("textColor"),
    textSize: Number(value("textSize")) || 16,
    fontFamily: value("fontFamily"),
    buttonColor: value("buttonColor"),
    buttonTextColor: value("buttonTextColor"),
    buttonWidth: value("buttonWidth"),
    buttonAlign: value("buttonAlign"),
    buttonRadius: Number(value("buttonRadius")) || 8,
    cardBackground: value("cardBackground"),
    cardWidth: value("cardWidth"),
    cardRadius: Number(value("cardRadius")) || 14,
    showDivider: $("showDivider")?.checked !== false,
    footerText: value("footerText"),
    footerColor: value("footerColor"),
    supportEmail: value("supportEmail")
  };
}

function fillDesigner(template) {
  setValue("subject", template.subject || "Verify your email for {{projectName}}");
  setValue("heading", template.heading || "Verify your email");
  setValue("message", template.message || "Hello {{name}}, please verify your email address to continue.");
  setValue("buttonText", template.buttonText || "Verify email");
  setValue("brandColor", template.brandColor || "#2563eb");
  setValue("bgColor", template.background || "#f4f7fb");
  setValue("companyName", template.companyName || currentProject?.name || "");
  setValue("logoPosition", template.logoPosition || "center");
  setValue("logoWidth", template.logoWidth || 100);
  setValue("headingColor", template.headingColor || "#111827");
  setValue("headingSize", template.headingSize || 28);
  setValue("textColor", template.textColor || "#4b5563");
  setValue("textSize", template.textSize || 16);
  setValue("fontFamily", template.fontFamily || "Arial, sans-serif");
  setValue("buttonColor", template.buttonColor || "#2563eb");
  setValue("buttonTextColor", template.buttonTextColor || "#ffffff");
  setValue("buttonWidth", template.buttonWidth || "280px");
  setValue("buttonAlign", template.buttonAlign || "center");
  setValue("buttonRadius", template.buttonRadius ?? 8);
  setValue("cardBackground", template.cardBackground || "#ffffff");
  setValue("cardWidth", template.cardWidth || "560px");
  setValue("cardRadius", template.cardRadius ?? 14);
  setValue("showDivider", template.showDivider !== false);
  setValue("footerText", template.footerText || "© {{projectName}}. All rights reserved.");
  setValue("footerColor", template.footerColor || "#6b7280");
  setValue("supportEmail", template.supportEmail || "");

  currentTemplate = {...(currentTemplate || {}), ...template};
  updateRangeLabels();

  showStoredImage("logoPreviewBox", "logoPreview", template.logoDataUrl);
  showStoredImage("headerImagePreviewBox", "headerImagePreview", template.headerImageDataUrl);
}

async function saveTemplate() {
  if (!developer || !currentProject) {
    toast("Create or select a project first.");
    return;
  }

  try {
    markSaved("Saving…");
    const template = getTemplateFromDesigner();
    const data = await api("/api/template", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Developer-Id": developer.id
      },
      body: JSON.stringify({projectId: currentProject.id, template})
    });

    currentTemplate = data.template || template;
    markSaved("Saved");
    toast("Email design saved.");
  } catch (err) {
    markSaved("Not saved");
    toast(err.message);
  }
}

/* =========================
   IMAGE UPLOADS
========================= */
$("logoFile")?.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 300 * 1024) {
    toast("Logo must be smaller than 300 KB.");
    event.target.value = "";
    return;
  }

  readImage(file, (dataUrl) => {
    currentTemplate = {...(currentTemplate || {}), logoDataUrl: dataUrl};
    showStoredImage("logoPreviewBox", "logoPreview", dataUrl);
    updatePreview();
    markSaved("Unsaved changes");
  });
});

$("headerImageFile")?.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 700 * 1024) {
    toast("Header image must be smaller than 700 KB.");
    event.target.value = "";
    return;
  }

  readImage(file, (dataUrl) => {
    currentTemplate = {...(currentTemplate || {}), headerImageDataUrl: dataUrl};
    showStoredImage("headerImagePreviewBox", "headerImagePreview", dataUrl);
    updatePreview();
    markSaved("Unsaved changes");
  });
});

$("removeLogo")?.addEventListener("click", () => {
  currentTemplate = {...(currentTemplate || {}), logoDataUrl: ""};
  $("logoFile").value = "";
  showStoredImage("logoPreviewBox", "logoPreview", "");
  updatePreview();
  markSaved("Unsaved changes");
});

$("removeHeaderImage")?.addEventListener("click", () => {
  currentTemplate = {...(currentTemplate || {}), headerImageDataUrl: ""};
  $("headerImageFile").value = "";
  showStoredImage("headerImagePreviewBox", "headerImagePreview", "");
  updatePreview();
  markSaved("Unsaved changes");
});

function readImage(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(reader.result);
  reader.readAsDataURL(file);
}

function showStoredImage(boxId, imageId, dataUrl) {
  const box = $(boxId);
  const image = $(imageId);
  if (!box || !image) return;

  if (dataUrl) {
    image.src = dataUrl;
    box.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    box.classList.add("hidden");
  }
}

/* =========================
   LIVE PREVIEW
========================= */
function updatePreview() {
  const frame = $("preview");
  if (!frame) return;

  const template = getTemplateFromDesigner();
  frame.srcdoc = buildPreviewHTML(template);
}

function buildPreviewHTML(template) {
  const logo = template.logoDataUrl ? `
    <div style="text-align:${template.logoPosition};margin-bottom:20px">
      <img src="${template.logoDataUrl}" style="width:${template.logoWidth}px;max-width:100%;height:auto">
    </div>` : "";

  const banner = template.headerImageDataUrl ? `
    <img src="${template.headerImageDataUrl}" style="width:100%;max-height:220px;object-fit:cover;border-radius:${template.cardRadius}px ${template.cardRadius}px 0 0;display:block;margin-bottom:25px">` : "";

  const divider = template.showDivider ? `
    <div style="height:1px;background:${template.brandColor};opacity:.18;margin:24px 0"></div>` : "";

  const support = template.supportEmail ? `
    <div style="margin-top:10px;font-size:13px;color:${template.textColor}">
      Need help?
      <a href="mailto:${escapeAttribute(template.supportEmail)}" style="color:${template.brandColor}">${escapeHtml(template.supportEmail)}</a>
    </div>` : "";

  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;padding:0;width:100%}
body{background:${template.background};font-family:${template.fontFamily}}
*{box-sizing:border-box}
.emailCard{width:${template.cardWidth};max-width:calc(100% - 30px);margin:30px auto;background:${template.cardBackground};border-radius:${template.cardRadius}px;padding:36px;box-shadow:0 8px 35px rgba(0,0,0,.08)}
@media(max-width:600px){.emailCard{padding:25px 20px;max-width:calc(100% - 20px)}}
</style></head><body>
<div class="emailCard">
${banner}
${logo}
<div style="text-align:center;font-size:13px;color:${template.brandColor};font-weight:700;margin-bottom:12px">${escapeHtml(template.companyName || "{{projectName}}")}</div>
<h1 style="margin:0 0 18px;color:${template.headingColor};font-size:${template.headingSize}px;text-align:center;line-height:1.2">${escapeHtml(template.heading)}</h1>
<div style="color:${template.textColor};font-size:${template.textSize}px;line-height:1.7;text-align:center">${escapeHtml(template.message).replace(/\n/g,"<br>")}</div>
${divider}
<div style="text-align:${template.buttonAlign};margin:25px 0">
<a href="{{verification_url}}" style="display:inline-block;width:${template.buttonWidth === "auto" ? "auto" : template.buttonWidth};max-width:100%;padding:14px 24px;background:${template.buttonColor};color:${template.buttonTextColor};text-decoration:none;border-radius:${template.buttonRadius}px;font-weight:700;text-align:center">${escapeHtml(template.buttonText)}</a>
</div>
${support}
<div style="margin-top:28px;color:${template.footerColor};font-size:12px;line-height:1.6;text-align:center">${escapeHtml(template.footerText).replace(/\n/g,"<br>")}</div>
</div></body></html>`;
}

/* =========================
   PRESETS
========================= */
const presets = {
  classic:{brandColor:"#2563eb",background:"#f4f7fb",cardBackground:"#ffffff",headingColor:"#111827",textColor:"#4b5563",buttonColor:"#2563eb",buttonTextColor:"#ffffff",cardRadius:14,buttonRadius:8,fontFamily:"Arial, sans-serif"},
  modern:{brandColor:"#7c3aed",background:"#f5f3ff",cardBackground:"#ffffff",headingColor:"#312e81",textColor:"#4c1d95",buttonColor:"#7c3aed",buttonTextColor:"#ffffff",cardRadius:20,buttonRadius:14,fontFamily:"Trebuchet MS, sans-serif"},
  minimal:{brandColor:"#111827",background:"#ffffff",cardBackground:"#ffffff",headingColor:"#111827",textColor:"#4b5563",buttonColor:"#111827",buttonTextColor:"#ffffff",cardRadius:4,buttonRadius:4,fontFamily:"Arial, sans-serif"},
  gradient:{brandColor:"#ec4899",background:"#fdf2f8",cardBackground:"#ffffff",headingColor:"#831843",textColor:"#500724",buttonColor:"#ec4899",buttonTextColor:"#ffffff",cardRadius:24,buttonRadius:20,fontFamily:"Verdana, sans-serif"},
  dark:{brandColor:"#60a5fa",background:"#0f172a",cardBackground:"#1e293b",headingColor:"#f8fafc",textColor:"#cbd5e1",buttonColor:"#3b82f6",buttonTextColor:"#ffffff",cardRadius:18,buttonRadius:10,fontFamily:"Arial, sans-serif"},
  corporate:{brandColor:"#0f766e",background:"#f0fdfa",cardBackground:"#ffffff",headingColor:"#134e4a",textColor:"#475569",buttonColor:"#0f766e",buttonTextColor:"#ffffff",cardRadius:10,buttonRadius:6,fontFamily:"Tahoma, sans-serif"}
};

function applyPreset(style) {
  const preset = presets[style];
  if (!preset) return;

  Object.keys(preset).forEach((key) => {
    setValue(key === "background" ? "bgColor" : key, preset[key]);
  });

  updatePreview();
  markSaved("Unsaved changes");
  toast(`${capitalize(style)} style applied.`);
}

document.querySelectorAll(".template-card").forEach((button) => {
  button.addEventListener("click", () => {
    applyPreset(button.dataset.style);
    navigate("designer");
  });
});

/* =========================
   PREVIEW MODE
========================= */
document.querySelectorAll(".previewMode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".previewMode").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    $("preview")?.classList.toggle("mobilePreview", button.dataset.preview === "mobile");
  });
});

/* =========================
   RESET
========================= */
$("resetDesign")?.addEventListener("click", () => {
  const defaultTemplate = {
    subject:"Verify your email for {{projectName}}",
    heading:"Verify your email",
    message:"Hello {{name}}, please verify your email address to continue.",
    buttonText:"Verify email",
    brandColor:"#2563eb",background:"#f4f7fb",
    companyName:currentProject?.name || "",
    logoDataUrl:"",logoPosition:"center",logoWidth:100,
    headerImageDataUrl:"",
    headingColor:"#111827",headingSize:28,
    textColor:"#4b5563",textSize:16,
    fontFamily:"Arial, sans-serif",
    buttonColor:"#2563eb",buttonTextColor:"#ffffff",buttonWidth:"280px",buttonAlign:"center",buttonRadius:8,
    cardBackground:"#ffffff",cardWidth:"560px",cardRadius:14,
    showDivider:true,footerText:"© {{projectName}}. All rights reserved.",footerColor:"#6b7280",supportEmail:""
  };

  currentTemplate = defaultTemplate;
  fillDesigner(defaultTemplate);
  $("logoFile").value = "";
  $("headerImageFile").value = "";
  updatePreview();
  markSaved("Unsaved changes");
  toast("Design reset.");
});

/* =========================
   LIVE INPUT EVENTS
========================= */
const liveFields = [
  "subject","heading","message","companyName","logoPosition","logoWidth",
  "headingColor","headingSize","textColor","textSize","fontFamily",
  "buttonText","buttonColor","buttonTextColor","buttonWidth","buttonAlign","buttonRadius",
  "brandColor","bgColor","cardBackground","cardWidth","cardRadius","showDivider",
  "footerText","footerColor","supportEmail"
];

liveFields.forEach((id) => {
  const element = $(id);
  if (!element) return;
  const onChange = () => {
    updateRangeLabels();
    updatePreview();
    markSaved("Unsaved changes");
  };
  element.addEventListener("input", onChange);
  element.addEventListener("change", onChange);
});

function updateRangeLabels() {
  setText("logoWidthValue", `${value("logoWidth") || 100}px`);
  setText("headingSizeValue", `${value("headingSize") || 28}px`);
  setText("textSizeValue", `${value("textSize") || 16}px`);
  setText("buttonRadiusValue", `${value("buttonRadius") || 8}px`);
  setText("cardRadiusValue", `${value("cardRadius") || 14}px`);
}

/* =========================
   API / KEY UI
========================= */
function updateApiExample() {
  if (!currentProject) {
    setText("apiExample", "Create a project to generate your integration example.");
    return;
  }

  $("apiExample").textContent =
`curl -X POST http://127.0.0.1:3000/api/v1/send-verification \\
  -H "Content-Type: application/json" \\
  -H "X-Smartbase-Key: YOUR_PROJECT_API_KEY" \\
  -d '{"email":"customer@example.com","name":"Customer"}'`;
}

function updateKeyUI() {
  const key = currentProject?.apiKey || "";
  setText("projectApiKey", key || "Create a project to generate a key.");
}

$("copyApiKey")?.addEventListener("click", async () => {
  if (!currentProject?.apiKey) {
    toast("No project API key is available.");
    return;
  }
  await copyText(currentProject.apiKey);
  toast("API key copied.");
});

document.querySelectorAll("[data-copy-api]").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = $("apiExample")?.textContent || "";
    if (!text) return;
    await copyText(text);
    toast("API example copied.");
  });
});

document.querySelectorAll(".variable-chip").forEach((button) => {
  button.addEventListener("click", async () => {
    await copyText(button.dataset.copy || "");
    toast(`${button.dataset.copy} copied.`);
  });
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/* =========================
   ACCOUNT / HELPERS
========================= */
function updateDeveloperUI() {
  const name = developer?.name || "Developer";
  const email = developer?.email || "Signed in";
  const initial = name.trim().charAt(0).toUpperCase() || "D";

  setText("accountName", name);
  setText("accountEmail", email);
  setText("accountAvatar", initial);
  setText("topAvatar", initial);
  setText("settingsName", name);
  setText("settingsEmail", email);
  setText("welcomeHeading", `Good morning, ${name.split(/\s+/)[0] || "Developer"}.`);
  setText("developerInfo", `Logged in as ${name} (${email})`);
}

function markSaved(text) {
  const state = $("saveState");
  if (!state) return;
  state.innerHTML = `<i></i> ${escapeHtml(text)}`;
  const dot = state.querySelector("i");
  if (dot) dot.style.background = text === "Saved" || text === "Ready" ? "#22a06b" : "#d79b37";
}

function value(id) {
  const element = $(id);
  if (!element) return "";
  return element.type === "checkbox" ? element.checked : element.value || "";
}

function setValue(id, valueToSet) {
  const element = $(id);
  if (!element || valueToSet === undefined) return;
  if (element.type === "checkbox") element.checked = Boolean(valueToSet);
  else element.value = valueToSet;
}

function setText(id, text) {
  const element = $(id);
  if (element) element.textContent = text ?? "";
}

function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function escapeAttribute(input) {
  return escapeHtml(input);
}

function capitalize(valueToCap) {
  return String(valueToCap).charAt(0).toUpperCase() + String(valueToCap).slice(1);
}

/* =========================
   STARTUP
========================= */
async function restoreSession() {
  const developerId = localStorage.getItem("smartbaseDeveloperId");
  if (!developerId) return;

  try {
    const data = await api("/api/projects", {
      headers: {"X-Developer-Id": developerId}
    });

    developer = {id: developerId, name: "Developer", email: ""};
    projects = data.projects || [];
    enterDashboard();
    populateProjectSelectors();
    renderProjectList();

    if (projects.length) {
      currentProject = projects[0];
      $("projectSelect").value = currentProject.id;
      $("designerProjectSelect").value = currentProject.id;
      await loadTemplate();
      updateProjectUI();
      updateApiExample();
      updateKeyUI();
    }
  } catch {
    localStorage.removeItem("smartbaseDeveloperId");
  }
}

updateRangeLabels();
switchAuth("signup");
restoreSession();

/* Smartbase extensions */
var revealedKeys = {};

async function api(url, options = {}) {
  const response = await fetch(url, {credentials: "same-origin", ...options});
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && developer && !String(url).includes("/api/login")) {
    developer = null;
    localStorage.removeItem("smartbaseDeveloperId");
    $("dashboard").classList.add("hidden");
    $("auth").classList.remove("hidden");
    toast("Session expired. Please log in again.");
  }
  if (!response.ok) throw new Error(data.error || data.message || "Request failed");
  if (data.project && data.project.apiKey) revealedKeys[data.project.id] = data.project.apiKey;
  if (Array.isArray(data.projects)) {
    data.projects.forEach((p) => {
      if (revealedKeys[p.id]) p.apiKey = revealedKeys[p.id];
    });
  }
  return data;
}

async function logout() {
  try { await fetch("/api/logout", {method: "POST"}); } catch {}
  developer = null;
  projects = [];
  currentProject = null;
  currentTemplate = null;
  localStorage.removeItem("smartbaseDeveloperId");
  $("dashboard").classList.add("hidden");
  $("auth").classList.remove("hidden");
  switchAuth("login");
  toast("You have been logged out.");
}

async function restoreSession() {
  if (!localStorage.getItem("smartbaseDeveloperId")) return;
  try {
    const me = await api("/api/me");
    developer = me.developer;
    const data = await api("/api/projects");
    projects = data.projects || [];
    enterDashboard();
    populateProjectSelectors();
    renderProjectList();
    if (projects.length) {
      currentProject = projects[0];
      $("projectSelect").value = currentProject.id;
      $("designerProjectSelect").value = currentProject.id;
      await loadTemplate();
      updateProjectUI();
      updateApiExample();
      updateKeyUI();
    }
  } catch {
    localStorage.removeItem("smartbaseDeveloperId");
  }
}

function updateApiExample() {
  if (!currentProject) {
    setText("apiExample", "Create a project to generate your integration example.");
    return;
  }
  const base = location.origin;
  $("apiExample").textContent =
`# Run these on YOUR server, never in browser code.

# 1) Send a verification (link or code, depending on your Verification settings)
curl -X POST ${base}/api/v1/send-verification \\
  -H "Content-Type: application/json" \\
  -H "X-Smartbase-Key: YOUR_PROJECT_API_KEY" \\
  -d '{"email":"customer@example.com","name":"Customer"}'

# 2a) LINK method: after the user taps the button, confirm it
curl "${base}/api/v1/status?email=customer@example.com" \\
  -H "X-Smartbase-Key: YOUR_PROJECT_API_KEY"

# 2b) CODE method: check the code the user typed on your site
curl -X POST ${base}/api/v1/verify-code \\
  -H "Content-Type: application/json" \\
  -H "X-Smartbase-Key: YOUR_PROJECT_API_KEY" \\
  -d '{"email":"customer@example.com","code":"123456"}'`;
}

function updateKeyUI() {
  const box = $("projectApiKey");
  if (!box) return;
  if (!currentProject) {
    box.textContent = "Create a project to generate a key.";
    return;
  }
  const full = revealedKeys[currentProject.id];
  box.textContent = full || (currentProject.keyPrefix || "sb_live_") + "••••••••••••••••••••••••";
  if (!$("rotateApiKey") && $("copyApiKey")) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "rotateApiKey";
    button.className = "secondary";
    button.textContent = "New key";
    button.addEventListener("click", rotateApiKey);
    $("copyApiKey").insertAdjacentElement("afterend", button);
  }
}

async function rotateApiKey() {
  if (!currentProject) return;
  if (!confirm("Generate a new API key? The old key stops working immediately.")) return;
  try {
    const data = await api("/api/projects/rotate-key", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({projectId: currentProject.id})
    });
    revealedKeys[currentProject.id] = data.apiKey;
    currentProject.apiKey = data.apiKey;
    currentProject.keyPrefix = data.keyPrefix;
    updateKeyUI();
    updateApiExample();
    toast("New API key generated. Copy it now.");
  } catch (err) {
    toast(err.message);
  }
}

(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}[c]));
  const field = "width:100%;margin-top:7px;padding:12px 13px;border:1px solid #dfe2e7;border-radius:9px;background:#fafbfc;color:#20242a;font:inherit";
  const jsonHeaders = {"Content-Type": "application/json"};

  const designerNav = document.querySelector('.nav-item[data-view="designer"]');
  const designerSection = document.querySelector('.view[data-section="designer"]');
  if (!designerNav || !designerSection) return;

  function addView(key, label, icon, anchorNav, anchorSection, html) {
    viewLabels[key] = label;
    const nav = document.createElement("button");
    nav.type = "button";
    nav.className = "nav-item";
    nav.dataset.view = key;
    nav.innerHTML = '<span class="nav-icon">' + icon + "</span>" + label;
    anchorNav.insertAdjacentElement("afterend", nav);
    nav.addEventListener("click", () => navigate(key));
    const section = document.createElement("section");
    section.className = "view";
    section.dataset.section = key;
    section.innerHTML = html;
    anchorSection.insertAdjacentElement("afterend", section);
    return {nav, section};
  }

  /* ---------- Verification flow view ---------- */
  const flowView = addView("flow", "Verification", "✔", designerNav, designerSection, `
    <div class="page-heading"><div>
      <span class="eyebrow">Verification</span>
      <h1>Verification flow</h1>
      <p>Choose how your users verify, and what they see afterwards.</p>
    </div></div>
    <article class="surface create-project-card" style="max-width:680px">
      <div class="surface-head"><div><span class="mini-label">Project</span><h2 id="flowProjectName">No project selected</h2></div></div>
      <form id="flowForm">
        <label>Verification method
          <select id="flowMethod" style="${field}">
            <option value="link">Link: the user taps a button in the email</option>
            <option value="code">Secret code: the user types a 6-digit code</option>
          </select>
        </label>
        <div id="flowCodeBox">
          <label>Text above the code in the email
            <input id="flowCodeLabel" type="text" maxlength="60">
          </label>
          <p class="form-helper">In code mode the email button is replaced by the code. Your site checks the code with <b>POST /api/v1/verify-code</b>.</p>
        </div>
        <div id="flowAfterBox" style="display:grid;gap:14px">
          <label>After the user taps the button
            <select id="flowAfterMode" style="${field}">
              <option value="page">Show a success page I design</option>
              <option value="redirect">Send them straight to my website</option>
            </select>
          </label>
          <div id="flowPageFields" style="display:grid;gap:14px">
            <label>Heading <input id="flowHeading" type="text" maxlength="100"></label>
            <label>Message <textarea id="flowMessage" rows="3" maxlength="400" style="${field}"></textarea></label>
            <label>Button text (opens your website) <input id="flowButtonText" type="text" maxlength="40"></label>
            <label class="check-label"><input id="flowShowLogo" type="checkbox"> Show my logo on the page</label>
            <p class="form-helper">You can use {{email}} and {{projectName}}. Colors, fonts and button style come from your email design. The button needs a website URL on the project.</p>
          </div>
        </div>
        <button class="primary" type="submit" id="flowSave">Save flow</button>
        <button class="secondary" type="button" id="flowPreview">Preview success page</button>
      </form>
    </article>`);

  function toggleFlowFields() {
    const code = $("flowMethod").value === "code";
    $("flowCodeBox").style.display = code ? "" : "none";
    $("flowAfterBox").style.display = code ? "none" : "grid";
    $("flowPageFields").style.display = $("flowAfterMode").value === "page" ? "grid" : "none";
  }

  function fillFlow(f) {
    $("flowMethod").value = f.method;
    $("flowCodeLabel").value = f.codeLabel;
    $("flowAfterMode").value = f.afterMode;
    $("flowHeading").value = f.afterHeading;
    $("flowMessage").value = f.afterMessage;
    $("flowButtonText").value = f.afterButtonText;
    $("flowShowLogo").checked = !!f.afterShowLogo;
    toggleFlowFields();
  }

  function readFlow() {
    return {
      method: $("flowMethod").value,
      codeLabel: $("flowCodeLabel").value,
      afterMode: $("flowAfterMode").value,
      afterHeading: $("flowHeading").value,
      afterMessage: $("flowMessage").value,
      afterButtonText: $("flowButtonText").value,
      afterShowLogo: $("flowShowLogo").checked
    };
  }

  async function loadFlowView() {
    $("flowProjectName").textContent = currentProject ? currentProject.name : "No project selected";
    if (!currentProject) return;
    const data = await api("/api/flow?projectId=" + encodeURIComponent(currentProject.id));
    fillFlow(data.flow);
  }

  $("flowMethod").addEventListener("change", toggleFlowFields);
  $("flowAfterMode").addEventListener("change", toggleFlowFields);
  $("flowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentProject) { toast("Create or select a project first."); return; }
    try {
      const data = await api("/api/flow", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({projectId: currentProject.id, flow: readFlow()})
      });
      fillFlow(data.flow);
      toast("Verification flow saved.");
    } catch (err) {
      toast(err.message);
    }
  });
  $("flowPreview").addEventListener("click", () => {
    if (!currentProject) { toast("Create or select a project first."); return; }
    window.open("/preview/success?projectId=" + encodeURIComponent(currentProject.id), "_blank");
  });

  /* ---------- Send test view ---------- */
  const testView = addView("test", "Send test", "✉", flowView.nav, flowView.section, `
    <div class="page-heading"><div>
      <span class="eyebrow">Email design</span>
      <h1>Send a test</h1>
      <p>Send your saved design and walk through the real verification flow.</p>
    </div></div>
    <article class="surface create-project-card" style="max-width:680px">
      <div class="surface-head"><div><span class="mini-label">Saved design for</span><h2 id="testProjectName">No project selected</h2></div></div>
      <form id="testForm">
        <label>Send test to <input id="testEmail" type="email" placeholder="you@example.com" required></label>
        <label>Recipient name (optional) <input id="testName" type="text" placeholder="Test User"></label>
        <button class="primary" id="testSend" type="submit">Send test email</button>
      </form>
      <p class="form-helper">Tests use your last saved design and verification flow, so save first if you changed something. Test verifications are not counted as real ones.</p>
      <div id="testResult"></div>
      <div id="testStatus" style="margin-top:14px"></div>
      <div id="testCodeBox" style="display:none;margin-top:14px">
        <label>Enter the code from the email
          <input id="testCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456">
        </label>
        <button class="secondary" type="button" id="testVerifyCode" style="margin-top:10px">Verify code</button>
      </div>
      <button class="secondary" type="button" id="testRefresh" style="display:none;margin-top:12px">Check status</button>
    </article>`);

  let lastTest = null;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    const until = Date.now() + 15 * 60000;
    pollTimer = setInterval(() => {
      const active = document.querySelector('.view[data-section="test"].active-view');
      if (!active || Date.now() > until) { stopPolling(); return; }
      checkTestStatus(false);
    }, 4000);
  }

  function renderTestStatus(data) {
    const box = $("testStatus");
    if (!lastTest) { box.innerHTML = ""; return; }
    if (data.verified) {
      const when = data.verifiedAt ? new Date(data.verifiedAt).toLocaleTimeString() : "";
      box.innerHTML = '<div class="successBox"><strong>✓ Verified</strong><p>' + esc(lastTest.email) +
        " was verified" + (when ? " at " + esc(when) : "") + ".</p></div>";
      $("testCodeBox").style.display = "none";
    } else {
      box.innerHTML = '<div class="security-warning"><strong>Not verified yet</strong><span>' +
        (lastTest.method === "code"
          ? "Type the code from the email below."
          : "Waiting for you to tap the button in the email. This updates automatically.") +
        "</span></div>";
    }
  }

  async function checkTestStatus(manual) {
    if (!currentProject || !lastTest) return;
    try {
      const data = await api("/api/test-status?projectId=" + encodeURIComponent(currentProject.id) +
        "&email=" + encodeURIComponent(lastTest.email));
      lastTest.verified = !!data.verified;
      renderTestStatus(data);
      if (data.verified) stopPolling();
    } catch (err) {
      if (manual) toast(err.message);
    }
  }

  function refreshTestView() {
    $("testProjectName").textContent = currentProject ? currentProject.name : "No project selected";
    $("testSend").disabled = !currentProject;
    if (developer && !$("testEmail").value) $("testEmail").value = developer.email || "";
    if (lastTest && currentProject && lastTest.projectId === currentProject.id) {
      checkTestStatus(false);
      if (!lastTest.verified) startPolling();
    } else {
      lastTest = null;
      stopPolling();
      $("testResult").innerHTML = "";
      $("testStatus").innerHTML = "";
      $("testCodeBox").style.display = "none";
      $("testRefresh").style.display = "none";
    }
  }

  $("testForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentProject) { toast("Create or select a project first."); return; }
    const button = $("testSend");
    button.disabled = true;
    button.textContent = "Sending…";
    $("testResult").innerHTML = "";
    try {
      const email = $("testEmail").value.trim();
      const data = await api("/api/test-email", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({projectId: currentProject.id, email, name: $("testName").value})
      });
      lastTest = {projectId: currentProject.id, email, method: data.method, verified: false};
      $("testResult").innerHTML = '<div class="successBox"><strong>Test email sent.</strong><p>' +
        (data.method === "code"
          ? "Open your inbox (check spam too) and find the 6-digit code. It works for "
          : "Open your inbox (check spam too) and tap the button. The link works for ") +
        data.expires_in_minutes + " minutes.</p></div>";
      $("testCodeBox").style.display = data.method === "code" ? "" : "none";
      $("testCode").value = "";
      $("testRefresh").style.display = "";
      renderTestStatus({verified: false});
      if (data.method === "link") startPolling(); else stopPolling();
      toast("Test email sent.");
    } catch (err) {
      $("testResult").innerHTML = '<div class="security-warning"><strong>Could not send</strong><span>' +
        esc(err.message) + "</span></div>";
    } finally {
      button.disabled = false;
      button.textContent = "Send test email";
    }
  });

  $("testVerifyCode").addEventListener("click", async () => {
    if (!currentProject || !lastTest) return;
    try {
      await api("/api/test-verify-code", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({projectId: currentProject.id, email: lastTest.email, code: $("testCode").value})
      });
      await checkTestStatus(true);
    } catch (err) {
      toast(err.message);
    }
  });
  $("testRefresh").addEventListener("click", () => checkTestStatus(true));

  const toolbar = document.querySelector(".toolbar-actions");
  if (toolbar) {
    const shortcut = document.createElement("button");
    shortcut.type = "button";
    shortcut.className = "toolbar-button";
    shortcut.textContent = "Send test";
    shortcut.addEventListener("click", () => navigate("test"));
    toolbar.insertBefore(shortcut, toolbar.querySelector(".primary"));
  }

  const baseNavigate = navigate;
  navigate = function (view) {
    baseNavigate(view);
    if (view === "flow") loadFlowView().catch((err) => toast(err.message));
    if (view === "test") refreshTestView();
  };
})();

/* Smartbase google view */
(function () {
  const anchorNav = document.querySelector('.nav-item[data-view="test"]') ||
    document.querySelector('.nav-item[data-view="designer"]');
  const anchorSection = document.querySelector('.view[data-section="test"]') ||
    document.querySelector('.view[data-section="designer"]');
  if (!anchorNav || !anchorSection) return;

  viewLabels.google = "Google sign-in";

  const nav = document.createElement("button");
  nav.type = "button";
  nav.className = "nav-item";
  nav.dataset.view = "google";
  nav.innerHTML = '<span class="nav-icon">G</span>Google sign-in';
  anchorNav.insertAdjacentElement("afterend", nav);
  nav.addEventListener("click", () => navigate("google"));

  const section = document.createElement("section");
  section.className = "view";
  section.dataset.section = "google";
  section.innerHTML = `
    <div class="page-heading"><div>
      <span class="eyebrow">Authentication</span>
      <h1>Google sign-in</h1>
      <p>Let your users sign in with Google and receive their verified profile on your server.</p>
    </div></div>
    <article class="surface create-project-card" style="max-width:760px">
      <div class="surface-head"><div><span class="mini-label">Project</span><h2 id="gProjectName">No project selected</h2></div></div>
      <div style="display:grid;gap:14px">
        <label class="check-label"><input id="gEnabled" type="checkbox"> Enable Google sign-in</label>
        <p class="form-helper" id="gNotice" style="margin:0"></p>
        <label>Project ID (public, safe to put in your website)
          <input id="gProjectId" type="text" readonly>
        </label>
        <button class="secondary" id="gCopyId" type="button">Copy project ID</button>
        <button class="primary" id="gTest" type="button">Test Google sign-in</button>
        <div id="gTestResult"></div>
      </div>
    </article>
    <article class="surface" style="max-width:760px;margin-top:14px">
      <div class="surface-head"><div><span class="mini-label">Integrate</span><h2>Code for your developers</h2></div></div>
      <div id="gSnippets"></div>
    </article>
    <article class="surface" style="max-width:760px;margin-top:14px">
      <div class="surface-head"><div><span class="mini-label">Signed-in users</span><h2 id="gUserTotal">0 users</h2></div></div>
      <div id="gUsers"></div>
    </article>`;
  anchorSection.insertAdjacentElement("afterend", section);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("Copied.");
  }

  function snippets(origin, projectId) {
    const client = [
      '<div id="google-login"></div>',
      '<script src="' + origin + '/smartbase.js"></script>',
      "<script>",
      '  Smartbase.init({ projectId: "' + projectId + '" });',
      "",
      "  // Adds a ready-made Google button (or call Smartbase.signInWithGoogle() yourself)",
      '  Smartbase.googleButton("#google-login");',
      "",
      "  // Runs when the user comes back from Google",
      "  var result = Smartbase.getRedirectResult();",
      "  if (result && result.code) {",
      "    // Send the one-time code to YOUR server, never use it in the browser",
      '    fetch("/api/login/google", {',
      '      method: "POST",',
      '      headers: { "Content-Type": "application/json" },',
      "      body: JSON.stringify({ code: result.code })",
      "    });",
      "  } else if (result) {",
      '    console.log("Sign-in failed:", result.error);',
      "  }",
      "</script>"
    ].join("\n");

    const node = [
      "// POST /api/login/google  (runs on YOUR server)",
      "// Keep the key in an environment variable, never in browser code.",
      'const res = await fetch("' + origin + '/api/v1/google/exchange", {',
      '  method: "POST",',
      "  headers: {",
      '    "Content-Type": "application/json",',
      '    "X-Smartbase-Key": process.env.SMARTBASE_KEY',
      "  },",
      "  body: JSON.stringify({ code: req.body.code })",
      "});",
      "const data = await res.json();",
      "if (!data.success) return res.status(401).json({ error: data.message });",
      "",
      "// data.user = { id, email, email_verified, name, picture, ... }",
      "// Find or create YOUR user by data.user.id, then start your own session."
    ].join("\n");

    const php = [
      "<?php",
      "// login-google.php  (runs on YOUR server)",
      '$ch = curl_init("' + origin + '/api/v1/google/exchange");',
      "curl_setopt_array($ch, [",
      "  CURLOPT_POST => true,",
      "  CURLOPT_RETURNTRANSFER => true,",
      "  CURLOPT_HTTPHEADER => [",
      '    "Content-Type: application/json",',
      '    "X-Smartbase-Key: " . getenv("SMARTBASE_KEY")',
      "  ],",
      '  CURLOPT_POSTFIELDS => json_encode(["code" => $_POST["code"]])',
      "]);",
      "$data = json_decode(curl_exec($ch), true);",
      'if (empty($data["success"])) { http_response_code(401); exit; }',
      "",
      '// $data["user"] has id, email, email_verified, name, picture',
      "// Find or create YOUR user, then start your own session."
    ].join("\n");

    return [
      {title: "1. Your website (browser)", text: client},
      {title: "2a. Your server (Node.js)", text: node},
      {title: "2b. Your server (PHP)", text: php}
    ];
  }

  function renderSnippets(origin, projectId) {
    const box = $("gSnippets");
    box.innerHTML = "";
    snippets(origin, projectId).forEach((item) => {
      const wrap = document.createElement("div");
      wrap.style.marginTop = "16px";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px";
      const title = document.createElement("strong");
      title.style.fontSize = "12px";
      title.textContent = item.title;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "secondary";
      copy.style.cssText = "padding:7px 11px;font-size:11px";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => copyText(item.text));
      head.append(title, copy);
      const pre = document.createElement("pre");
      pre.style.cssText = "margin:0;padding:12px;border-radius:9px;background:#11151b;color:#e5e8ed;font-size:11px;overflow:auto;white-space:pre";
      pre.textContent = item.text;
      wrap.append(head, pre);
      box.appendChild(wrap);
    });
  }

  function renderUsers(data) {
    $("gUserTotal").textContent = data.total + (data.total === 1 ? " user" : " users");
    const box = $("gUsers");
    box.innerHTML = "";
    if (!data.users.length) {
      box.textContent = "No users yet. They appear here after someone signs in with Google.";
      return;
    }
    data.users.forEach((u) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #edf0f3;font-size:12px";
      const left = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = u.name || u.email;
      const mail = document.createElement("div");
      mail.style.cssText = "color:#8a919b;font-size:11px;margin-top:3px;word-break:break-all";
      mail.textContent = u.email + (u.email_verified ? " ✓" : "");
      left.append(name, mail);
      const right = document.createElement("div");
      right.style.cssText = "color:#8a919b;font-size:10px;text-align:right;white-space:nowrap";
      right.textContent = "Last login " + new Date(u.last_login_at).toLocaleDateString();
      row.append(left, right);
      box.appendChild(row);
    });
  }

  function showTestResult(user, error) {
    const box = $("gTestResult");
    box.innerHTML = "";
    const div = document.createElement("div");
    if (error) {
      div.className = "security-warning";
      div.innerHTML = "<strong>Test failed</strong><span></span>";
      div.querySelector("span").textContent = error;
    } else {
      div.className = "successBox";
      div.innerHTML = "<strong>✓ Google sign-in works</strong><code></code>";
      const code = div.querySelector("code");
      code.style.whiteSpace = "pre";
      code.textContent = JSON.stringify(user, null, 2);
    }
    box.appendChild(div);
  }

  async function loadGoogleView() {
    if (!currentProject) {
      $("gProjectName").textContent = "No project selected";
      $("gEnabled").disabled = true;
      $("gTest").disabled = true;
      $("gNotice").textContent = "Create or select a project first.";
      return;
    }
    $("gProjectName").textContent = currentProject.name;
    $("gProjectId").value = currentProject.id;
    $("gEnabled").disabled = false;
    $("gTest").disabled = false;

    const id = encodeURIComponent(currentProject.id);
    const [prov, users] = await Promise.all([
      api("/api/providers?projectId=" + id),
      api("/api/end-users?projectId=" + id)
    ]);
    $("gEnabled").checked = !!prov.google.enabled;
    if (!prov.google.configured) {
      $("gNotice").textContent = "This server is missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.";
    } else if (!prov.website) {
      $("gNotice").textContent = "Add a website URL to this project. Google sign-in only redirects back to your website.";
    } else {
      $("gNotice").textContent = "Users can sign in from pages on " + prov.website;
    }
    renderSnippets(location.origin, currentProject.id);
    renderUsers(users);
  }

  $("gEnabled").addEventListener("change", async () => {
    if (!currentProject) return;
    const want = $("gEnabled").checked;
    try {
      await api("/api/providers", {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({projectId: currentProject.id, google: want})
      });
      toast(want ? "Google sign-in enabled." : "Google sign-in disabled.");
    } catch (err) {
      $("gEnabled").checked = !want;
      toast(err.message);
    }
  });

  $("gCopyId").addEventListener("click", () => {
    if (currentProject) copyText(currentProject.id);
  });

  $("gTest").addEventListener("click", () => {
    if (!currentProject) return;
    if (!$("gEnabled").checked) {
      toast("Turn on Google sign-in first.");
      return;
    }
    location.assign("/auth/google/test-start?project=" + encodeURIComponent(currentProject.id));
  });

  const baseNavigate = navigate;
  navigate = function (view) {
    baseNavigate(view);
    if (view === "google") loadGoogleView().catch((err) => toast(err.message));
  };

  const params = new URLSearchParams(location.search);
  if (params.get("google_test") === "1" && (params.get("smartbase_code") || params.get("smartbase_error"))) {
    const code = params.get("smartbase_code");
    const failure = params.get("smartbase_error");
    history.replaceState(null, "", location.pathname);
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const ready = currentProject && !$("dashboard").classList.contains("hidden");
      if (!ready && tries < 40) return;
      clearInterval(timer);
      if (!ready) return;
      navigate("google");
      if (failure) {
        showTestResult(null, "Google returned: " + failure);
        return;
      }
      try {
        const data = await api("/api/google-test-result", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({code})
        });
        showTestResult(data.user, null);
        const users = await api("/api/end-users?projectId=" + encodeURIComponent(currentProject.id));
        renderUsers(users);
      } catch (err) {
        showTestResult(null, err.message);
      }
    }, 300);
  }
})();
