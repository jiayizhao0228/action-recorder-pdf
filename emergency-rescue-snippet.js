(() => {
  const host = document.getElementById("action-recorder-host");
  const root = host && host.shadowRoot;
  if (!root) {
    alert("没有找到操作记录缓存区。请先展开右侧缓存区，不要刷新页面。");
    return;
  }

  const rows = [...root.querySelectorAll(".ar-step")].map((row, index) => {
    const img = row.querySelector("img");
    const note = row.querySelector("textarea");
    const meta = row.querySelector(".ar-step-meta span");
    return {
      index: index + 1,
      type: meta ? meta.textContent.trim() : `步骤 ${index + 1}`,
      annotation: note ? note.value : "",
      screenshotDataUrl: img ? img.src : ""
    };
  });

  if (!rows.length) {
    alert("没有读取到步骤。请确认缓存区展开后能看到 62 个步骤，再运行这段脚本。");
    return;
  }

  const title = document.title || "操作记录抢救";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #172033; }
    h1 { font-size: 22pt; margin: 0 0 8pt; }
    .meta { color: #667085; font-size: 9pt; margin-bottom: 14pt; }
    .step { page-break-inside: avoid; border-top: 1px solid #d8dee9; padding-top: 14pt; margin-top: 14pt; }
    .note { border-left: 4px solid #2563eb; background: #f8fafc; padding: 8pt; margin: 8pt 0; white-space: pre-wrap; }
    img { max-width: 100%; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${new Date().toLocaleString()} · ${rows.length} 个步骤 · 从右侧缓存区应急恢复</div>
  ${rows.map((step) => `
    <div class="step">
      <h2>${escapeHtml(step.type)}</h2>
      <div class="note">${escapeHtml(step.annotation)}</div>
      <img src="${step.screenshotDataUrl}" alt="步骤 ${step.index} 截图">
    </div>
  `).join("")}
</body>
</html>`;

  download(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }), `${safeFileName(title)}-抢救.doc`);
  download(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFileName(title)}-抢救.json`);
  alert(`已尝试导出 ${rows.length} 个步骤为 Word 和 JSON。请检查浏览器下载记录。`);

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
})();
