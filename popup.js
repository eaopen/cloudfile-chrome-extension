const $ = (selector) => document.querySelector(selector);
const settings = () => new Promise((resolve) => chrome.storage.local.get({ endpoint: 'http://127.0.0.1:4317', token: '' }, resolve));
let selectedProjectId = null;

function setNotice(message = '', error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
function setSignal(state, message) { $('#signal').className = `signal ${state}`; $('#connection-label').textContent = message; }
async function request(route, options = {}) {
  const { endpoint, token } = await settings();
  if (!token) throw new Error('尚未配置配对令牌');
  const response = await fetch(`${endpoint.replace(/\/$/, '')}${route}`, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '本地 Agent 请求失败');
  return data;
}
function renderProjects(projects) {
  const list = $('#project-list'); list.replaceChildren();
  if (!projects.length) { list.innerHTML = '<p class="empty">还没有项目。创建第一个本地工作区。</p>'; return; }
  projects.forEach((project) => {
    const button = document.createElement('button'); button.className = `project ${project.id === selectedProjectId ? 'active' : ''}`;
    button.innerHTML = `<strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.rootPath)}</small>`;
    button.onclick = async () => { selectedProjectId = project.id; renderProjects(projects); $('#task-prompt').disabled = false; $('#queue-task').disabled = false; setNotice(`已选择：${project.name}`); await refreshTasks(); };
    list.append(button);
  });
}
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function availableActions(status) {
  return { queued: [['working', '开始'], ['cancelled', '取消']], working: [['done', '完成'], ['failed', '失败'], ['cancelled', '取消']] }[status] ?? [];
}
function renderTasks(tasks) {
  const list = $('#task-list'); list.replaceChildren();
  if (!tasks.length) { list.innerHTML = '<p class="empty">还没有任务记录。</p>'; return; }
  tasks.forEach((task) => {
    const item = document.createElement('article'); item.className = 'task'; item.dataset.status = task.status;
    const header = document.createElement('div'); header.className = 'task-header';
    const status = document.createElement('strong'); status.className = 'task-status'; status.textContent = task.status;
    const time = document.createElement('small'); time.textContent = new Date(task.updatedAt ?? task.createdAt).toLocaleString();
    const prompt = document.createElement('p'); prompt.className = 'task-prompt'; prompt.textContent = task.prompt;
    header.append(status, time); item.append(header, prompt);
    const actions = availableActions(task.status);
    if (actions.length) {
      const actionBar = document.createElement('div'); actionBar.className = 'task-actions';
      actions.forEach(([nextStatus, label]) => { const button = document.createElement('button'); button.dataset.action = nextStatus; button.textContent = label; button.onclick = () => updateTask(task.id, nextStatus); actionBar.append(button); });
      item.append(actionBar);
    }
    list.append(item);
  });
}
async function refreshTasks() {
  try { renderTasks((await request(`/v1/tasks${selectedProjectId ? `?projectId=${encodeURIComponent(selectedProjectId)}` : ''}`)).tasks); } catch (error) { setNotice(error.message, true); }
}
async function updateTask(id, status) {
  try { await request(`/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setNotice(`任务状态已更新为 ${status}。`); await refreshTasks(); } catch (error) { setNotice(error.message, true); }
}
async function refresh() {
  try {
    setSignal('pending', '正在检查本地 Agent');
    const health = await request('/v1/health');
    setSignal('ready', `已连接 · ${health.sharedRoot}`); $('#setup-card').hidden = true; $('#workspace').hidden = false;
    renderProjects((await request('/v1/projects')).projects); await refreshTasks();
  } catch (error) {
    setSignal('offline', '本地 Agent 未连接'); $('#setup-card').hidden = false; $('#workspace').hidden = true; setNotice(error.message, true);
  }
}
$('#open-settings').onclick = () => chrome.runtime.openOptionsPage();
$('#setup-button').onclick = () => chrome.runtime.openOptionsPage();
$('#refresh-tasks').onclick = refreshTasks;
$('#new-project').onclick = () => { $('#project-form').hidden = false; $('#new-project').hidden = true; };
$('#cancel-project').onclick = () => { $('#project-form').hidden = true; $('#new-project').hidden = false; };
$('#project-form').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await request('/v1/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); event.currentTarget.reset(); $('#project-form').hidden = true; $('#new-project').hidden = false; setNotice('项目已添加。'); await refresh(); } catch (error) { setNotice(error.message, true); } };
$('#task-form').onsubmit = async (event) => { event.preventDefault(); try { const prompt = new FormData(event.currentTarget).get('prompt'); await request('/v1/tasks', { method: 'POST', body: JSON.stringify({ projectId: selectedProjectId, prompt }) }); event.currentTarget.reset(); setNotice('任务已排入队列。'); await refreshTasks(); } catch (error) { setNotice(error.message, true); } };
refresh();
