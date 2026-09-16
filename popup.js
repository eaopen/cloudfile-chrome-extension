const status = document.querySelector('#status');
const applications = document.querySelector('#applications');

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
