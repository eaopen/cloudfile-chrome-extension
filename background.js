const AGENT2_HOST = 'com.cloudfile.agent2';
const HOST = 'com.cloudfile.local_agent'; // Legacy Go 1.x
const CURRENT_HOST = 'com.cloudfile.current_agent'; // Windows Agent1/.NET

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

// Windows always uses its fixed controller Host, including future Go controllers.
// macOS/Linux discover Go2 then legacy Go1 before dispatching any action.
async function isWindows() {
  return (await chrome.runtime.getPlatformInfo()).os === 'win';
}
async function sendNative(message) {
  return routeNative(message.type, message);
}
const LEGACY_GO_OPERATIONS = new Set([
  'open_session', 'query_local_file', 'query_local_folder', 'open_workspace',
  'check_update', 'update', 'update_extension',
]);
// First-use device pairing from an already authenticated page. The page keeps
// its own CloudFile session and CSRF token; these messages only relay the
// Agent's enrollment/signature steps, always bound to the real sender origin.
const PAIRING_MESSAGES = new Set(['pair_prepare', 'pair_sign', 'pair_confirm']);
async function readNativeStatus(host) {
  try {
    const status = await chrome.runtime.sendNativeMessage(host, { type: 'status' });
    return status?.ok === true ? status : null;
  } catch { return null; }
}
function supportsAgent2(status, type) {
  return status?.agent_family === 'agent2' &&
    /^2\.[0-9]+\.[0-9]+$/.test(status.version || '') &&
    Array.isArray(status.capabilities) && status.capabilities.includes(type);
}
async function preferredNative(type) {
  if (await isWindows()) {
    const status = await readNativeStatus(CURRENT_HOST);
    return status ? { host: CURRENT_HOST, status, family: status.agent_family || 'agent1' } : null;
  }
  const newer = await readNativeStatus(AGENT2_HOST);
  // An installed Go2 owns all operations; unsupported ones fail on this Host.
  if (newer?.agent_family === 'agent2' && /^2\.[0-9]+\.[0-9]+$/.test(newer.version || ''))
    return { host: AGENT2_HOST, status: newer, family: 'agent2' };
  if (type === 'status' || LEGACY_GO_OPERATIONS.has(type)) {
    const olderGo = await readNativeStatus(HOST);
    if (olderGo) return { host: HOST, status: olderGo, family: 'legacy-go' };
  }
  return null;
}
async function routeNative(type, payload) {
  const selected = await preferredNative(type);
  if (!selected) return { ok: false, error: '本机 Agent 未就绪，请检查当前平台的安装。' };
  if (type === 'status')
    return { ...selected.status, selected_host: selected.host, selected_family: selected.family };
  // V2 file grants are understood only by Rust Agent2. Never pass a new
  // one-time edit credential to the older Windows .NET or macOS Go Host.
  if (type === 'open_uri' && payload.uri.startsWith('cloudfile-open://v2/open?') &&
      !supportsAgent2(selected.status, type))
    return { ok: false, error: 'V2 编辑要求 Rust Agent2；不会回退至旧客户端。' };
  if (selected.host === AGENT2_HOST && !supportsAgent2(selected.status, type) &&
      !['update', 'update_extension'].includes(type))
    return { ok: false, error: '当前平台 Agent 尚未支持此操作。' };
  try {
    const response = await chrome.runtime.sendNativeMessage(selected.host, payload);
    return response ?? { ok: false, error: 'Agent 结果未知，请查询原会话状态。' };
  } catch (error) {
    return { ok: false, error: (error?.message || 'Agent 响应未知') + '；不会跨 Host 自动重试。' };
  }
}
// 向 Agent 询问更新情况：一次就能拿到 Agent 与扩展两侧的版本。
// 版本号只用来「提示」，不做任何拦截。
async function probeAgent() {
  try {
    const result = await sendNative({ type: 'check_update' });
    if (result?.ok) return result;
  } catch {
    // Agent 未安装/未注册：下面继续尝试 status，仍失败则放弃。
  }
  try {
    const result = await sendNative({ type: 'status' });
    return result?.ok ? result : null;
  } catch {
    return null;
  }
}

// popup 需要的是完整状态（本地目录、可执行文件路径、已装应用），而 check_update
// 是刻意的轻量消息、不带这些字段 —— 所以这里必须直接问 status。
async function probeAgentStatus() {
  const result = await routeNative('status', { type: 'status' });
  return result?.ok ? result : null;
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
  const { agent_update: previous } = await chrome.storage.local.get('agent_update');
  // Local status does not fetch the signed release feed. Keep the most recent
  // successful check while updating the installed version after activation.
  const update = result.latest_version ? toAgentUpdate(result) : {
    ...(previous || {}), current_version: result.version || previous?.current_version || '',
    has_update: versionNewer(previous?.latest_version, result.version || previous?.current_version || ''),
  };
  await chrome.storage.local.set({ agent_update: update });
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
    if (result.last_update_state === 'failed' && result.last_update_kind === kind) {
      await chrome.storage.local.remove('update_verify');
      await reportStalledUpgrade(kind, target);
      return;
    }
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
      message: `目标版本 v${target}。请打开扩展面板重试，或按当前平台的安装帮助重新安装。`,
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

// The page already holds the CloudFile session and CSRF token; these helpers
// only relay the Agent's enrollment/signature steps. The deployment path is a
// location inside the sender's own origin, never a second origin.
function validServicePath(path) {
  return typeof path === 'string' && path.length <= 100 &&
    (path === '' || /^(\/[A-Za-z0-9_-]+)+$/.test(path));
}

async function pairNative(message, senderOrigin) {
  if (message.type === 'pair_prepare') {
    if (message.service_path !== undefined && !validServicePath(message.service_path))
      return { ok: false, error: 'Invalid CloudFile service path' };
    // The Agent independently proves the instance before trusting it; the
    // browser never smuggles a foreign origin through this channel.
    return routeNative('pair_prepare', {
      type: 'pair_prepare', server: senderOrigin, service_path: message.service_path || '',
    });
  }
  const response = message.response;
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return { ok: false, error: 'Invalid pairing response' };
  let encoded = '';
  try { encoded = JSON.stringify(response); } catch { /* reject */ }
  if (!encoded || encoded.length > 65536)
    return { ok: false, error: 'Pairing response is too large' };
  return routeNative(message.type, {
    type: message.type, server: senderOrigin, response,
  });
}

async function handleExternal(message, sender) {
  // Manifest accepts HTTP/HTTPS on any intranet host, so source authorization
  // must happen HERE for every privileged external operation, not only URI
  // launch. No file metadata is available to an arbitrary third-party site.
  let senderOrigin = '';
  try {
    const page = new URL(sender?.url);
    if (page.protocol === 'http:' || page.protocol === 'https:')
      senderOrigin = page.origin;
  } catch { /* reject */ }
  if (!senderOrigin) return { ok: false, error: 'Invalid CloudFile sender origin' };
  if (message?.type !== 'open_uri') {
    if (message?.type === 'open_session' || PAIRING_MESSAGES.has(message?.type)) {
      // First-use pairing and ordinary sessions are bound to the exact origin
      // the page claims, never to a previously stored server.
      let target = '';
      try { target = new URL(message.server).origin; } catch { /* reject */ }
      if (target !== senderOrigin)
        return { ok: false, error: 'Local session must target the current CloudFile origin' };
    } else {
      const current = await chrome.storage.local.get('server');
      let bound = '';
      try { bound = new URL(current.server).origin; } catch { /* reject */ }
      if (bound !== senderOrigin)
        return { ok: false, error: 'Local file lookup requires a confirmed same-origin session' };
    }
  }
  if (message?.type === 'open_uri') {
    // Any CloudFile installation can be http or https. Chrome permits sender
    // access, but this handler requires the URI's exact canonical origin to
    // equal the originating page, and the installed Host independently checks
    // current-user pairing before any claim or file access.
    // Chrome enforces the exact manifest externally_connectable site list.
    // For an internal HTTP site we ALSO bind the URI to that same sender
    // origin: an HTTPS site cannot silently downgrade to another HTTP site,
    // and neither may request a foreign server using this Native Host.
    let matchingSender = false;
    try {
      const page = new URL(sender.url);
      const uri = new URL(message.uri);
      const query = uri.searchParams;
      const instance = query.get('instance');
      const v1 = uri.hostname === 'v1' && message.uri.startsWith('cloudfile-open://v1/open?') &&
        message.uri.length <= 2048;
      const v2 = uri.hostname === 'v2' && message.uri.startsWith('cloudfile-open://v2/open?') &&
        message.uri.length <= 16384 &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.get('session') || '') &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(query.get('ticket') || '');
      matchingSender = (page.protocol === 'https:' || page.protocol === 'http:') &&
        uri.protocol === 'cloudfile-open:' && (v1 || v2) &&
        uri.pathname === '/open' && !uri.hash &&
        [...query.keys()].join(',') === 'instance,session,ticket' &&
        page.origin === new URL(instance).origin &&
        instance === new URL(instance).origin &&
        (instance.startsWith('https://') || instance.startsWith('http://'));
    } catch { /* reject malformed sender or intent */ }
    if (!matchingSender || typeof message.uri !== 'string') {
      return { ok: false, error: '本地打开请求与当前已授权 CloudFile 网站不匹配' };
    }
    return routeNative('open_uri', { type: 'open_uri', uri: message.uri });
  }

  if (PAIRING_MESSAGES.has(message?.type)) return pairNative(message, senderOrigin);

  if (message?.type === 'query_local_file') {
    // 网页在发起本地编辑前查询本地缓存状态（是否存在 / hash / 大小 / 时间），
    // 用于渲染「覆盖本地 / 保留本地」冲突弹窗。
    // mode 决定查哪个子树（本地查看 view / 本地编辑 edit）；缺省时 Agent 按可编辑子树处理。
    return routeNative('query_local_file', {
      type: 'query_local_file',
      repo_id: message.repo_id,
      path: message.path,
      mode: message.mode || '',
    });
  }
  if (message?.type === 'query_local_folder') {
    // 网页在渲染「打开本地目录」入口前问一句：这个资料库的本地目录建了没有。
    // 镜像是一库一个平铺目录，所以「存在」就等于用户在这里做过一次本地编辑。
    return routeNative('query_local_folder', {
      type: 'query_local_folder',
      repo_id: message.repo_id,
      mode: message.mode || '',
    });
  }
  if (message?.type === 'open_workspace') {
    // 网页请求打开某个库/目录的本地镜像目录，供用户手动上传本地改动。
    return routeNative('open_workspace', {
      type: 'open_workspace',
      repo_id: message.repo_id,
      path: message.path || '',
      mode: message.mode || '',
    });
  }
  if (message?.type !== 'open_session') return undefined;
  // 记录最近一次会话的 server，供 popup 的「帮助」按钮拼出帮助页地址。
  const response = await routeNative('open_session', {
    type: 'open_session',
    protocol: message.protocol,
    server: message.server,
    ticket: message.ticket,
    expires_at: message.expires_at,
    local_action: message.local_action || '',
  });
  if (response?.ok === true && message.server)
    await chrome.storage.local.set({ server: message.server });
  return response;
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
    return routeNative('open_workspace', { type: 'open_workspace' });
  }
  // v0.8: browser-side UI only. Existing Host versions do not advertise this
  // capability, so the popup never exposes or invokes it during v0.7.
  if (message?.type === 'agent_task_summary') {
    const selected = await preferredNative('task_summary');
    if (!selected?.status?.capabilities?.includes('task_summary'))
      return { ok: false, error: '当前 Agent 尚未启用本地任务查询。' };
    const response = await routeNative('task_summary', { type: 'task_summary' });
    if (!response?.ok || !Array.isArray(response.tasks))
      return { ok: false, error: '任务摘要不可用。' };
    // Host owns all authorization and filtering. Browser never receives the
    // working-copy path, Lease, device ID, session ID or pending Intent.
    return {
      ok: true,
      tasks: response.tasks.slice(0, 50).filter(task => task && typeof task === 'object').map(task => ({
        task_id: typeof task.task_id === 'string' && /^(?:[0-9a-f]{64}|session-[0-9a-f]{64})$/.test(task.task_id)
          ? task.task_id : '',
        file_name: typeof task.file_name === 'string' ? task.file_name.slice(0, 160) : '本地文件',
        mode: task.mode === 'exclusive-edit' ? 'exclusive-edit' : 'local-edit',
        local_changed: task.local_changed === true,
        needs_review: task.needs_review === true,
      })),
    };
  }
  if (message?.type === 'agent_focus_task') {
    if (typeof message.task_id !== 'string' || !/^(?:[0-9a-f]{64}|session-[0-9a-f]{64})$/.test(message.task_id))
      return { ok: false, error: '任务编号无效。' };
    const selected = await preferredNative('focus_task');
    if (!selected?.status?.capabilities?.includes('focus_task'))
      return { ok: false, error: '当前 Agent 不支持定位任务。' };
    const reply = await routeNative('focus_task', { type: 'focus_task', task_id: message.task_id });
    return reply?.ok === true ? { ok: true } : { ok: false, error: '无法定位任务，请在 Agent 中查看。' };
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
        return { ok: false, error: '暂时拿不到扩展的更新信息，请稍后再试或查看当前平台的安装帮助。' };
      }
      const accepted = await sendNative({ type: 'update_extension' });
      if (accepted?.ok !== true) return { ok: false, error: accepted?.error || '扩展升级未获得 Agent 确认。' };
      await scheduleUpgradeVerify('extension', extension_update.latest_version);
      return { ok: true };
    }
    const { agent_update } = await chrome.storage.local.get('agent_update');
    if (!agent_update?.latest_version) return { ok: false, error: '暂时拿不到 Agent 更新版本，请先检查更新。' };
    const accepted = await sendNative({ type: 'update' });
    if (accepted?.ok !== true) return { ok: false, error: accepted?.error || 'Agent 升级未获得确认。' };
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
