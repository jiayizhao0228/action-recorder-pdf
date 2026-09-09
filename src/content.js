(async () => {
  if (window.__actionRecorderLoaded) return;
  window.__actionRecorderLoaded = true;

  const shared = await import(chrome.runtime.getURL("src/shared.js"));
  const {
    MESSAGE,
    buildClickAnnotation,
    buildInputAnnotation,
    cloneSessionForStorage,
    createId,
    getElementValue,
    isEditableElement,
    isSensitiveInput,
    nowIso
  } = shared;

  const PANEL_ID = "action-recorder-host";
  const state = {
    session: createSession(),
    panel: {
      x: null,
      y: 18,
      width: 360,
      collapsed: false
    },
    host: null,
    shadow: null,
    demoHost: null,
    demoShadow: null,
    demo: {
      active: false,
      index: 0
    },
    activeInput: null,
    inputInitialValue: "",
    suppressNextBlur: false,
    capturing: false,
    loadedStoredSession: false
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE.TOGGLE_PANEL) {
      togglePanel();
    }
  });

  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("focusout", handleFocusOut, true);
  document.addEventListener("keydown", handleKeyDown, true);

  function createSession() {
    return {
      id: createId("session"),
      tabId: null,
      url: location.href,
      title: document.title,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "ready",
      panelState: {},
      steps: []
    };
  }

  async function togglePanel() {
    ensurePanel();
    await loadStoredSession();
    if (state.host.style.display === "none") {
      state.host.style.display = "";
    }
    render();
  }

  function ensurePanel() {
    let host = document.getElementById(PANEL_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = PANEL_ID;
      host.style.all = "initial";
      host.style.position = "fixed";
      host.style.zIndex = "2147483647";
      host.style.top = `${state.panel.y}px`;
      host.style.right = "18px";
      host.style.width = `${state.panel.width}px`;
      host.style.height = "min(720px, calc(100vh - 36px))";
      host.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      document.documentElement.appendChild(host);
      state.shadow = host.attachShadow({ mode: "open" });
    } else {
      state.shadow = host.shadowRoot;
    }
    state.host = host;
  }

  function render() {
    if (!state.shadow) return;
    const { session, panel } = state;
    state.shadow.innerHTML = `
      <style>${panelStyles()}</style>
      ${panel.collapsed ? renderCollapsed() : renderPanel(session)}
    `;
    bindPanelEvents();
    applyPanelPosition();
  }

  function renderCollapsed() {
    return `<button class="ar-fab" data-action="expand" title="展开操作记录">记录 ${state.session.steps.length}</button>`;
  }

  function renderPanel(session) {
    const canRecord = session.status === "ready" || session.status === "stopped";
    const isRecording = session.status === "recording";
    const steps = session.steps.map(renderStep).join("");
    return `
      <section class="ar-panel">
        <div class="ar-resize" title="拖动调整宽度"></div>
        <header class="ar-header" data-drag-handle>
          <div>
            <strong>操作记录缓存区</strong>
            <span>${statusLabel(session.status)} · ${session.steps.length} 步</span>
          </div>
          <nav>
            <button data-action="help" title="查看使用教程">?</button>
            <button data-action="snap" title="吸附到右侧">↔</button>
            <button data-action="collapse" title="折叠">–</button>
            <button data-action="close" title="关闭">×</button>
          </nav>
        </header>
        <main class="ar-main">
          ${renderSourceLink(session)}
          ${renderGuide(session)}
          ${steps || `<div class="ar-empty">点击“开始录制”后，这里会出现截图和批注。</div>`}
        </main>
        <footer class="ar-footer">
          <div class="ar-record-actions">
            ${isRecording ? `<button class="ar-primary ar-stop" data-action="stop">停止录制</button>` : `<button class="ar-primary" data-action="start" ${canRecord ? "" : "disabled"}>开始录制</button>`}
          </div>
          <div class="ar-export-actions">
            <button data-action="export-pdf" ${session.steps.length ? "" : "disabled"}>PDF</button>
            <button data-action="export-word" ${session.steps.length ? "" : "disabled"}>Word</button>
            <button data-action="export-json" ${session.steps.length ? "" : "disabled"}>备份</button>
            <button data-action="demo" ${session.steps.length ? "" : "disabled"}>演示</button>
            <button class="ar-danger-ghost" data-action="clear" ${session.steps.length ? "" : "disabled"}>清空</button>
          </div>
        </footer>
      </section>
    `;
  }

  function renderStep(step, index) {
    const marker = step.isSensitive ? `<span class="ar-mask">已脱敏</span>` : "";
    const summary = renderStepHighlight(step);
    return `
      <article class="ar-step" data-step-id="${escapeHtml(step.id)}">
        <div class="ar-step-cover">
          <img src="${step.screenshotDataUrl}" alt="步骤 ${index + 1} 截图">
        </div>
        <div class="ar-step-body">
          <div class="ar-step-meta">
            <span class="ar-step-index">${String(index + 1).padStart(2, "0")}</span>
            <span class="ar-type ar-type-${escapeHtml(step.type)}">${typeLabel(step.type)}</span>
            ${marker}
          </div>
          ${summary}
          <textarea data-step-note="${escapeHtml(step.id)}">${escapeHtml(step.annotation || "")}</textarea>
          <div class="ar-step-actions">
            <button data-action="up" data-step-id="${escapeHtml(step.id)}" ${index === 0 ? "disabled" : ""}>上移</button>
            <button data-action="down" data-step-id="${escapeHtml(step.id)}" ${index === state.session.steps.length - 1 ? "disabled" : ""}>下移</button>
            <button data-action="recapture" data-step-id="${escapeHtml(step.id)}">重截屏幕</button>
            <button data-action="delete" data-step-id="${escapeHtml(step.id)}">删除</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderGuide(session) {
    const shouldShow = !localStorage.getItem("actionRecorderGuideDismissed") || session.steps.length === 0;
    if (!shouldShow) return "";
    return `
      <section class="ar-guide">
        <div class="ar-guide-head">
          <strong>快速教程</strong>
          <button data-action="dismiss-guide" title="关闭教程">×</button>
        </div>
        <ol>
          <li><b>点击插件图标</b>：只打开右侧缓存区，还不会记录。</li>
          <li><b>开始录制</b>：先生成一张当前屏幕截图。</li>
          <li><b>点击页面</b>：会立刻截取当前屏幕，并在点击位置画红圈。</li>
          <li><b>输入文字</b>：输入完成后按 <kbd>Tab</kbd>，或鼠标点到别处，才会截屏。</li>
          <li><b>演示</b>：按步骤在页面上标出点击位置和输入框。</li>
          <li><b>导出</b>：可保存 PDF、Word，或先点“备份”保存 JSON。</li>
        </ol>
      </section>
    `;
  }

  function renderSourceLink(session) {
    const url = session.url || location.href;
    return `
      <section class="ar-source">
        <span>保存链接</span>
        <a href="${escapeHtml(url)}" target="_blank" title="${escapeHtml(url)}">${escapeHtml(url)}</a>
      </section>
    `;
  }

  function renderStepHighlight(step) {
    const parsed = parseAnnotation(step);
    if (!parsed.value) return "";
    return `
      <div class="ar-highlight ar-highlight-${escapeHtml(step.type)}">
        <span>${escapeHtml(parsed.label)}</span>
        <strong>${escapeHtml(parsed.value)}</strong>
      </div>
    `;
  }

  function bindPanelEvents() {
    const root = state.shadow;
    root.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePanelAction(button.dataset.action, button.dataset.stepId);
      });
    });
    root.querySelectorAll("textarea[data-step-note]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const step = findStep(textarea.dataset.stepNote);
        if (step) {
          step.annotation = textarea.value;
          saveSession();
        }
      });
    });
    const header = root.querySelector("[data-drag-handle]");
    if (header) header.addEventListener("pointerdown", startDrag);
    const resize = root.querySelector(".ar-resize");
    if (resize) resize.addEventListener("pointerdown", startResize);
  }

  async function handlePanelAction(action, stepId) {
    if (action === "expand") {
      state.panel.collapsed = false;
      render();
    } else if (action === "collapse") {
      state.panel.collapsed = true;
      render();
    } else if (action === "close") {
      state.host.style.display = "none";
    } else if (action === "help") {
      localStorage.removeItem("actionRecorderGuideDismissed");
      render();
    } else if (action === "dismiss-guide") {
      localStorage.setItem("actionRecorderGuideDismissed", "1");
      render();
    } else if (action === "snap") {
      state.panel.x = null;
      state.panel.y = 18;
      render();
    } else if (action === "start") {
      await startRecording();
    } else if (action === "stop") {
      state.session.status = "stopped";
      state.session.updatedAt = nowIso();
      await saveSession();
      render();
    } else if (action === "clear") {
      state.session = createSession();
      await chrome.runtime.sendMessage({ type: MESSAGE.CLEAR_SESSION });
      render();
    } else if (action === "export-pdf") {
      await exportDocument("pdf");
    } else if (action === "export-word") {
      await exportDocument("word");
    } else if (action === "export-json") {
      downloadJson();
    } else if (action === "demo") {
      await startDemo();
    } else if (action === "delete") {
      state.session.steps = state.session.steps.filter((step) => step.id !== stepId);
      reindexSteps();
      await saveSession();
      render();
    } else if (action === "up" || action === "down") {
      moveStep(stepId, action === "up" ? -1 : 1);
      await saveSession();
      render();
    } else if (action === "recapture") {
      await recaptureStepViewport(stepId);
    }
  }

  async function startRecording() {
    state.session.status = "recording";
    state.session.url = location.href;
    state.session.title = document.title;
    state.session.updatedAt = nowIso();
    render();
    const screenshotDataUrl = await captureViewport();
    addStep({
      type: "baseline",
      annotation: "开始录制时的当前屏幕截图",
      captureMode: "viewport",
      screenshotDataUrl
    });
    await saveSession();
    render();
  }

  async function loadStoredSession() {
    if (state.loadedStoredSession) return;
    state.loadedStoredSession = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.LOAD_SESSION });
      if (!response?.ok) return;
      const stored = Object.values(response.result || {})[0];
      if (!stored || !Array.isArray(stored.steps)) return;
      state.session = stored;
      if (stored.panelState) {
        state.panel = { ...state.panel, ...stored.panelState };
      }
      if (state.session.status === "recording") {
        state.session.status = "stopped";
      }
    } catch (error) {
      console.warn("Action Recorder could not load stored session", error);
    }
  }

  async function handleDocumentClick(event) {
    if (state.capturing || state.session.status !== "recording") return;
    if (isInsidePanel(event)) return;
    const target = event.target;
    const marker = { x: event.clientX, y: event.clientY };
    const annotation = buildClickAnnotation(target);
    const screenshotDataUrl = await captureViewport({ marker });
    addStep({
      type: "click",
      annotation,
      captureMode: "viewport",
      targetSummary: annotation,
      targetSelector: getStableSelector(target),
      marker,
      screenshotDataUrl
    });
    await saveSession();
    render();
  }

  function handleFocusIn(event) {
    if (!isEditableElement(event.target)) return;
    state.activeInput = event.target;
    state.inputInitialValue = getElementValue(event.target);
  }

  async function handleFocusOut(event) {
    if (state.suppressNextBlur) {
      state.suppressNextBlur = false;
      return;
    }
    await maybeRecordInput(event.target);
  }

  async function handleKeyDown(event) {
    if (event.key !== "Tab" || state.session.status !== "recording") return;
    if (!isEditableElement(event.target)) return;
    state.suppressNextBlur = true;
    await maybeRecordInput(event.target);
  }

  async function maybeRecordInput(element) {
    if (state.capturing || state.session.status !== "recording") return;
    if (!isEditableElement(element)) return;
    const current = getElementValue(element);
    if (current === state.inputInitialValue) return;
    const isSensitive = isSensitiveInput(element);
    const screenshotDataUrl = await captureViewport();
    addStep({
      type: "input",
      annotation: buildInputAnnotation(element, current),
      captureMode: "viewport",
      targetSelector: getStableSelector(element),
      isSensitive,
      screenshotDataUrl
    });
    state.inputInitialValue = current;
    await saveSession();
    render();
  }

  function addStep(partial) {
    const step = {
      id: createId("step"),
      index: state.session.steps.length,
      timestamp: nowIso(),
      url: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      scrollPosition: { x: window.scrollX, y: window.scrollY },
      targetSummary: "",
      targetSelector: "",
      annotation: "",
      isSensitive: false,
      captureMode: "viewport",
      screenshotDataUrl: "",
      screenshotId: null,
      screenshotDirty: Boolean(partial.screenshotDataUrl),
      ...partial
    };
    state.session.steps.push(step);
    state.session.updatedAt = nowIso();
  }

  async function captureViewport(options = {}) {
    state.capturing = true;
    const previousDisplay = state.host?.style.display;
    try {
      if (state.host) state.host.style.display = "none";
      await nextFrame();
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.CAPTURE_VISIBLE });
      if (!response?.ok) throw new Error(response?.error || "截图失败");
      const dataUrl = response.result.dataUrl;
      if (options.marker) return annotateClick(dataUrl, options.marker);
      return compressImageDataUrl(dataUrl);
    } finally {
      if (state.host) state.host.style.display = previousDisplay || "";
      state.capturing = false;
    }
  }

  async function annotateClick(dataUrl, marker) {
    const image = await loadImage(dataUrl);
    const scaleX = image.width / window.innerWidth;
    const scaleY = image.height / window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const x = marker.x * scaleX;
    const y = marker.y * scaleY;
    const radius = Math.max(18, Math.round(16 * Math.max(scaleX, scaleY)));
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(5, Math.round(4 * Math.max(scaleX, scaleY)));
    ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return compressImageDataUrl(canvas.toDataURL("image/png"));
  }

  async function recaptureStepViewport(stepId) {
    const step = findStep(stepId);
    if (!step) return;
    step.annotation = `${step.annotation}（已重截当前屏幕）`;
    step.captureMode = "viewport";
    step.screenshotDataUrl = await captureViewport({ marker: step.marker });
    step.screenshotDirty = true;
    step.scrollPosition = { x: window.scrollX, y: window.scrollY };
    await saveSession();
    render();
  }

  async function exportDocument(format) {
    state.session.status = "exporting";
    render();
    if (format === "word") {
      downloadWord();
    } else {
      openPdfPreview();
    }
    await saveSession();
    state.session.status = "stopped";
    await saveSession();
    render();
  }

  async function saveSession() {
    state.session.panelState = { ...state.panel };
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.SAVE_SESSION,
        session: makeSessionForPersistence()
      });
      if (response?.ok && response.result?.session) {
        mergePersistedScreenshotIds(response.result.session);
      }
    } catch (error) {
      console.warn("Action Recorder could not persist the full session. Use Word or backup export before refreshing.", error);
    }
  }

  function makeSessionForPersistence() {
    const cloned = cloneSessionForStorage(state.session);
    cloned.steps = cloned.steps.map((step) => {
      if (step.screenshotDirty || !step.screenshotId) return step;
      const { screenshotDataUrl, ...metadata } = step;
      return metadata;
    });
    return cloned;
  }

  function mergePersistedScreenshotIds(persistedSession) {
    for (const persistedStep of persistedSession.steps || []) {
      const currentStep = findStep(persistedStep.id);
      if (!currentStep) continue;
      currentStep.screenshotId = persistedStep.screenshotId || currentStep.screenshotId;
      currentStep.screenshotDirty = false;
    }
  }

  async function compressImageDataUrl(dataUrl, maxWidth = 2200, quality = 0.9) {
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, maxWidth / image.width);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function openPdfPreview() {
    const html = buildExportHtml("pdf");
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function downloadWord() {
    const html = buildExportHtml("word");
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    downloadBlob(blob, `${safeFileName(state.session.title || "操作记录")}.doc`);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(cloneSessionForStorage(state.session), null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `${safeFileName(state.session.title || "操作记录")}.json`);
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

  function renderExportStep(step, index) {
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

  function buildExportHtml(mode) {
    const printTools = mode === "pdf" ? `
      <div class="tools">
        <button onclick="window.print()">打印 / 保存为 PDF</button>
        <span>打印窗口里选择“另存为 PDF / Save as PDF”。</span>
      </div>
    ` : "";
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(state.session.title || "操作记录")}</title>
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
  ${printTools}
  <main>
    <section class="summary">
      <h1>${escapeHtml(state.session.title || "操作记录")}</h1>
      <div class="meta">${escapeHtml(new Date(state.session.createdAt).toLocaleString())} · ${state.session.steps.length} 个步骤 · ${escapeHtml(state.session.url || "")}</div>
    </section>
    ${state.session.steps.map(renderExportStep).join("")}
  </main>
</body>
</html>`;
  }

  function safeFileName(value) {
    return String(value || "操作记录").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "操作记录";
  }

  async function startDemo() {
    if (!state.session.steps.length) return;
    if (state.session.status === "recording") {
      state.session.status = "stopped";
      await saveSession();
    }
    state.panel.collapsed = true;
    render();
    if (state.session.url && state.session.url !== location.href) {
      const shouldContinue = confirm(`这份记录来自另一个链接：\n${state.session.url}\n\n是否仍在当前页面演示？`);
      if (!shouldContinue) return;
    }
    state.demo.active = true;
    state.demo.index = 0;
    ensureDemoHost();
    await renderDemo();
  }

  function ensureDemoHost() {
    if (state.demoHost && state.demoShadow) return;
    const host = document.createElement("div");
    host.id = "action-recorder-demo-host";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483646";
    host.style.pointerEvents = "none";
    document.documentElement.appendChild(host);
    state.demoHost = host;
    state.demoShadow = host.attachShadow({ mode: "open" });
  }

  async function renderDemo() {
    if (!state.demo.active || !state.demoShadow) return;
    const steps = state.session.steps;
    const step = steps[state.demo.index];
    if (!step) {
      stopDemo();
      return;
    }
    const target = await locateDemoTarget(step);
    const card = getDemoCardPosition(target.rect);
    const parsed = parseAnnotation(step);
    state.demoShadow.innerHTML = `
      <style>${demoStyles()}</style>
      ${target.rect ? `<div class="${step.type === "input" ? "demo-box" : "demo-ring"}" style="left:${target.rect.left}px;top:${target.rect.top}px;width:${target.rect.width}px;height:${target.rect.height}px"></div>` : ""}
      <section class="demo-card" style="left:${card.left}px;top:${card.top}px">
        <div class="demo-kicker">演示 ${state.demo.index + 1} / ${steps.length}</div>
        <h2>${escapeHtml(typeLabel(step.type))}</h2>
        ${parsed.value ? `<div class="demo-highlight"><span>${escapeHtml(parsed.label)}</span><strong>${escapeHtml(parsed.value)}</strong></div>` : ""}
        <p>${escapeHtml(getDemoInstruction(step, target.found))}</p>
        ${state.session.url ? `<a href="${escapeHtml(state.session.url)}" target="_blank" rel="noreferrer">打开保存链接</a>` : ""}
        <div class="demo-actions">
          <button data-demo-action="prev" ${state.demo.index === 0 ? "disabled" : ""}>上一步</button>
          <button class="primary" data-demo-action="next">${state.demo.index === steps.length - 1 ? "完成" : "下一步"}</button>
          <button data-demo-action="stop">结束</button>
        </div>
      </section>
    `;
    bindDemoEvents();
  }

  function bindDemoEvents() {
    state.demoShadow.querySelectorAll("button[data-demo-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const action = button.dataset.demoAction;
        if (action === "stop") {
          stopDemo();
        } else if (action === "prev") {
          state.demo.index = Math.max(0, state.demo.index - 1);
          await renderDemo();
        } else if (action === "next") {
          if (state.demo.index >= state.session.steps.length - 1) {
            stopDemo();
          } else {
            state.demo.index += 1;
            await renderDemo();
          }
        }
      });
    });
  }

  function stopDemo() {
    state.demo.active = false;
    state.demo.index = 0;
    if (state.demoHost) {
      state.demoHost.remove();
      state.demoHost = null;
      state.demoShadow = null;
    }
  }

  async function locateDemoTarget(step) {
    const element = step.targetSelector ? document.querySelector(step.targetSelector) : null;
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      await wait(320);
      if (step.type === "input" && typeof element.focus === "function") {
        element.focus({ preventScroll: true });
      }
      const rect = element.getBoundingClientRect();
      return {
        found: true,
        rect: inflateRect(rect, step.type === "input" ? 8 : 14)
      };
    }
    if (step.marker && step.scrollPosition) {
      const x = step.marker.x + (step.scrollPosition.x || 0);
      const y = step.marker.y + (step.scrollPosition.y || 0);
      window.scrollTo({ top: Math.max(0, y - window.innerHeight / 2), left: Math.max(0, x - window.innerWidth / 2), behavior: "smooth" });
      await wait(320);
      return {
        found: false,
        rect: {
          left: x - window.scrollX - 28,
          top: y - window.scrollY - 28,
          width: 56,
          height: 56
        }
      };
    }
    return { found: false, rect: null };
  }

  function inflateRect(rect, padding) {
    return {
      left: Math.max(8, rect.left - padding),
      top: Math.max(8, rect.top - padding),
      width: Math.max(36, rect.width + padding * 2),
      height: Math.max(36, rect.height + padding * 2)
    };
  }

  function getDemoCardPosition(rect) {
    const width = 320;
    const height = 230;
    if (!rect) {
      return { left: Math.max(18, window.innerWidth - width - 24), top: 72 };
    }
    const preferRight = rect.left + rect.width + width + 24 < window.innerWidth;
    const left = preferRight ? rect.left + rect.width + 18 : Math.max(18, rect.left - width - 18);
    const top = Math.max(18, Math.min(window.innerHeight - height - 18, rect.top));
    return { left, top };
  }

  function getDemoInstruction(step, found) {
    if (step.type === "click") return found ? "请点击红圈高亮的位置，然后点击下一步继续。" : "未找到原始元素，已按录制时的位置标记，请参考红圈操作。";
    if (step.type === "input") return found ? "请在蓝色高亮输入框中输入内容；输入完成后按 Tab 或点到别处。" : "未找到原始输入框，请参考提示内容完成输入。";
    return "这是录制开始时的当前屏幕，确认页面状态后点击下一步。";
  }

  function getStableSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || isInsidePanel({ composedPath: () => [element] })) return "";
    const id = element.getAttribute("id");
    if (id) return `#${CSS.escape(id)}`;
    const attrs = ["data-testid", "data-test", "name", "aria-label", "placeholder", "title"];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const selector = `${element.tagName.toLowerCase()}[${attr}="${cssAttrEscape(value)}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const className = [...current.classList].find(Boolean);
      if (className) part += `.${CSS.escape(className)}`;
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (document.querySelectorAll(selector).length === 1) return selector;
      current = parent;
    }
    return parts.join(" > ");
  }

  function cssAttrEscape(value) {
    return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  }

  function moveStep(stepId, offset) {
    const from = state.session.steps.findIndex((step) => step.id === stepId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= state.session.steps.length) return;
    const [step] = state.session.steps.splice(from, 1);
    state.session.steps.splice(to, 0, step);
    reindexSteps();
  }

  function reindexSteps() {
    state.session.steps.forEach((step, index) => {
      step.index = index;
    });
  }

  function findStep(stepId) {
    return state.session.steps.find((step) => step.id === stepId);
  }

  function isInsidePanel(event) {
    const path = event.composedPath();
    return path.includes(state.host) || (state.demoHost && path.includes(state.demoHost));
  }

  function startDrag(event) {
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const rect = state.host.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    const move = (moveEvent) => {
      state.panel.x = Math.max(8, Math.min(window.innerWidth - state.panel.width - 8, origin.x + moveEvent.clientX - start.x));
      state.panel.y = Math.max(8, Math.min(window.innerHeight - 120, origin.y + moveEvent.clientY - start.y));
      applyPanelPosition();
    };
    const up = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      saveSession();
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
  }

  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.panel.width;
    const move = (moveEvent) => {
      state.panel.width = Math.max(300, Math.min(560, startWidth + startX - moveEvent.clientX));
      applyPanelPosition();
    };
    const up = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      saveSession();
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
  }

  function applyPanelPosition() {
    if (!state.host) return;
    state.host.style.width = state.panel.collapsed ? "96px" : `${state.panel.width}px`;
    state.host.style.height = state.panel.collapsed ? "42px" : "min(720px, calc(100vh - 36px))";
    state.host.style.top = `${state.panel.y}px`;
    if (state.panel.x === null) {
      state.host.style.left = "";
      state.host.style.right = "18px";
    } else {
      state.host.style.right = "";
      state.host.style.left = `${state.panel.x}px`;
    }
  }

  function panelStyles() {
    return `
      * { box-sizing: border-box; }
      button, textarea { font: inherit; }
      .ar-panel { position: relative; height: 100%; color: #182230; background: #f6f7fb; border: 1px solid rgba(17,24,39,.12); border-radius: 10px; box-shadow: 0 24px 70px rgba(15,23,42,.22); display: grid; grid-template-rows: 62px 1fr auto; overflow: hidden; }
      .ar-header { background: linear-gradient(135deg, #111827, #243044); color: #fff; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; justify-content: space-between; padding: 0 14px; cursor: move; user-select: none; }
      .ar-header strong { display: block; font-size: 14px; letter-spacing: .01em; }
      .ar-header span { display: block; color: #cbd5e1; font-size: 12px; margin-top: 3px; }
      .ar-header nav { display: flex; gap: 6px; }
      .ar-header button { color: #e2e8f0; background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); }
      button { border: 1px solid #d0d5dd; background: #fff; color: #344054; border-radius: 7px; height: 30px; padding: 0 9px; cursor: pointer; }
      button:disabled { opacity: .45; cursor: not-allowed; }
      .ar-primary { color: #fff; background: #2563eb; border-color: #2563eb; font-weight: 700; box-shadow: 0 8px 18px rgba(37,99,235,.22); }
      .ar-stop { background: #dc2626; border-color: #dc2626; box-shadow: 0 8px 18px rgba(220,38,38,.2); }
      .ar-main { overflow: auto; padding: 12px; }
      .ar-empty { border: 1px dashed #b8c2d2; border-radius: 9px; padding: 16px; color: #667085; line-height: 1.5; background: #fff; }
      .ar-source { display: grid; gap: 4px; border: 1px solid #e3e8ef; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; background: #fff; }
      .ar-source span { color: #667085; font-size: 11px; font-weight: 700; }
      .ar-source a { color: #2563eb; font-size: 12px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
      .ar-guide { border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px; margin-bottom: 12px; background: linear-gradient(135deg, #eff6ff, #f8fafc); color: #1e3a8a; }
      .ar-guide-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .ar-guide-head strong { font-size: 13px; }
      .ar-guide-head button { width: 24px; height: 24px; padding: 0; color: #1e3a8a; background: rgba(255,255,255,.7); border-color: #bfdbfe; }
      .ar-guide ol { margin: 0; padding-left: 18px; }
      .ar-guide li { margin: 6px 0; line-height: 1.45; font-size: 12px; }
      .ar-guide kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border: 1px solid #93c5fd; border-bottom-width: 2px; border-radius: 4px; background: #fff; color: #1d4ed8; font-size: 11px; font-weight: 700; }
      .ar-step { display: grid; grid-template-columns: 124px 1fr; gap: 12px; padding: 10px; border: 1px solid #e3e8ef; border-radius: 10px; background: #fff; margin-bottom: 12px; box-shadow: 0 10px 24px rgba(15,23,42,.06); }
      .ar-step-cover { position: relative; }
      .ar-step img { width: 124px; height: 92px; object-fit: cover; border-radius: 8px; border: 1px solid #d8e0ea; background: #edf2f7; display: block; }
      .ar-step-body { min-width: 0; }
      .ar-step-meta { display: flex; align-items: center; gap: 6px; color: #667085; font-size: 12px; margin-bottom: 7px; }
      .ar-step-index { min-width: 28px; height: 22px; display: inline-grid; place-items: center; border-radius: 999px; background: #111827; color: #fff; font-weight: 700; font-size: 11px; }
      .ar-type { height: 22px; display: inline-flex; align-items: center; border-radius: 999px; padding: 0 8px; font-weight: 700; font-size: 11px; }
      .ar-type-click { background: #fee2e2; color: #b42318; }
      .ar-type-input { background: #dbeafe; color: #1d4ed8; }
      .ar-type-baseline { background: #ecfdf3; color: #047857; }
      .ar-mask { margin-left: auto; color: #b42318; background: #fee4e2; border-radius: 999px; padding: 2px 7px; white-space: nowrap; font-weight: 700; }
      .ar-highlight { border-radius: 8px; padding: 8px 9px; margin-bottom: 8px; border: 1px solid #d8e0ea; background: #f8fafc; }
      .ar-highlight span { display: block; color: #667085; font-size: 11px; margin-bottom: 3px; }
      .ar-highlight strong { display: block; color: #101828; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
      .ar-highlight-input { border-color: #bfdbfe; background: #eff6ff; }
      .ar-highlight-click { border-color: #fecaca; background: #fff1f2; }
      textarea { width: 100%; min-height: 58px; resize: vertical; border: 1px solid #d0d5dd; border-radius: 8px; padding: 8px; color: #273246; line-height: 1.4; background: #fff; }
      textarea:focus { outline: 2px solid rgba(37,99,235,.16); border-color: #2563eb; }
      .ar-step-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
      .ar-step-actions button { height: 26px; font-size: 12px; padding: 0 7px; color: #475467; background: #f8fafc; }
      .ar-footer { display: grid; gap: 8px; padding: 10px 12px; background: #fff; border-top: 1px solid #e2e8f0; }
      .ar-record-actions { display: grid; }
      .ar-export-actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
      .ar-export-actions button { padding: 0 6px; font-size: 12px; }
      .ar-danger-ghost { color: #b42318; background: #fff; border-color: #fecaca; }
      .ar-resize { position: absolute; left: -6px; top: 0; width: 12px; height: 100%; cursor: ew-resize; z-index: 2; border-left: 2px dashed rgba(37,99,235,.4); }
      .ar-fab { width: 96px; height: 42px; color: #fff; background: #2563eb; border-color: #2563eb; box-shadow: 0 10px 28px rgba(37,99,235,.28); }
    `;
  }

  function demoStyles() {
    return `
      * { box-sizing: border-box; }
      .demo-ring { position: fixed; border: 4px solid #ef4444; border-radius: 999px; background: rgba(239,68,68,.12); box-shadow: 0 0 0 9999px rgba(15,23,42,.18), 0 0 0 8px rgba(239,68,68,.12); pointer-events: none; transition: all .18s ease; }
      .demo-box { position: fixed; border: 4px solid #2563eb; border-radius: 10px; background: rgba(37,99,235,.10); box-shadow: 0 0 0 9999px rgba(15,23,42,.18), 0 0 0 8px rgba(37,99,235,.12); pointer-events: none; transition: all .18s ease; }
      .demo-card { position: fixed; width: 320px; padding: 16px; border-radius: 12px; background: #fff; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 24px 70px rgba(15,23,42,.28); border: 1px solid #e3e8ef; pointer-events: auto; }
      .demo-kicker { color: #667085; font-size: 12px; font-weight: 800; margin-bottom: 6px; }
      .demo-card h2 { margin: 0 0 10px; font-size: 18px; }
      .demo-card p { margin: 10px 0; color: #475467; line-height: 1.55; font-size: 13px; }
      .demo-card a { display: block; color: #2563eb; font-size: 12px; margin: 8px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .demo-highlight { border: 1px solid #d8e0ea; border-radius: 10px; padding: 10px 12px; background: #f8fafc; }
      .demo-highlight span { display: block; color: #667085; font-size: 12px; margin-bottom: 4px; }
      .demo-highlight strong { display: block; color: #101828; line-height: 1.45; overflow-wrap: anywhere; }
      .demo-actions { display: flex; gap: 8px; margin-top: 14px; }
      .demo-actions button { height: 32px; border: 1px solid #d0d5dd; border-radius: 7px; background: #fff; color: #344054; padding: 0 10px; font: inherit; cursor: pointer; }
      .demo-actions button:disabled { opacity: .45; cursor: not-allowed; }
      .demo-actions .primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 800; }
    `;
  }

  function statusLabel(status) {
    return { ready: "待开始", recording: "录制中", stopped: "已停止", exporting: "导出中" }[status] || status;
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

})();
