const status = document.querySelector('#status');
const applications = document.querySelector('#applications');
const workspace = document.querySelector('#workspace');
const workspacePath = document.querySelector('#workspace-path');
const openButton = document.querySelector('#open-workspace');
const copyButton = document.querySelector('#copy-workspace');
const workspaceHint = document.querySelector('#workspace-hint');
const helpButton = document.querySelector('#help');

let workspaceRoot = '';

const HELP_PATH = 'cloudfile/local-app-help/';

helpButton.addEventListener('click', async () => {
  let base = '';
  try {
    const stored = await chrome.storage.local.get('server');
    base = stored?.server || '';
  } catch {
    base = '';
  }
  if (!base) {
    showHint('请先在 CloudFile 网页点击一次「本地查看/本地编辑」，扩展即可记住帮助页地址；或直接在浏览器访问站点下的 /seafile/cloudfile/local-app-help/ 页面。');
    return;
  }
  // server 形如 http://host:port/seafile（站点 origin + siteRoot），
  // 帮助页挂在 siteRoot 下，故拼接相对路径即可。
  const url = base.replace(/\/+$/, '') + '/' + HELP_PATH;
  chrome.tabs.create({ url });
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
