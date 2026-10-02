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
  setTimeout(() => el.classList.remove("show"), 2500);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}


/* =========================
   AUTH
========================= */

$("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const data = await api("/api/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: $("signupName").value,
        email: $("signupEmail").value,
        password: $("signupPassword").value
      })
    });

    toast(data.message || "Account created. Check your email.");

    $("signupForm").reset();

  } catch (err) {
    toast(err.message);
  }
});


$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: $("loginEmail").value,
        password: $("loginPassword").value
      })
    });

    developer = data.developer;

    localStorage.setItem(
      "smartbaseDeveloperId",
      developer.id
    );

    $("auth").classList.add("hidden");
    $("dashboard").classList.remove("hidden");

    $("developerInfo").textContent =
      `Logged in as ${developer.name} (${developer.email})`;

    $("loginForm").reset();

    await loadProjects();

  } catch (err) {
    toast(err.message);
  }
});


async function logout() {
  developer = null;
  projects = [];
  currentProject = null;
  currentTemplate = null;

  localStorage.removeItem("smartbaseDeveloperId");

  $("dashboard").classList.add("hidden");
  $("auth").classList.remove("hidden");
}


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
        <code>${escapeHtml(data.project.apiKey)}</code>
        <p class="warningText">
          Keep this API key private. Do not expose it in frontend JavaScript.
        </p>
      </div>
    `;

    toast("Project created.");

    await loadProjects();

  } catch (err) {
    toast(err.message);
  }
});


async function loadProjects() {
  if (!developer) return;

  try {
    const data = await api("/api/projects", {
      headers: {
        "X-Developer-Id": developer.id
      }
    });

    projects = data.projects || [];

    const select = $("projectSelect");

    select.innerHTML = "";

    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });

    if (projects.length) {
      currentProject = projects[0];
      select.value = currentProject.id;
      await loadTemplate();
      updateApiExample();
    }

  } catch (err) {
    toast(err.message);
  }
}


$("projectSelect")?.addEventListener("change", async () => {

  const id = $("projectSelect").value;

  currentProject =
    projects.find((project) => project.id === id) || null;

  if (currentProject) {
    await loadTemplate();
    updateApiExample();
  }

});


/* =========================
   TEMPLATE
========================= */

async function loadTemplate() {

  if (!currentProject) return;

  try {

    const data = await api(
      `/api/template?projectId=${encodeURIComponent(currentProject.id)}`,
      {
        headers: {
          "X-Developer-Id": developer.id
        }
      }
    );

    currentTemplate = data.template || {};

    fillDesigner(currentTemplate);

    updatePreview();

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

    headerImageDataUrl:
      currentTemplate?.headerImageDataUrl || "",

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

    showDivider: $("showDivider").checked,

    footerText: value("footerText"),
    footerColor: value("footerColor"),
    supportEmail: value("supportEmail")

  };

}


function fillDesigner(template) {

  setValue("subject", template.subject);
  setValue("heading", template.heading);
  setValue("message", template.message);
  setValue("buttonText", template.buttonText);

  setValue(
    "brandColor",
    template.brandColor || "#2563eb"
  );

  setValue(
    "bgColor",
    template.background || "#f4f7fb"
  );

  setValue(
    "companyName",
    template.companyName || currentProject?.name || ""
  );

  setValue(
    "logoPosition",
    template.logoPosition || "center"
  );

  setValue(
    "logoWidth",
    template.logoWidth || 100
  );

  setValue(
    "headingColor",
    template.headingColor || "#111827"
  );

  setValue(
    "headingSize",
    template.headingSize || 28
  );

  setValue(
    "textColor",
    template.textColor || "#4b5563"
  );

  setValue(
    "textSize",
    template.textSize || 16
  );

  setValue(
    "fontFamily",
    template.fontFamily || "Arial, sans-serif"
  );

  setValue(
    "buttonColor",
    template.buttonColor || "#2563eb"
  );

  setValue(
    "buttonTextColor",
    template.buttonTextColor || "#ffffff"
  );

  setValue(
    "buttonWidth",
    template.buttonWidth || "280px"
  );

  setValue(
    "buttonAlign",
    template.buttonAlign || "center"
  );

  setValue(
    "buttonRadius",
    template.buttonRadius || 8
  );

  setValue(
    "cardBackground",
    template.cardBackground || "#ffffff"
  );

  setValue(
    "cardWidth",
    template.cardWidth || "560px"
  );

  setValue(
    "cardRadius",
    template.cardRadius || 14
  );

  $("showDivider").checked =
    template.showDivider !== false;

  setValue(
    "footerText",
    template.footerText ||
      "© {{projectName}}. All rights reserved."
  );

  setValue(
    "footerColor",
    template.footerColor || "#6b7280"
  );

  setValue(
    "supportEmail",
    template.supportEmail || ""
  );

  currentTemplate = {
    ...currentTemplate,
    ...template
  };

  updateRangeLabels();

  showStoredImage(
    "logoPreviewBox",
    "logoPreview",
    template.logoDataUrl
  );

  showStoredImage(
    "headerImagePreviewBox",
    "headerImagePreview",
    template.headerImageDataUrl
  );

}


async function saveTemplate() {

  if (!developer || !currentProject) {
    toast("Create or select a project first.");
    return;
  }

  try {

    const template = getTemplateFromDesigner();

    const data = await api("/api/template", {
      method: "PUT",

      headers: {
        "Content-Type": "application/json",
        "X-Developer-Id": developer.id
      },

      body: JSON.stringify({
        projectId: currentProject.id,
        template
      })

    });

    currentTemplate = data.template || template;

    toast("Email design saved.");

  } catch (err) {
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

    currentTemplate = {
      ...(currentTemplate || {}),
      logoDataUrl: dataUrl
    };

    showStoredImage(
      "logoPreviewBox",
      "logoPreview",
      dataUrl
    );

    updatePreview();

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

    currentTemplate = {
      ...(currentTemplate || {}),
      headerImageDataUrl: dataUrl
    };

    showStoredImage(
      "headerImagePreviewBox",
      "headerImagePreview",
      dataUrl
    );

    updatePreview();

  });

});


$("removeLogo")?.addEventListener("click", () => {

  currentTemplate = {
    ...(currentTemplate || {}),
    logoDataUrl: ""
  };

  $("logoFile").value = "";

  showStoredImage(
    "logoPreviewBox",
    "logoPreview",
    ""
  );

  updatePreview();

});


$("removeHeaderImage")?.addEventListener("click", () => {

  currentTemplate = {
    ...(currentTemplate || {}),
    headerImageDataUrl: ""
  };

  $("headerImageFile").value = "";

  showStoredImage(
    "headerImagePreviewBox",
    "headerImagePreview",
    ""
  );

  updatePreview();

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

  const html = buildPreviewHTML(template);

  frame.srcdoc = html;

}


function buildPreviewHTML(template) {

  const logo = template.logoDataUrl
    ? `
      <div style="
        text-align:${template.logoPosition};
        margin-bottom:20px;
      ">
        <img
          src="${template.logoDataUrl}"
          style="
            width:${template.logoWidth}px;
            max-width:100%;
            height:auto;
          "
        >
      </div>
    `
    : "";

  const banner = template.headerImageDataUrl
    ? `
      <img
        src="${template.headerImageDataUrl}"
        style="
          width:100%;
          max-height:220px;
          object-fit:cover;
          border-radius:${template.cardRadius}px ${template.cardRadius}px 0 0;
          display:block;
          margin-bottom:25px;
        "
      >
    `
    : "";

  const divider = template.showDivider
    ? `
      <div style="
        height:1px;
        background:${template.brandColor};
        opacity:.18;
        margin:24px 0;
      "></div>
    `
    : "";

  const support = template.supportEmail
    ? `
      <div style="
        margin-top:10px;
        font-size:13px;
      ">
        Need help?
        <a href="mailto:${escapeAttribute(template.supportEmail)}">
          ${escapeHtml(template.supportEmail)}
        </a>
      </div>
    `
    : "";

  return `
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{
  margin:0;
  padding:0;
  width:100%;
}
body{
  background:${template.background};
  font-family:${template.fontFamily};
}
*{
  box-sizing:border-box;
}
.emailCard{
  width:${template.cardWidth};
  max-width:calc(100% - 30px);
  margin:30px auto;
  background:${template.cardBackground};
  border-radius:${template.cardRadius}px;
  padding:36px;
  box-shadow:0 8px 35px rgba(0,0,0,.08);
}
@media(max-width:600px){
  .emailCard{
    padding:25px 20px;
    max-width:calc(100% - 20px);
  }
}
</style>
</head>

<body>

<div class="emailCard">

  ${banner}

  ${logo}

  <div style="
    text-align:center;
    font-size:13px;
    color:${template.brandColor};
    font-weight:700;
    margin-bottom:12px;
  ">
    ${escapeHtml(template.companyName || "{{projectName}}")}
  </div>

  <h1 style="
    margin:0 0 18px;
    color:${template.headingColor};
    font-size:${template.headingSize}px;
    text-align:center;
    line-height:1.2;
  ">
    ${escapeHtml(template.heading)}
  </h1>

  <div style="
    color:${template.textColor};
    font-size:${template.textSize}px;
    line-height:1.7;
    text-align:center;
  ">
    ${escapeHtml(template.message).replace(/\n/g, "<br>")}
  </div>

  ${divider}

  <div style="
    text-align:${template.buttonAlign};
    margin:25px 0;
  ">

    <a href="{{verification_url}}" style="
      display:inline-block;
      width:${template.buttonWidth === "auto" ? "auto" : template.buttonWidth};
      max-width:100%;
      padding:14px 24px;
      background:${template.buttonColor};
      color:${template.buttonTextColor};
      text-decoration:none;
      border-radius:${template.buttonRadius}px;
      font-weight:700;
      text-align:center;
    ">
      ${escapeHtml(template.buttonText)}
    </a>

  </div>

  ${support}

  <div style="
    margin-top:28px;
    color:${template.footerColor};
    font-size:12px;
    line-height:1.6;
    text-align:center;
  ">
    ${escapeHtml(template.footerText).replace(/\n/g, "<br>")}
  </div>

</div>

</body>
</html>
  `;

}


/* =========================
   STYLE PRESETS
========================= */

const presets = {

  classic: {
    brandColor: "#2563eb",
    background: "#f4f7fb",
    cardBackground: "#ffffff",
    headingColor: "#111827",
    textColor: "#4b5563",
    buttonColor: "#2563eb",
    buttonTextColor: "#ffffff",
    cardRadius: 14,
    buttonRadius: 8,
    fontFamily: "Arial, sans-serif"
  },

  modern: {
    brandColor: "#7c3aed",
    background: "#f5f3ff",
    cardBackground: "#ffffff",
    headingColor: "#312e81",
    textColor: "#4c1d95",
    buttonColor: "#7c3aed",
    buttonTextColor: "#ffffff",
    cardRadius: 20,
    buttonRadius: 14,
    fontFamily: "Trebuchet MS, sans-serif"
  },

  minimal: {
    brandColor: "#111827",
    background: "#ffffff",
    cardBackground: "#ffffff",
    headingColor: "#111827",
    textColor: "#4b5563",
    buttonColor: "#111827",
    buttonTextColor: "#ffffff",
    cardRadius: 4,
    buttonRadius: 4,
    fontFamily: "Arial, sans-serif"
  },

  gradient: {
    brandColor: "#ec4899",
    background: "#fdf2f8",
    cardBackground: "#ffffff",
    headingColor: "#831843",
    textColor: "#500724",
    buttonColor: "#ec4899",
    buttonTextColor: "#ffffff",
    cardRadius: 24,
    buttonRadius: 20,
    fontFamily: "Verdana, sans-serif"
  },

  dark: {
    brandColor: "#60a5fa",
    background: "#0f172a",
    cardBackground: "#1e293b",
    headingColor: "#f8fafc",
    textColor: "#cbd5e1",
    buttonColor: "#3b82f6",
    buttonTextColor: "#ffffff",
    cardRadius: 18,
    buttonRadius: 10,
    fontFamily: "Arial, sans-serif"
  },

  corporate: {
    brandColor: "#0f766e",
    background: "#f0fdfa",
    cardBackground: "#ffffff",
    headingColor: "#134e4a",
    textColor: "#475569",
    buttonColor: "#0f766e",
    buttonTextColor: "#ffffff",
    cardRadius: 10,
    buttonRadius: 6,
    fontFamily: "Tahoma, sans-serif"
  }

};


document.querySelectorAll(".styleOption").forEach((button) => {

  button.addEventListener("click", () => {

    const style = button.dataset.style;

    const preset = presets[style];

    if (!preset) return;

    Object.keys(preset).forEach((key) => {

      const map = {
        background: "bgColor"
      };

      const elementId = map[key] || key;

      setValue(
        elementId,
        preset[key]
      );

    });

    document
      .querySelectorAll(".styleOption")
      .forEach((item) => item.classList.remove("selected"));

    button.classList.add("selected");

    updatePreview();

  });

});


/* =========================
   PREVIEW MODE
========================= */

document.querySelectorAll(".previewMode").forEach((button) => {

  button.addEventListener("click", () => {

    document
      .querySelectorAll(".previewMode")
      .forEach((item) => item.classList.remove("active"));

    button.classList.add("active");

    const frame = $("preview");

    if (button.dataset.preview === "mobile") {

      frame.classList.add("mobilePreview");

    } else {

      frame.classList.remove("mobilePreview");

    }

  });

});


/* =========================
   RESET
========================= */

$("resetDesign")?.addEventListener("click", () => {

  const defaultTemplate = {

    subject: "Verify your email for {{projectName}}",
    heading: "Verify your email",
    message:
      "Hello {{name}}, please verify your email address to continue.",

    buttonText: "Verify email",

    brandColor: "#2563eb",
    background: "#f4f7fb",

    companyName:
      currentProject?.name || "",

    logoDataUrl: "",
    logoPosition: "center",
    logoWidth: 100,

    headerImageDataUrl: "",

    headingColor: "#111827",
    headingSize: 28,

    textColor: "#4b5563",
    textSize: 16,

    fontFamily: "Arial, sans-serif",

    buttonColor: "#2563eb",
    buttonTextColor: "#ffffff",
    buttonWidth: "280px",
    buttonAlign: "center",
    buttonRadius: 8,

    cardBackground: "#ffffff",
    cardWidth: "560px",
    cardRadius: 14,

    showDivider: true,

    footerText:
      "© {{projectName}}. All rights reserved.",

    footerColor: "#6b7280",

    supportEmail: ""

  };

  currentTemplate = defaultTemplate;

  fillDesigner(defaultTemplate);

  $("logoFile").value = "";
  $("headerImageFile").value = "";

  updatePreview();

  toast("Design reset.");

});


/* =========================
   LIVE INPUT EVENTS
========================= */

const liveFields = [

  "subject",
  "heading",
  "message",
  "companyName",

  "logoPosition",
  "logoWidth",

  "headingColor",
  "headingSize",

  "textColor",
  "textSize",
  "fontFamily",

  "buttonText",
  "buttonColor",
  "buttonTextColor",
  "buttonWidth",
  "buttonAlign",
  "buttonRadius",

  "brandColor",
  "bgColor",
  "cardBackground",
  "cardWidth",
  "cardRadius",

  "showDivider",

  "footerText",
  "footerColor",
  "supportEmail"

];

liveFields.forEach((id) => {

  const element = $(id);

  if (!element) return;

  element.addEventListener("input", () => {

    updateRangeLabels();
    updatePreview();

  });

  element.addEventListener("change", () => {

    updateRangeLabels();
    updatePreview();

  });

});


function updateRangeLabels() {

  setText(
    "logoWidthValue",
    `${value("logoWidth") || 100}px`
  );

  setText(
    "headingSizeValue",
    `${value("headingSize") || 28}px`
  );

  setText(
    "textSizeValue",
    `${value("textSize") || 16}px`
  );

  setText(
    "buttonRadiusValue",
    `${value("buttonRadius") || 8}px`
  );

  setText(
    "cardRadiusValue",
    `${value("cardRadius") || 14}px`
  );

}


/* =========================
   API EXAMPLE
========================= */

function updateApiExample() {

  if (!currentProject) return;

  $("apiExample").textContent =
`curl -X POST http://127.0.0.1:3000/api/v1/send-verification \\
  -H "Content-Type: application/json" \\
  -H "X-Smartbase-Key: YOUR_PROJECT_API_KEY" \\
  -d '{"email":"customer@example.com","name":"Customer"}'`;

}


/* =========================
   HELPERS
========================= */

function value(id) {

  const element = $(id);

  if (!element) return "";

  if (element.type === "checkbox") {
    return element.checked;
  }

  return element.value || "";

}


function setValue(id, valueToSet) {

  const element = $(id);

  if (!element || valueToSet === undefined) return;

  if (element.type === "checkbox") {

    element.checked = Boolean(valueToSet);

  } else {

    element.value = valueToSet;

  }

}


function setText(id, text) {

  const element = $(id);

  if (element) {
    element.textContent = text;
  }

}


function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


function escapeAttribute(value) {

  return escapeHtml(value);

}


/* =========================
   STARTUP
========================= */

async function restoreSession() {

  const developerId =
    localStorage.getItem("smartbaseDeveloperId");

  if (!developerId) return;

  try {

    const data = await api(
      `/api/projects`,
      {
        headers: {
          "X-Developer-Id": developerId
        }
      }
    );

    developer = {
      id: developerId,
      name: "Developer",
      email: ""
    };

    projects = data.projects || [];

    $("auth").classList.add("hidden");
    $("dashboard").classList.remove("hidden");

    $("developerInfo").textContent =
      "Developer dashboard";

    const select = $("projectSelect");

    select.innerHTML = "";

    projects.forEach((project) => {

      const option =
        document.createElement("option");

      option.value = project.id;
      option.textContent = project.name;

      select.appendChild(option);

    });

    if (projects.length) {

      currentProject = projects[0];

      select.value =
        currentProject.id;

      await loadTemplate();

      updateApiExample();

    }

  } catch (err) {

    localStorage.removeItem(
      "smartbaseDeveloperId"
    );

  }

}


updateRangeLabels();
restoreSession();
