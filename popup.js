const status = document.querySelector('#status');
const applications = document.querySelector('#applications');
const workspace = document.querySelector('#workspace');
const workspacePath = document.querySelector('#workspace-path');
const openButton = document.querySelector('#open-workspace');
const copyButton = document.querySelector('#copy-workspace');
const workspaceHint = document.querySelector('#workspace-hint');
const helpButton = document.querySelector('#help');
const helpHint = document.querySelector('#help-hint');
const updateSection = document.querySelector('#update');
const updateText = document.querySelector('#update-text');
const updateHint = document.querySelector('#update-hint');

let workspaceRoot = '';

const HELP_URL = '/cloudfile-updates/help.html';

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

  // 1. 当前活跃 tab 的 origin 在 manifest 白名单内 → 用该 origin 拼静态帮助页打开。
  if (activeOrigin && origins.includes(activeOrigin)) {
    chrome.tabs.create({ url: activeOrigin + HELP_URL });
    return;
  }

  // 2. 不在白名单域名内，但之前记录过会话 server（origin + siteRoot）→ 用其 origin 兜底打开。
  let base = '';
  try {
    const stored = await chrome.storage.local.get('server');
    base = toOrigin(stored?.server || '');
  } catch {
    base = '';
  }
  if (base) {
    chrome.tabs.create({ url: base + HELP_URL });
    return;
  }

  // 3. 两者都没有 → 引导用户先进入网盘页面。
  showHelpHint('请先在浏览器中打开 CloudFile 网盘页面，再从该页面点击扩展图标打开安装帮助。');
});

// 查询 Agent 状态，渲染就绪状态、自动检测应用、本地目录与 Agent 自身升级提示。
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
    // Agent 能调起系统资源管理器（explorer/open/xdg-open）则显示「打开」；
    // 否则退回「复制路径 + 提示手动打开」。
    if (result.can_open_workspace) {
      openButton.hidden = false;
    } else {
      copyButton.hidden = false;
    }
  }
  // Agent 自身的新版本提示（Agent status 里带回 update_available）。
  if (result.update_available) {
    showUpdate(
      `本地 Agent 可升级：v${result.version} → v${result.latest_version}`,
      '请运行本地 Agent 的升级命令（cloudfile-local-agent --update）。',
    );
  }
});

// 扩展自身的新版本提示（background 的每日 alarm 检查后写入 storage）。
chrome.storage.local.get('extension_update').then(({ extension_update }) => {
  if (extension_update?.has_update) {
    showUpdate(
      `扩展可升级：v${extension_update.current_version} → v${extension_update.latest_version}`,
      (extension_update.notes ? `${extension_update.notes}\n` : '')
        + (extension_update.zip_url
          ? `下载：${extension_update.zip_url}\n`
          : '')
        + '下载新版本 zip 后到 chrome://extensions 重新加载。',
    );
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

// 统一的升级提示渲染：亮出更新区块，展示标题与说明。
function showUpdate(title, hint) {
  updateSection.hidden = false;
  updateText.textContent = title;
  if (hint) {
    updateHint.hidden = false;
    updateHint.textContent = hint;
  }
}
