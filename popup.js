const status = document.querySelector('#status');
const applications = document.querySelector('#applications');
const workspace = document.querySelector('#workspace');
const workspacePath = document.querySelector('#workspace-path');
const openButton = document.querySelector('#open-workspace');
const copyButton = document.querySelector('#copy-workspace');
const workspaceHint = document.querySelector('#workspace-hint');
const helpButton = document.querySelector('#help');
const helpHint = document.querySelector('#help-hint');
const taskCenter = document.querySelector('#task-center');
const taskSummary = document.querySelector('#task-summary');
const updateSection = document.querySelector('#update');
const updateText = document.querySelector('#update-text');
const updateActions = document.querySelector('#update-actions');
const updateExtensionApply = document.querySelector('#update-extension-apply');
const updateHint = document.querySelector('#update-hint');
const updateStatus = document.querySelector('#update-status');
const openTaskCenterButton = document.querySelector('#open-task-center');
const openTaskCenterHint = document.querySelector('#open-task-center-hint');

let workspaceRoot = '';
// 最近一次 agent_status：帮助页要靠它拿到已配置的服务地址。
let lastStatus = null;

const HELP_URL = '/cloudfile-updates/help.html';

// 升级区块的标题与说明：Agent 与扩展可能同时有待升级版本，各自往里追加，
// 最后一次性渲染，避免后写的把先写的覆盖掉。
const updateHeadlines = [];
const updateHints = [];

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

// 帮助页放在 <服务 origin>/cloudfile-updates/help.html。
// 定位顺序：当前标签页（且确实是已知服务）→ 上次会话记录的 server → Agent 报告的第一个服务。
// 修改逻辑（2026-10-27）：原来用 manifest 的 externally_connectable 当白名单，可那是
// http://*/* 通配，`origins.includes(origin)` 永远为 false，所以即使已经打开网盘也一直提示
// 「请先在浏览器中打开 CloudFile 网盘页面」。服务地址现在由 Agent 直接给出。
async function storedServerOrigin() {
  try {
    const stored = await chrome.storage.local.get('server');
    return toOrigin(stored?.server || '');
  } catch {
    return '';
  }
}

helpButton.addEventListener('click', async () => {
  const openHelp = (origin) => chrome.tabs.create({ url: origin + HELP_URL });
  const tabOrigin = toOrigin(await currentTabUrl());
  const stored = await storedServerOrigin();
  const services = (lastStatus?.services || [])
    .map((item) => toOrigin(item.service_url))
    .filter(Boolean);

  // 1. 当前标签页就是某个已知服务（含内置的两条）→ 用它。
  if (tabOrigin && (services.includes(tabOrigin) || tabOrigin === stored)) {
    openHelp(tabOrigin);
    return;
  }
  // 2. 之前在这个浏览器里完成过配对 → 用记录的服务地址。
  if (stored) {
    openHelp(stored);
    return;
  }
  // 3. 当前页不是网盘：退到 Agent 配置的第一个服务（内置服务通常就是它）。
  if (services.length) {
    openHelp(services[0]);
    return;
  }
  // 4. 一条都没有：说明 Agent 还没装好/没配置，给出可执行的下一步。
  showHelpHint('没有拿到 CloudFile 服务地址：请先运行安装包里的 install.cmd，或在网盘里发起一次「本地打开」后再试。');
});

// 查询 Agent 状态，渲染就绪状态、自动检测应用、本地目录与两侧的升级提示。
chrome.runtime.sendMessage({ type: 'agent_status' }, async (result) => {
  lastStatus = result?.ok ? result : null;
  if (chrome.runtime.lastError || !result?.ok) {
    status.textContent = `Agent 未就绪：${result?.error ?? '请先运行安装包里的 install.cmd。'}`;
    status.className = 'status error';
  } else {
    // 只写「Agent」，不区分 Go / Windows / Rust 这些实现名 —— 用户不需要知道。
    // 版本必须是真实构建版本（status.version 已经是 VERSION；build_version 兜底）。
    status.textContent = `Agent 已就绪 · v${result.build_version || result.version}`;
    status.className = 'status ready';
    // 任务中心被用户手动关掉时，扩展是唯一还能把它叫回来的入口。
    openTaskCenterButton.hidden = false;
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
    if (Array.isArray(result.capabilities) && result.capabilities.includes('task_summary')) {
      taskCenter.hidden = false;
      renderTaskSummary(result.capabilities.includes('focus_task'));
    }
  }
  // 扩展侧的状态由后台探测后落库，这里直接读，保证与 Agent 侧同一次探测结果。
  await renderExtensionUpdate();
  renderUpdateSection();
});

// P0 read-only task summary. Never expose local absolute paths, credentials,
// native intents or an upload button. Not advertised until a trusted Host opts in.
function renderTaskSummary(canFocus) {
  chrome.runtime.sendMessage({ type: 'agent_task_summary' }, (result) => {
    taskSummary.replaceChildren();
    const message = document.createElement('p');
    message.className = 'workspace-hint';
    if (chrome.runtime.lastError || !result?.ok) {
      message.textContent = '任务摘要暂不可用，请通过 Agent 任务中心查看。';
      taskSummary.append(message);
      return;
    }
    const tasks = result.tasks || [];
    message.textContent = tasks.length ? '由 Agent 管理的本地文件任务：' : '当前没有本地编辑任务。';
    taskSummary.append(message);
    for (const task of tasks.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'task-row';
      const title = document.createElement('span');
      const state = task.needs_review ? '需要检查' :
        task.local_changed ? '已修改，可在任务中心上传' : '编辑中';
      title.textContent = String(task.file_name || '本地文件') + ' · ' + state;
      row.append(title);
      if (canFocus && /^(?:[0-9a-f]{64}|session-[0-9a-f]{64})$/.test(task.task_id || '')) {
        const focus = document.createElement('button');
        focus.type = 'button';
        focus.textContent = '定位';
        focus.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'agent_focus_task', task_id: task.task_id }, (reply) => {
            if (chrome.runtime.lastError || !reply?.ok)
              message.textContent = '无法定位该任务，请打开 Agent 任务中心。';
          });
        });
        row.append(focus);
      }
      taskSummary.append(row);
    }
    if (tasks.length > 5) {
      const more = document.createElement('p');
      more.className = 'workspace-hint';
      more.textContent = '更多任务请在 Agent 的独立任务中心查看。';
      taskSummary.append(more);
    }
  });
}

function renderAgentUpdate(result) {
  if (!result.update_available) return;
  updateHeadlines.push(`本地 Agent 有新版本：v${result.build_version || result.version} → v${result.latest_version}`);
  if (result.latest_notes) updateHints.push(result.latest_notes);
  // 不在扩展里升级 Agent：统一引导到任务中心的「设置 → 检查更新」，
  // 那边有完整的状态反馈和下载进度。扩展自己的升级按钮仍然保留。
  updateHints.push('请在任务中心「设置 → 检查更新」里升级本机 Agent。');
  markUpdateSeen('agent', result.latest_version);
}

async function renderExtensionUpdate() {
  const { extension_update } = await chrome.storage.local.get('extension_update');
  if (!extension_update?.has_update) return;
  updateHeadlines.push(`扩展可升级：v${extension_update.current_version} → v${extension_update.latest_version}`);
  if (extension_update.notes) updateHints.push(extension_update.notes);
  updateExtensionApply.hidden = false;
  updateHints.push('点「立即升级扩展」自动下载并替换扩展文件，随后去扩展页点击刷新重新加载生效（若 Chrome 提示新增权限，按提示确认即可）。');
  updateHints.push('也可以点下方「安装帮助」，按说明重跑安装包里的 install.cmd，再在 chrome://extensions 点「重新加载」。');
  markUpdateSeen('extension', extension_update.latest_version);
}

function renderUpdateSection() {
  if (!updateHeadlines.length) return;
  updateSection.hidden = false;
  updateText.textContent = updateHeadlines.join('\n');
  // 现在只有扩展自己的升级按钮，整块显隐只看它。
  updateActions.hidden = updateExtensionApply.hidden;
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
      setUpdateStatus('已开始升级扩展：正在后台下载并替换扩展文件，完成后扩展会自动重新加载。');
    });
  });
}

// 只有扩展自己在这个弹窗里升级；Agent 的升级交给任务中心（设置 → 检查更新）。
wireUpgrade(updateExtensionApply, 'extension');

// 用户已经看到了该版本的提示 → 告诉后台清掉角标、不再为这个版本弹系统通知。
function markUpdateSeen(kind, version) {
  if (!kind || !version) return;
  chrome.runtime.sendMessage({ type: 'updates_seen', kind, version }).catch(() => {});
}

openTaskCenterButton.addEventListener('click', () => {
  openTaskCenterButton.disabled = true;
  openTaskCenterHint.hidden = true;
  chrome.runtime.sendMessage({ type: 'open_task_center' }, (result) => {
    openTaskCenterButton.disabled = false;
    if (chrome.runtime.lastError || !result?.ok) {
      openTaskCenterHint.hidden = false;
      openTaskCenterHint.textContent = `无法打开任务中心：${result?.error ?? 'Agent 未响应，请重新运行安装包里的 install.cmd。'}`;
      return;
    }
    openTaskCenterHint.hidden = false;
    openTaskCenterHint.textContent = result.launched
      ? '任务中心正在启动…'
      : '任务中心已切到前台。';
  });
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
