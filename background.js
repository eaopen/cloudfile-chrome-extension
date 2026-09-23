const HOST = 'com.cloudfile.local_agent';

// 扩展自身更新清单的静态地址（与 Agent 的 update.json 同目录约定）。
// 该常量默认指向站点静态服务；上线时改这里一处即可。
const EXTENSION_UPDATE_URL = 'http://10.9.8.162:6111/cloudfile-updates/extension-update.json';
const ALARM_NAME = 'extension-update-check';

async function sendNative(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

// 每日检查一次扩展更新清单，结果写入 storage 供 popup 展示。
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkExtensionUpdate().catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 });
  checkExtensionUpdate().catch(() => {});
});

// 兼容：旧版本已注册 alarm 的情况下，确保 alarm 存在（onInstalled 只在安装/更新时触发）。
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.get(ALARM_NAME).then((existing) => {
      if (!existing) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 });
    });
    checkExtensionUpdate().catch(() => {});
  });
}

async function checkExtensionUpdate() {
  const current = chrome.runtime.getManifest().version;
  try {
    const response = await fetch(EXTENSION_UPDATE_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    if (!manifest?.version) return;
    const update = {
      checked_at: Date.now(),
      current_version: current,
      latest_version: manifest.version,
      notes: manifest.notes || '',
      zip_url: manifest.zip_url || '',
      has_update: versionNewer(manifest.version, current),
    };
    await chrome.storage.local.set({ extension_update: update });
  } catch {
    // 网络失败静默忽略，下次 alarm 再试。
  }
}

function versionNewer(latest, current) {
  const parse = (value) => String(value).split('.').map((part) => parseInt(part, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// 网页 → 扩展 → 本地 Agent 的消息通道。
// 安全分层：
//   1. manifest.json 的 externally_connectable.matches 是主闸，Chrome 强制
//      只允许白名单域名调用本监听器；
//   2. Agent 侧 config.allowed_origins 对 descriptor.server 二次校验。
// 因此这里不再重复校验 sender，域名只在一处（manifest）维护。
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'query_local_file') {
    // 网页在发起本地编辑前查询本地缓存状态（是否存在 / hash / 大小 / 时间），
    // 用于渲染「覆盖本地 / 保留本地」冲突弹窗。
    sendNative({
      type: 'query_local_file',
      repo_id: message.repo_id,
      path: message.path,
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: error.message || 'Agent rejected the query.',
    }));
    return true;
  }
  if (message?.type === 'open_workspace') {
    // 网页请求打开某个库/目录的本地镜像目录，供用户手动上传本地改动。
    sendNative({
      type: 'open_workspace',
      repo_id: message.repo_id,
      path: message.path || '',
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: error.message || 'Agent rejected the open.',
    }));
    return true;
  }
  if (message?.type !== 'open_session') return;
  // 记录最近一次会话的 server，供 popup 的「帮助」按钮拼出帮助页地址。
  if (message.server) {
    chrome.storage.local.set({ server: message.server }).catch(() => {});
  }
  const payload = {
    type: 'open_session',
    protocol: message.protocol,
    server: message.server,
    ticket: message.ticket,
    expires_at: message.expires_at,
    local_action: message.local_action || '',
  };
  sendNative(payload).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: error.message || 'Agent rejected the session.',
  }));
  return true;
});

// 扩展 popup 查询 Agent 状态与已检测应用。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'agent_status') {
    sendNative({ type: 'status' }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: error.message,
    }));
    return true;
  }
  if (message?.type === 'open_workspace') {
    sendNative({ type: 'open_workspace' }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: error.message,
    }));
    return true;
  }
  return false;
});
