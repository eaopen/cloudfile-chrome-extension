const HOST = 'com.cloudfile.local_agent';
const CURRENT_HOST = 'com.cloudfile.current_agent';

// 扩展自身更新清单的静态地址（与 Agent 的 update.json 同目录约定）。
// 地址固定指向门户域名，由该域名上的 nginx 把 /cloudfile-updates/ 反代到实际静态服务；
// 静态服务换 IP/端口时只改 nginx，客户端产物无需重新发版。
// 注意：这条直连路径是「兜底」——它是扩展 service worker 的跨源 fetch，需要 nginx 配
// Access-Control-Allow-Origin，缺这个头会被浏览器拦掉。正常路径是问本地 Agent
// （Go 的 HTTP 客户端不走 CORS），见 refreshUpdates。
const EXTENSION_UPDATE_URL = 'http://etech.stcetech.ad01.sec.com/cloudfile-updates/extension-update.json';

const ALARM_NAME = 'cloudfile-update-check';
// 升级是后台子进程在做，请求返回只代表「已开始」。这个 alarm 负责复核结果。
const VERIFY_ALARM = 'cloudfile-update-verify';
// 启动时 + 每 6 小时检查一次扩展与 Agent 的更新。
const UPDATE_PERIOD_MINUTES = 360;
// 升级后最多复核 5 次（每分钟一次），确认版本是否真的变了。
const VERIFY_ATTEMPTS = 5;
const NOTIFICATION_ID = 'cloudfile-update';
const BADGE_COLOR = '#e8710a';
const HELP_PATH = '/cloudfile-updates/help.html';

async function sendNative(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

// 优先当前 Host，失败再回退旧 Host（与 popup 的既有行为一致）。
async function sendWithHostFallback(message) {
  try {
    const result = await chrome.runtime.sendNativeMessage(CURRENT_HOST, message);
    if (result?.ok) return result;
  } catch {
    // 旧 Host 未注册时回退，不作为错误。
  }
  return sendNative(message);
}

// 向 Agent 询问更新情况：一次就能拿到 Agent 与扩展两侧的版本。
// 版本号只用来「提示」，不做任何拦截。
async function probeAgent() {
  try {
    const result = await sendWithHostFallback({ type: 'check_update' });
    if (result?.ok) return result;
  } catch {
    // Agent 未安装/未注册：下面继续尝试 status，仍失败则放弃。
  }
  try {
    const result = await sendWithHostFallback({ type: 'status' });
    return result?.ok ? result : null;
  } catch {
    return null;
  }
}

// popup 需要的是完整状态（本地目录、可执行文件路径、已装应用），而 check_update
// 是刻意的轻量消息、不带这些字段 —— 所以这里必须直接问 status。
async function probeAgentStatus() {
  try {
    const result = await sendWithHostFallback({ type: 'status' });
    return result?.ok ? result : null;
  } catch {
    return null;
  }
}

// 扩展被 reload / 更新后 alarm 会被清掉（Chrome 只在浏览器重启时保留它们），
// 所以不能只依赖 onInstalled 注册。service worker 每次被唤醒都会走到这里。
ensureAlarm();

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME).then((existing) => {
    if (!existing || existing.periodInMinutes !== UPDATE_PERIOD_MINUTES) {
      chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: UPDATE_PERIOD_MINUTES });
    }
  }).catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshUpdates().catch(() => {});
  if (alarm.name === VERIFY_ALARM) verifyUpgrade().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: UPDATE_PERIOD_MINUTES });
  refreshUpdates().catch(() => {});
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    refreshUpdates().catch(() => {});
  });
}

// 点击系统通知：优先直接弹出扩展面板；不支持时退回帮助页，最后退回扩展管理页。
chrome.notifications.onClicked.addListener((id) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(NOTIFICATION_ID);
  openUpdateTarget();
});

// 一次完整的检测：先问 Agent（能同时拿到 Agent 与扩展两侧的信息，且不走 CORS），
// 拿不到扩展信息时再直连清单兜底。两个来源各自失败互不影响。
async function refreshUpdates() {
  const result = await probeAgent().catch(() => null);
  if (result) {
    await applyProbe(result);
    if (!toExtensionUpdateFromAgent(result)) {
      await checkExtensionUpdateDirect();
    }
  } else {
    await checkExtensionUpdateDirect();
  }
  await syncUpdateIndicators();
}

async function applyProbe(result) {
  await chrome.storage.local.set({ agent_update: toAgentUpdate(result) });
  const extension = toExtensionUpdateFromAgent(result);
  if (extension) {
    await chrome.storage.local.set({ extension_update: extension });
  }
}

function toAgentUpdate(result) {
  return {
    checked_at: Date.now(),
    current_version: result.version || '',
    latest_version: result.latest_version || '',
    notes: result.latest_notes || '',
    has_update: !!result.update_available,
  };
}

// 从 Agent 的应答里取出扩展侧信息。没有（旧 Agent 或未配更新源）时返回 null，
// 由调用方决定是否直连清单兜底。是否有更新由扩展自己按版本号判断。
function toExtensionUpdateFromAgent(result) {
  if (!result.extension_latest_version) return null;
  const current = chrome.runtime.getManifest().version;
  return {
    checked_at: Date.now(),
    current_version: current,
    latest_version: result.extension_latest_version,
    notes: result.extension_notes || '',
    installed_version: result.extension_installed_version || '',
    has_update: versionNewer(result.extension_latest_version, current),
  };
}

// 直连清单的兜底路径。跨源被拦或离线时静默忽略：主路径是经 Agent 查询。
async function checkExtensionUpdateDirect() {
  const current = chrome.runtime.getManifest().version;
  try {
    const response = await fetch(EXTENSION_UPDATE_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    if (!manifest?.version) return;
    await chrome.storage.local.set({
      extension_update: {
        checked_at: Date.now(),
        current_version: current,
        latest_version: manifest.version,
        notes: manifest.notes || '',
        zip_url: manifest.zip_url || '',
        has_update: versionNewer(manifest.version, current),
      },
    });
  } catch {
    // 网络失败或 CORS 被拦：静默，下次 alarm 再试。
  }
}

// 角标 + 系统通知的统一出口。三条规则：
//   1. 有待升级项就亮角标（用户点开 popup 后清除，出现更新版本时自动重新亮起）；
//   2. 系统通知每个新版本只弹一次，扩展与 Agent 合并成一条；
//   3. 只有成功检测到新版本才提示，失败一律静默。
// 更新只是提示：任何版本比较都不会拦下本地功能。
async function syncUpdateIndicators() {
  const { extension_update, agent_update, update_notified } =
    await chrome.storage.local.get(['extension_update', 'agent_update', 'update_notified']);

  await refreshBadge();

  const pending = [];
  if (extension_update?.has_update) {
    pending.push({ kind: 'extension', latest: extension_update.latest_version, manifest: extension_update });
  }
  if (agent_update?.has_update) {
    pending.push({ kind: 'agent', latest: agent_update.latest_version, manifest: agent_update });
  }
  if (!pending.length) return;

  const notified = update_notified || {};
  const fresh = pending.filter((item) => notified[item.kind] !== item.latest);
  if (!fresh.length) return;
  // 先记账再弹：即使通知被系统策略拦掉，也不会每个周期重复尝试打扰。
  await chrome.storage.local.set({
    update_notified: {
      ...notified,
      ...Object.fromEntries(fresh.map((item) => [item.kind, item.latest])),
    },
  });
  await showUpdateNotification(pending);
}

// 角标只反映「有未读的待升级项」。已读记录按版本号比对，所以用户升级后
// 角标自然消失，而下一个新版本出现时会重新亮起。
async function refreshBadge() {
  const { extension_update, agent_update, update_ack } =
    await chrome.storage.local.get(['extension_update', 'agent_update', 'update_ack']);
  const acknowledged = update_ack || {};
  let unseen = 0;
  if (extension_update?.has_update && acknowledged.extension !== extension_update.latest_version) unseen += 1;
  if (agent_update?.has_update && acknowledged.agent !== agent_update.latest_version) unseen += 1;
  await setBadge(unseen);
}

// popup 展示过某个版本后回写：记「已读」以清角标，同时抑制该版本的系统通知，
// 避免「用户正看着 popup 又弹一条通知」。
async function recordSeen(kind, version) {
  if (!kind || !version) return;
  const { update_ack, update_notified } =
    await chrome.storage.local.get(['update_ack', 'update_notified']);
  await chrome.storage.local.set({
    update_ack: { ...(update_ack || {}), [kind]: version },
    update_notified: { ...(update_notified || {}), [kind]: version },
  });
  await refreshBadge();
}

async function setBadge(count) {
  try {
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await chrome.action.setBadgeText({ text: String(count) });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // 角标失败不影响其它提示渠道。
  }
}

async function showUpdateNotification(pending) {
  const lines = pending.map((item) => {
    const label = item.kind === 'agent' ? '本地 Agent' : '扩展';
    const from = item.manifest.current_version ? `v${item.manifest.current_version} → ` : '';
    return `${label}：${from}v${item.latest}`;
  });
  const title = pending.length > 1 ? 'CloudFile 本地组件有新版本' : 'CloudFile 有新版本可用';
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message: `${lines.join('\n')}\n点击打开扩展查看并升级。`,
      priority: 1,
    });
  } catch {
    // 系统通知被策略禁用时静默：角标仍在提示。
  }
}

// 安排一次升级结果复核。请求返回只代表子进程已启动，失败是异步发生的，
// 不复核的话用户只会看到一个永远不消失的角标，却不知道坏在哪。
async function scheduleUpgradeVerify(kind, target) {
  await chrome.storage.local.set({ update_verify: { kind, target, attempts: 0 } });
  chrome.alarms.create(VERIFY_ALARM, { delayInMinutes: 1 });
}

async function verifyUpgrade() {
  const { update_verify } = await chrome.storage.local.get('update_verify');
  if (!update_verify) return;
  const { kind, target, attempts } = update_verify;
  const result = await probeAgent().catch(() => null);
  if (result) {
    await applyProbe(result);
    if (kind === 'agent' && compareVersions(result.version || '', target) >= 0) {
      await chrome.storage.local.remove('update_verify');
      await refreshUpdates();
      return;
    }
    if (kind === 'extension' && compareVersions(result.extension_installed_version || '', target) >= 0) {
      await chrome.storage.local.remove('update_verify');
      // 新文件已经落盘：加载已解压扩展不会自升级，重载一次即可生效。
      try {
        chrome.runtime.reload();
        return;
      } catch {
        // 重载失败则退回下面的提示路径。
      }
    }
  }
  if (attempts + 1 >= VERIFY_ATTEMPTS) {
    await chrome.storage.local.remove('update_verify');
    await reportStalledUpgrade(kind, target);
    return;
  }
  await chrome.storage.local.set({ update_verify: { kind, target, attempts: attempts + 1 } });
  chrome.alarms.create(VERIFY_ALARM, { delayInMinutes: 1 });
}

// 复核到期仍未升上去：明确告诉用户「还没好」，并让该版本重新变得可提醒，
// 否则用户会以为已经升完，而角标一直亮着没解释。
async function reportStalledUpgrade(kind, target) {
  const label = kind === 'agent' ? '本地 Agent' : '扩展';
  const { update_notified } = await chrome.storage.local.get('update_notified');
  const notified = { ...(update_notified || {}) };
  delete notified[kind];
  await chrome.storage.local.set({ update_notified: notified });
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${label}自动升级未完成`,
      message: `目标版本 v${target}。请打开扩展面板重试，或重新运行 register-windows.ps1 安装最新版本。`,
      priority: 2,
    });
  } catch {
    // 通知不可用时不阻塞，角标仍在。
  }
  await refreshBadge();
}

async function openUpdateTarget() {
  try {
    await chrome.action.openPopup();
    return;
  } catch {
    // Chrome 127 之前 openPopup 需要用户手势，回退到帮助页。
  }
  try {
    const { server } = await chrome.storage.local.get('server');
    const origin = originOf(server);
    if (origin) {
      await chrome.tabs.create({ url: origin + HELP_PATH });
      return;
    }
  } catch {
    // 没有会话记录时继续回退。
  }
  chrome.tabs.create({ url: 'chrome://extensions/' });
}

function originOf(rawURL) {
  try {
    return new URL(rawURL).origin;
  } catch {
    return '';
  }
}

function compareVersions(a, b) {
  // 补齐到三段再逐段比较：缺失的段按 0 处理。否则 '' 或 '0.5' 这种短版本号
  // 会因为 undefined 的比较恒为 false 而被误判成「相等」。
  const parse = (value) => {
    const parts = String(value).split('.');
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push(parseInt(parts[i], 10) || 0);
    }
    return out;
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function versionNewer(latest, current) {
  if (!latest) return false;
  return compareVersions(latest, current) > 0;
}

// 网页 → 扩展 → 本地 Agent 的消息通道。
// 安全分层：
//   1. manifest.json 的 externally_connectable.matches 是主闸，Chrome 强制
//      只允许白名单域名调用本监听器；
//   2. Agent 侧 config.allowed_origins 对 descriptor.server 二次校验。
// 因此这里不再重复校验 sender，域名只在一处（manifest）维护。
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  handleExternal(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || 'Agent rejected the request.' }));
  return true;
});

async function handleExternal(message, sender) {
  if (message?.type === 'open_uri') {
    // The v0.3 bridge only accepts a bounded URI from a TLS page. The native
    // host checks canonical syntax and current-user pairing before GUI launch.
    let securePage = false;
    try { securePage = new URL(sender.url).protocol === 'https:'; } catch { /* reject */ }
    if (!securePage || typeof message.uri !== 'string' || message.uri.length > 2048 ||
        !message.uri.startsWith('cloudfile-open://v1/open?')) {
      return { ok: false, error: '本地打开请求无效或页面未使用 HTTPS' };
    }
    return chrome.runtime.sendNativeMessage(CURRENT_HOST, { type: 'open_uri', uri: message.uri });
  }

  if (message?.type === 'query_local_file') {
    // 网页在发起本地编辑前查询本地缓存状态（是否存在 / hash / 大小 / 时间），
    // 用于渲染「覆盖本地 / 保留本地」冲突弹窗。
    // mode 决定查哪个子树（本地查看 view / 本地编辑 edit）；缺省时 Agent 按可编辑子树处理。
    return sendNative({
      type: 'query_local_file',
      repo_id: message.repo_id,
      path: message.path,
      mode: message.mode || '',
    });
  }
  if (message?.type === 'query_local_folder') {
    // 网页在渲染「打开本地目录」入口前问一句：这个资料库的本地目录建了没有。
    // 镜像是一库一个平铺目录，所以「存在」就等于用户在这里做过一次本地编辑。
    return sendNative({
      type: 'query_local_folder',
      repo_id: message.repo_id,
      mode: message.mode || '',
    });
  }
  if (message?.type === 'open_workspace') {
    // 网页请求打开某个库/目录的本地镜像目录，供用户手动上传本地改动。
    return sendNative({
      type: 'open_workspace',
      repo_id: message.repo_id,
      path: message.path || '',
      mode: message.mode || '',
    });
  }
  if (message?.type !== 'open_session') return undefined;
  // 记录最近一次会话的 server，供 popup 的「帮助」按钮拼出帮助页地址。
  if (message.server) {
    chrome.storage.local.set({ server: message.server }).catch(() => {});
  }
  return sendNative({
    type: 'open_session',
    protocol: message.protocol,
    server: message.server,
    ticket: message.ticket,
    expires_at: message.expires_at,
    local_action: message.local_action || '',
  });
}

// 扩展 popup 的查询与操作入口。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleInternal(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || '扩展内部错误' }));
  return true;
});

async function handleInternal(message) {
  if (message?.type === 'agent_status') {
    // popup 每次打开都会问一次完整状态，顺手把两侧的更新状态落库，
    // 让「已读」标记与角标能立刻基于最新版本判断。
    // 注意：这里不能用 check_update（轻量、不带工作区字段），否则 popup 会
    // 因为拿不到 workspace_root 而把整个「本地文件目录」区隐藏掉。
    const result = await probeAgentStatus();
    if (!result?.ok) return { ok: false, error: '本机 Agent 未就绪' };
    await applyProbe(result);
    // 只刷角标、不弹通知：用户正看着 popup，popup 紧接着就会把该版本标记为已读，
    // 这时候再弹系统通知是打扰。
    await refreshBadge();
    return result;
  }
  if (message?.type === 'updates_seen') {
    // popup 已把该版本展示给用户：清角标、并抑制同一版本的系统通知。
    await recordSeen(message.kind, message.version);
    return { ok: true };
  }
  if (message?.type === 'upgrade') {
    return startUpgrade(message.kind);
  }
  if (message?.type === 'open_workspace') {
    return sendNative({ type: 'open_workspace' });
  }
  return undefined;
}

// 一键升级。Agent 侧只改写 native host manifest 的 path、扩展侧只替换落盘文件，
// 都不会覆盖正在运行的代码，所以这里立即返回、由后台复核确认结果。
async function startUpgrade(kind) {
  try {
    if (kind === 'extension') {
      const { extension_update } = await chrome.storage.local.get('extension_update');
      if (!extension_update?.latest_version) {
        return { ok: false, error: '暂时拿不到扩展的更新信息，请稍后再试或重跑 register-windows.ps1。' };
      }
      await sendNative({ type: 'update_extension' });
      await scheduleUpgradeVerify('extension', extension_update.latest_version);
      return { ok: true };
    }
    const { agent_update } = await chrome.storage.local.get('agent_update');
    await sendNative({ type: 'update' });
    await scheduleUpgradeVerify('agent', agent_update?.latest_version || '');
    return { ok: true };
  } catch (error) {
    const reason = error?.message || 'Agent 拒绝了升级请求。';
    // 旧 Agent 的 Valid() 会回 invalid native message：给可执行的替代路径，
    // 而不是把原生报错直接甩给用户。
    if (/invalid native message|unsupported/i.test(reason)) {
      return { ok: false, error: '当前 Agent 版本较旧，不认识一键升级指令。请点下方「安装帮助」，按说明重跑一次注册脚本完成升级。' };
    }
    return { ok: false, error: reason };
  }
}
