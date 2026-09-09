export const MESSAGE = {
  TOGGLE_PANEL: "ACTION_RECORDER_TOGGLE_PANEL",
  CAPTURE_VISIBLE: "ACTION_RECORDER_CAPTURE_VISIBLE",
  SAVE_SESSION: "ACTION_RECORDER_SAVE_SESSION",
  LOAD_SESSION: "ACTION_RECORDER_LOAD_SESSION",
  LOAD_ALL_SESSIONS: "ACTION_RECORDER_LOAD_ALL_SESSIONS",
  CLEAR_SESSION: "ACTION_RECORDER_CLEAR_SESSION",
  OPEN_EXPORT: "ACTION_RECORDER_OPEN_EXPORT"
};

const SENSITIVE_PATTERN = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "验证码",
  "校验码",
  "动态码",
  "短信码",
  "密码",
  "身份证",
  "证件",
  "银行卡",
  "卡号",
  "手机号",
  "手机",
  "电话",
  "phone",
  "mobile",
  "tel",
  "idcard",
  "identity",
  "bank",
  "card",
  "otp",
  "code",
  "verification"
];

export function createId(prefix = "id") {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function sessionKey(tabId) {
  return `actionRecorderSession:${tabId}`;
}

export function exportKey(exportId) {
  return `actionRecorderExport:${exportId}`;
}

export function isEditableElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "file", "image", "range", "color", "hidden"].includes(type);
  }
  return element.isContentEditable;
}

function getAssociatedLabelText(element) {
  const parts = [];
  if (element.labels) {
    for (const label of element.labels) parts.push(label.textContent || "");
  }
  const id = element.getAttribute("id");
  if (id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (explicit) parts.push(explicit.textContent || "");
  }
  const parentLabel = element.closest("label");
  if (parentLabel) parts.push(parentLabel.textContent || "");
  return parts.join(" ");
}

export function isSensitiveInput(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") || "").toLowerCase();
  if (tag === "input" && type === "password") return true;
  const haystack = [
    type,
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    getAssociatedLabelText(element)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return SENSITIVE_PATTERN.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

export function summarizeElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return "page position";
  const tag = element.tagName.toLowerCase();
  const text = (element.innerText || element.value || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || "").trim();
  const compact = text.replace(/\s+/g, " ").slice(0, 60);
  if (compact) return `${tag}: ${compact}`;
  const id = element.getAttribute("id");
  if (id) return `${tag}#${id}`;
  const name = element.getAttribute("name");
  if (name) return `${tag}[name="${name}"]`;
  return tag;
}

export function buildClickAnnotation(element) {
  return `点击了 ${summarizeElement(element)}`;
}

export function getElementValue(element) {
  if (!element) return "";
  if (element.isContentEditable) return element.innerText || "";
  return element.value || "";
}

export function buildInputAnnotation(element, value) {
  if (isSensitiveInput(element)) return "输入了敏感内容：******";
  const text = String(value || "").trim();
  return text ? `输入：${text}` : "输入内容已清空";
}

export function cloneSessionForStorage(session) {
  return JSON.parse(JSON.stringify(session));
}
