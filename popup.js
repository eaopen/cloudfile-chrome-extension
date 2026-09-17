const status = document.querySelector('#status');
const applications = document.querySelector('#applications');
const workspace = document.querySelector('#workspace');
const workspacePath = document.querySelector('#workspace-path');
const openButton = document.querySelector('#open-workspace');
const copyButton = document.querySelector('#copy-workspace');
const workspaceHint = document.querySelector('#workspace-hint');
const helpButton = document.querySelector('#help');
const helpHint = document.querySelector('#help-hint');

let workspaceRoot = '';

const HELP_PATH = 'cloudfile/local-app-help/';

// siteRoot 默认值：与后端 SITE_ROOT 环境变量对应（本部署 = /seafile/）。
// 若 storage 里记录过会话 server（= origin + siteRoot），会优先从 server 自动
// 推导出真实 siteRoot 覆盖此默认值，因此该常量仅在用户从未点过「本地查看/编辑」时
// 作为兜底。
const DEFAULT_SITE_ROOT = '/seafile/';

// 域名白名单从 manifest.json 的 externally_connectable.matches 自动读取，
// 不再在 popup.js 里硬编码，站点增删域名只需改 manifest 一处。
function getManifestOrigins() {
  try {
    const manifest = chrome.runtime.getManifest();
    const matches = (manifest && manifest.externally_connectable
      && manifest.externally_connectable.matches) || [];
    // matches 形如 "http://host:port/*"，去掉通配尾缀得到 origin。
    return matches
      .map((pattern) => pattern.replace(/\/\*$/, ''))
      .filter((origin) => /^https?:\/\//.test(origin));
  } catch {
    return [];
  }
}

// 从最近一次会话的 server（origin + siteRoot，如 http://host:port/seafile）
// 推导 siteRoot；无记录时回退到 DEFAULT_SITE_ROOT。
async function getSiteRoot() {
  try {
    const stored = await chrome.storage.local.get('server');
    const server = stored?.server || '';
    if (server) {
      const path = new URL(server).pathname.replace(/\/+$/, '');
      return path ? path + '/' : '/';
    }
  } catch {
    // ignore
  }
  return DEFAULT_SITE_ROOT;
}

function toOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

async function currentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return (tab && tab.url) || '';
}

helpButton.addEventListener('click', async () => {
  const origins = getManifestOrigins();
  const activeOrigin = toOrigin(await currentTabUrl());

  // 1. 当前活跃 tab 的 origin 在 manifest 白名单内 → 用该 origin + siteRoot 拼帮助页打开。
  if (activeOrigin && origins.includes(activeOrigin)) {
    const siteRoot = await getSiteRoot();
    chrome.tabs.create({ url: activeOrigin + siteRoot + HELP_PATH });
    return;
  }

  // 2. 不在白名单域名内，但之前记录过会话 server（origin + siteRoot）→ 兜底打开。
  let base = '';
  try {
    const stored = await chrome.storage.local.get('server');
    base = stored?.server || '';
  } catch {
    base = '';
  }
  if (base) {
    chrome.tabs.create({ url: base.replace(/\/+$/, '') + '/' + HELP_PATH });
    return;
  }

  // 3. 两者都没有 → 引导用户先进入网盘页面。
  showHelpHint('请先在浏览器中打开 CloudFile 网盘页面，再从该页面点击扩展图标打开安装帮助。');
});

chrome.runtime.sendMessage({ type: 'agent_status' }, (result) => {
  if (chrome.runtime.lastError || !result?.ok) {
    status.textContent = `Agent 未就绪：${result?.error ?? '请执行绿色包中的注册脚本。'}`;
    status.className = 'status error';
    return;
  }
  status.textContent = `Agent 已就绪 · v${result.version}`;
  status.className = 'status ready';
  if (result.applications?.length) {
    applications.hidden = false;
    applications.textContent = `自动检测：${result.applications.join(' · ')}`;
  }
  if (result.workspace_root) {
    workspaceRoot = result.workspace_root;
    workspace.hidden = false;
    workspacePath.textContent = workspaceRoot;
    // Agent 能调起系统资源管理器（explorer/open/xdg-open）则显示「打开」，
    // 否则退回「复制路径 + 提示手动打开」。
    if (result.can_open_workspace) {
      openButton.hidden = false;
    } else {
      copyButton.hidden = false;
    }
  }
});

openButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open_workspace' }, (result) => {
    if (chrome.runtime.lastError || !result?.ok) {
      showHint(`无法打开目录：${result?.error ?? 'Agent 未响应。'}`);
      return;
    }
    showHint('已在文件管理器中打开本地目录。');
  });
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(workspaceRoot);
    showHint('路径已复制，请手动粘贴到文件管理器中打开。');
  } catch {
    showHint('复制失败，请手动选中路径并复制。');
  }
});

function showHint(text) {
  workspaceHint.hidden = false;
  workspaceHint.textContent = text;
}

function showHelpHint(text) {
  helpHint.hidden = false;
  helpHint.textContent = text;
}
