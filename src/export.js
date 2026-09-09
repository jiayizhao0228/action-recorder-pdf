import { exportKey } from "./shared.js";

const params = new URLSearchParams(location.search);
const exportId = params.get("exportId");
const format = params.get("format") || "pdf";
const doc = document.getElementById("document");
const status = document.getElementById("status");
const printButton = document.getElementById("printButton");
const wordButton = document.getElementById("wordButton");
let loadedSession = null;

printButton.addEventListener("click", () => window.print());
wordButton.addEventListener("click", () => {
  if (loadedSession) downloadWord(loadedSession);
});

loadExport();

async function loadExport() {
  if (!exportId) {
    renderError("Missing export id");
    return;
  }
  const key = exportKey(exportId);
  const result = await chrome.storage.local.get(key);
  const session = result[key];
  if (!session) {
    renderError("Export data was not found");
    return;
  }
  loadedSession = session;
  renderSession(session);
  status.textContent = `${session.steps.length} 个步骤已准备好`;
  if (format === "word") {
    downloadWord(session);
  } else {
    status.textContent = "请点击左侧按钮保存 PDF";
  }
}

function renderSession(session) {
  const created = session.createdAt ? new Date(session.createdAt).toLocaleString() : "";
  doc.innerHTML = `
    <section class="summary">
      <h1>${escapeHtml(session.title || "操作记录")}</h1>
      <div class="meta">
        <span>${escapeHtml(created)}</span>
        <span>${session.steps.length} steps</span>
        <span>${escapeHtml(session.url || "")}</span>
      </div>
    </section>
    ${session.steps.map(renderStep).join("")}
  `;
}

function renderStep(step, index) {
  const parsed = parseAnnotation(step);
  return `
    <section class="step">
      <div class="step-head">
        <span class="step-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="type type-${escapeHtml(step.type)}">${escapeHtml(typeLabel(step.type))}</span>
      </div>
      ${renderHighlight(parsed, step.type)}
      <div class="note">${escapeHtml(step.annotation || "")}</div>
      <img src="${step.screenshotDataUrl}" alt="步骤 ${index + 1} 截图">
    </section>
  `;
}

function renderError(message) {
  status.textContent = message;
  doc.innerHTML = `<h1>导出失败</h1><p>${escapeHtml(message)}</p>`;
}

function typeLabel(type) {
  return { baseline: "当前屏幕", click: "点击", input: "输入" }[type] || type;
}

function downloadWord(session) {
  const html = buildWordHtml(session);
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTitle = (session.title || "操作记录").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  link.href = url;
  link.download = `${safeTitle || "操作记录"}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildWordHtml(session) {
  const created = session.createdAt ? new Date(session.createdAt).toLocaleString() : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(session.title || "操作记录")}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #172033; }
    h1 { font-size: 22pt; margin: 0 0 8pt; }
    .meta { color: #667085; font-size: 9pt; margin-bottom: 14pt; }
    .step { page-break-inside: avoid; border: 1px solid #e3e8ef; border-radius: 8pt; padding: 12pt; margin-top: 14pt; }
    .highlight { border: 1px solid #d8e0ea; border-radius: 8pt; padding: 8pt; margin: 8pt 0; background: #f8fafc; }
    .highlight-input { border-color: #bfdbfe; background: #eff6ff; }
    .highlight-click { border-color: #fecaca; background: #fff1f2; }
    .highlight-baseline { border-color: #bbf7d0; background: #f0fdf4; }
    .note { border-left: 4px solid #94a3b8; background: #f8fafc; padding: 8pt; margin: 8pt 0; white-space: pre-wrap; color: #475467; }
    img { max-width: 100%; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <h1>${escapeHtml(session.title || "操作记录")}</h1>
  <div class="meta">${escapeHtml(created)} · ${session.steps.length} steps · ${escapeHtml(session.url || "")}</div>
  ${session.steps.map((step, index) => `
    <div class="step">
      <h2>步骤 ${index + 1}: ${escapeHtml(typeLabel(step.type))}</h2>
      ${renderWordHighlight(parseAnnotation(step), step.type)}
      <div class="note">${escapeHtml(step.annotation || "")}</div>
      <img src="${step.screenshotDataUrl}" alt="步骤 ${index + 1} 截图">
    </div>
  `).join("")}
</body>
</html>`;
}

function renderHighlight(parsed, type) {
  if (!parsed.value) return "";
  return `
    <div class="highlight highlight-${escapeHtml(type)}">
      <span>${escapeHtml(parsed.label)}</span>
      <strong>${escapeHtml(parsed.value)}</strong>
    </div>
  `;
}

function renderWordHighlight(parsed, type) {
  if (!parsed.value) return "";
  return `<div class="highlight highlight-${escapeHtml(type)}"><b>${escapeHtml(parsed.label)}：</b>${escapeHtml(parsed.value)}</div>`;
}

function parseAnnotation(step) {
  const annotation = String(step.annotation || "").trim();
  if (!annotation) return { label: "", value: "" };
  if (step.type === "input") {
    const value = annotation.replace(/^输入[：:]\s*/, "").replace(/^输入了敏感内容[：:]\s*/, "");
    return { label: step.isSensitive ? "敏感输入" : "输入内容", value };
  }
  if (step.type === "click") {
    return { label: "点击目标", value: annotation.replace(/^点击了\s*/, "") };
  }
  if (step.type === "baseline") {
    return { label: "记录起点", value: annotation };
  }
  return { label: "说明", value: annotation };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
