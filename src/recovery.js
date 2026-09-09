import { MESSAGE } from "./shared.js";

const sessionsEl = document.getElementById("sessions");
const previewEl = document.getElementById("preview");
let sessions = [];

loadSessions();

async function loadSessions() {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE.LOAD_ALL_SESSIONS });
  const all = response?.ok ? response.result : {};
  sessions = Object.entries(all)
    .filter(([key, value]) => key.startsWith("actionRecorderSession:") && value && Array.isArray(value.steps))
    .map(([key, value]) => ({ key, session: value }))
    .sort((a, b) => String(b.session.updatedAt || "").localeCompare(String(a.session.updatedAt || "")));

  renderSessions();
  if (sessions[0]) renderPreview(sessions[0].session);
}

function renderSessions() {
  if (!sessions.length) {
    sessionsEl.innerHTML = `<div class="empty">没有找到本地缓存的操作记录。请确认没有卸载插件或清空浏览器数据。</div>`;
    previewEl.innerHTML = "";
    return;
  }
  sessionsEl.innerHTML = sessions.map(({ key, session }, index) => `
    <article class="session">
      <h2>${escapeHtml(session.title || "未命名记录")}</h2>
      <div class="meta">
        <div>${escapeHtml(formatDate(session.updatedAt || session.createdAt))}</div>
        <div>${session.steps.length} 个步骤</div>
        <div>${escapeHtml(session.url || "")}</div>
      </div>
      <div class="actions">
        <button class="primary" data-action="preview" data-index="${index}">预览</button>
        <button data-action="pdf" data-index="${index}">打开 PDF 页</button>
        <button class="word" data-action="word" data-index="${index}">导出 Word</button>
        <button data-action="copy" data-index="${index}">备份 JSON</button>
      </div>
    </article>
  `).join("");

  sessionsEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const item = sessions[Number(button.dataset.index)];
      if (!item) return;
      if (button.dataset.action === "preview") renderPreview(item.session);
      if (button.dataset.action === "pdf") openPdf(item.session);
      if (button.dataset.action === "word") downloadWord(item.session);
      if (button.dataset.action === "copy") downloadJson(item.session);
    });
  });
}

function renderPreview(session) {
  previewEl.innerHTML = `
    <h1>${escapeHtml(session.title || "操作记录")}</h1>
    <p>${escapeHtml(formatDate(session.createdAt))} · ${session.steps.length} 个步骤</p>
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
      ${parsed.value ? `<div class="highlight highlight-${escapeHtml(step.type)}"><span>${escapeHtml(parsed.label)}</span><strong>${escapeHtml(parsed.value)}</strong></div>` : ""}
      <div class="note">${escapeHtml(step.annotation || "")}</div>
      <img src="${step.screenshotDataUrl}" alt="步骤 ${index + 1} 截图">
    </section>
  `;
}

async function openPdf(session) {
  const html = buildPrintableHtml(session);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function downloadWord(session) {
  const html = buildWordHtml(session);
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  downloadBlob(blob, `${safeFileName(session.title || "操作记录")}.doc`);
}

function downloadJson(session) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `${safeFileName(session.title || "操作记录")}.json`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildWordHtml(session) {
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
    .step-head { margin-bottom: 8pt; }
    .step-index { background: #111827; color: #fff; border-radius: 12pt; padding: 3pt 8pt; font-weight: bold; }
    .type { border-radius: 12pt; padding: 3pt 8pt; font-weight: bold; }
    .type-click { background: #fee2e2; color: #b42318; }
    .type-input { background: #dbeafe; color: #1d4ed8; }
    .type-baseline { background: #ecfdf3; color: #047857; }
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
  <div class="meta">${escapeHtml(formatDate(session.createdAt))} · ${session.steps.length} 个步骤 · ${escapeHtml(session.url || "")}</div>
  ${session.steps.map(renderStep).join("")}
</body>
</html>`;
}

function buildPrintableHtml(session) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(session.title || "操作记录")}</title>
  <style>
    body { margin: 0; background: #eef2f7; color: #172033; font-family: "Microsoft YaHei", Arial, sans-serif; }
    .tools { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; padding: 12px 18px; background: #172033; color: #fff; }
    .tools button { height: 34px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; padding: 0 14px; font: inherit; cursor: pointer; }
    main { width: min(920px, calc(100vw - 40px)); margin: 24px auto; background: #fff; padding: 30px; box-shadow: 0 18px 50px rgba(21, 31, 48, .16); border-radius: 10px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .meta { color: #667085; font-size: 13px; margin-bottom: 10px; word-break: break-all; }
    .summary { padding: 18px; border: 1px solid #d8dee9; border-radius: 10px; background: linear-gradient(135deg, #f8fafc, #eef6ff); }
    .step { page-break-inside: avoid; break-inside: avoid; padding: 18px; margin-top: 18px; border: 1px solid #e3e8ef; border-radius: 10px; box-shadow: 0 10px 24px rgba(15, 23, 42, .05); }
    .step-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .step-index { width: 34px; height: 28px; border-radius: 999px; display: inline-grid; place-items: center; background: #111827; color: #fff; font-weight: 800; font-size: 13px; }
    .type { height: 28px; border-radius: 999px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 13px; font-weight: 800; }
    .type-click { background: #fee2e2; color: #b42318; }
    .type-input { background: #dbeafe; color: #1d4ed8; }
    .type-baseline { background: #ecfdf3; color: #047857; }
    .highlight { border: 1px solid #d8e0ea; border-radius: 10px; padding: 12px 14px; margin: 10px 0; background: #f8fafc; }
    .highlight span { display: block; color: #667085; font-size: 12px; margin-bottom: 4px; }
    .highlight strong { display: block; color: #101828; font-size: 16px; line-height: 1.45; }
    .highlight-input { border-color: #bfdbfe; background: #eff6ff; }
    .highlight-click { border-color: #fecaca; background: #fff1f2; }
    .highlight-baseline { border-color: #bbf7d0; background: #f0fdf4; }
    .note { border-left: 4px solid #94a3b8; background: #f8fafc; padding: 10px 12px; line-height: 1.55; white-space: pre-wrap; color: #475467; }
    img { max-width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; display: block; margin: 12px 0; }
    @media print { body { background: #fff; } .tools { display: none; } main { width: auto; margin: 0; padding: 0; box-shadow: none; border-radius: 0; } .step { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="tools"><button onclick="window.print()">打印 / 保存为 PDF</button><span>打印窗口里选择“另存为 PDF / Save as PDF”。</span></div>
  <main>
    <section class="summary">
      <h1>${escapeHtml(session.title || "操作记录")}</h1>
      <div class="meta">${escapeHtml(formatDate(session.createdAt))} · ${session.steps.length} 个步骤 · ${escapeHtml(session.url || "")}</div>
    </section>
    ${session.steps.map(renderStep).join("")}
  </main>
</body>
</html>`;
}

function typeLabel(type) {
  return { baseline: "当前屏幕", click: "点击", input: "输入" }[type] || type;
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

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function safeFileName(value) {
  return String(value || "操作记录").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "操作记录";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
