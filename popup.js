const status = document.querySelector('#status');
const autoOpen = document.querySelector('#auto-open');
const event = document.querySelector('#event');
const applications = document.querySelector('#applications');

async function loadPreferences() {
  const { autoOpen: enabled = true, localSessionState } = await chrome.storage.local.get({ autoOpen: true, localSessionState: null });
  autoOpen.checked = enabled;
  if (localSessionState?.message) {
    event.hidden = false;
    event.textContent = localSessionState.message;
  }
}

autoOpen.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoOpen: autoOpen.checked });
  event.hidden = false;
  event.textContent = autoOpen.checked ? '新会话文件会自动交给本地 Agent。' : '新会话文件将只下载，不会自动启动本地程序。';
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
});

loadPreferences();
