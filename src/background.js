import { MESSAGE, createId, exportKey, sessionKey } from "./shared.js";

const DB_NAME = "action-recorder-db";
const DB_VERSION = 1;
const SCREENSHOT_STORE = "screenshots";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !isInjectableUrl(tab.url)) return;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["src/content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content.js"]
    });
    await sendMessageWithRetry(tab.id, { type: MESSAGE.TOGGLE_PANEL });
  } catch (error) {
    console.error("Action Recorder injection failed", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error("Action Recorder message failed", message?.type, error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  if (!message || !message.type) throw new Error("Missing message type");
  const tabId = sender.tab?.id ?? message.tabId;
  switch (message.type) {
    case MESSAGE.CAPTURE_VISIBLE:
      return captureVisible(sender.tab);
    case MESSAGE.SAVE_SESSION:
      if (!tabId) throw new Error("Missing tab id for session save");
      return saveSession(tabId, message.session);
    case MESSAGE.LOAD_SESSION:
      if (!tabId) throw new Error("Missing tab id for session load");
      return loadSession(tabId);
    case MESSAGE.LOAD_ALL_SESSIONS:
      return loadAllSessions();
    case MESSAGE.CLEAR_SESSION:
      if (!tabId) throw new Error("Missing tab id for session clear");
      await chrome.storage.local.remove(sessionKey(tabId));
      return { cleared: true };
    case MESSAGE.OPEN_EXPORT:
      return openExport(message.session, message.format);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function captureVisible(tab) {
  if (!tab?.windowId) throw new Error("Missing active tab for capture");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { dataUrl };
}

async function openExport(session, format = "pdf") {
  if (!session || !Array.isArray(session.steps)) throw new Error("Missing session data for export");
  const id = createId("export");
  await chrome.storage.local.set({ [exportKey(id)]: session });
  const url = chrome.runtime.getURL(`src/export.html?exportId=${encodeURIComponent(id)}&format=${encodeURIComponent(format)}`);
  const tab = await chrome.tabs.create({ url });
  return { exportId: id, tabId: tab.id };
}

async function saveSession(tabId, session) {
  if (!session || !Array.isArray(session.steps)) throw new Error("Missing session data");
  const metadata = structuredClone(session);
  for (const step of metadata.steps) {
    if (step.screenshotDataUrl) {
      const screenshotId = step.screenshotId || createId("shot");
      const blob = await dataUrlToBlob(step.screenshotDataUrl);
      await putScreenshot({
        id: screenshotId,
        sessionId: metadata.id,
        stepId: step.id,
        blob,
        updatedAt: Date.now()
      });
      step.screenshotId = screenshotId;
    }
    delete step.screenshotDataUrl;
    delete step.screenshotDirty;
  }
  await chrome.storage.local.set({ [sessionKey(tabId)]: metadata });
  return { saved: true, session: metadata };
}

async function loadSession(tabId) {
  const key = sessionKey(tabId);
  const result = await chrome.storage.local.get(key);
  if (!result[key]) return result;
  return { [key]: await hydrateSession(result[key]) };
}

async function loadAllSessions() {
  const all = await chrome.storage.local.get(null);
  const hydrated = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("actionRecorderSession:") && value && Array.isArray(value.steps)) {
      hydrated[key] = await hydrateSession(value);
    }
  }
  return hydrated;
}

async function hydrateSession(session) {
  const hydrated = structuredClone(session);
  for (const step of hydrated.steps) {
    if (!step.screenshotDataUrl && step.screenshotId) {
      const record = await getScreenshot(step.screenshotId);
      if (record?.blob) {
        step.screenshotDataUrl = await blobToDataUrl(record.blob);
      }
    }
    step.screenshotDirty = false;
  }
  return hydrated;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        const store = db.createObjectStore(SCREENSHOT_STORE, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, mode);
    const store = tx.objectStore(SCREENSHOT_STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}

function putScreenshot(record) {
  return withStore("readwrite", (store) => store.put(record));
}

function getScreenshot(id) {
  return withStore("readonly", (store) => {
    const request = store.get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

async function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((response) => response.blob());
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

function isInjectableUrl(url) {
  return /^https?:\/\//.test(url) || /^file:\/\//.test(url);
}

async function sendMessageWithRetry(tabId, message) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError;
}
