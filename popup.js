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
const updateCommand = document.querySelector('#update-command');
const updateActions = document.querySelector('#update-actions');
const updateApply = document.querySelector('#update-apply');
const updateExtensionApply = document.querySelector('#update-extension-apply');
const updateCopy = document.querySelector('#update-copy');
const updateHint = document.querySelector('#update-hint');
const updateStatus = document.querySelector('#update-status');

let workspaceRoot = '';
let agentUpdateCommand = '';

const HELP_URL = '/cloudfile-updates/help.html';

// 升级区块的标题与说明：Agent 与扩展可能同时有待升级版本，各自往里追加，
// 最后一次性渲染，避免后写的把先写的覆盖掉。
const updateHeadlines = [];
const updateHints = [];

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

// 查询 Agent 状态，渲染就绪状态、自动检测应用、本地目录与两侧的升级提示。
chrome.runtime.sendMessage({ type: 'agent_status' }, async (result) => {
  if (chrome.runtime.lastError || !result?.ok) {
    status.textContent = `Agent 未就绪：${result?.error ?? '请执行绿色包中的注册脚本。'}`;
    status.className = 'status error';
  } else {
    status.textContent = `Agent 已就绪 · v${result.version}`;
    status.className = 'status ready';
    // 固定展示支持的本地文件类型，不随本机实际安装的软件版本变化。
    applications.hidden = false;
    applications.textContent = '自动检测：CAD、UG、Office、PDF';
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
    renderAgentUpdate(result);
  }
  // 扩展侧的状态由后台探测后落库，这里直接读，保证与 Agent 侧同一次探测结果。
  await renderExtensionUpdate();
  renderUpdateSection();
});

function renderAgentUpdate(result) {
  if (!result.update_available) return;
  updateHeadlines.push(`本地 Agent 可升级：v${result.version} → v${result.latest_version}`);
  if (result.latest_notes) updateHints.push(result.latest_notes);
  // 命令给出 Agent 的完整路径，用户不必猜 exe 装在哪。
  if (result.executable_path) {
    agentUpdateCommand = `"${result.executable_path}" --update`;
    updateCommand.hidden = false;
    updateCommand.textContent = agentUpdateCommand;
    updateCopy.hidden = false;
  }
  updateApply.hidden = false;
  updateHints.push('点「立即升级 Agent」自动下载安装，完成后会自动复核版本号；也可点「复制升级命令」在 PowerShell 中手动执行。');
  markUpdateSeen('agent', result.latest_version);
}

async function renderExtensionUpdate() {
  const { extension_update } = await chrome.storage.local.get('extension_update');
  if (!extension_update?.has_update) return;
  updateHeadlines.push(`扩展可升级：v${extension_update.current_version} → v${extension_update.latest_version}`);
  if (extension_update.notes) updateHints.push(extension_update.notes);
  updateExtensionApply.hidden = false;
  updateHints.push('点「立即升级扩展」自动下载并替换扩展文件，随后扩展会自动重新加载生效（若 Chrome 提示新增权限，按提示确认即可）。');
  updateHints.push('也可以点下方「安装帮助」，按说明重跑注册脚本，再在 chrome://extensions 点「重新加载」。');
  markUpdateSeen('extension', extension_update.latest_version);
}

function renderUpdateSection() {
  if (!updateHeadlines.length) return;
  updateSection.hidden = false;
  updateText.textContent = updateHeadlines.join('\n');
  // 「复制升级命令」和「立即升级」可能各自隐藏，这里统一按可见的按钮决定整块是否显示。
  updateActions.hidden = updateApply.hidden && updateExtensionApply.hidden && updateCopy.hidden;
  if (updateHints.length) {
    updateHint.hidden = false;
    updateHint.textContent = updateHints.join('\n');
  }
}

// 升级按钮：Agent 与扩展共用一套流程。请求返回只代表后台已开始，
// 真正的结果由扩展后台复核后在提示区给出。
function wireUpgrade(button, kind) {
  button.addEventListener('click', () => {
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'upgrade', kind }, (result) => {
      button.disabled = false;
      if (chrome.runtime.lastError || !result?.ok) {
        setUpdateStatus(`升级失败：${result?.error ?? 'Agent 未响应。'}`);
        return;
      }
      setUpdateStatus(kind === 'extension'
        ? '已开始升级扩展：正在后台下载并替换扩展文件，完成后扩展会自动重新加载。'
        : '已开始升级 Agent：正在后台下载并安装，稍后会自动复核版本号。');
    });
  });
}

wireUpgrade(updateApply, 'agent');
wireUpgrade(updateExtensionApply, 'extension');

// 用户已经看到了该版本的提示 → 告诉后台清掉角标、不再为这个版本弹系统通知。
function markUpdateSeen(kind, version) {
  if (!kind || !version) return;
  chrome.runtime.sendMessage({ type: 'updates_seen', kind, version }).catch(() => {});
}

// 「复制升级命令」：把完整命令放进剪贴板，供用户在 PowerShell 里兜底执行。
updateCopy.addEventListener('click', async () => {
  if (!agentUpdateCommand) return;
  try {
    await navigator.clipboard.writeText(agentUpdateCommand);
    setUpdateStatus('升级命令已复制，请在 PowerShell 中粘贴运行。');
  } catch {
    setUpdateStatus('复制失败，请手动选中命令内容并复制。');
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

function setUpdateStatus(text) {
  updateSection.hidden = false;
  updateStatus.hidden = false;
  updateStatus.textContent = text;
}
