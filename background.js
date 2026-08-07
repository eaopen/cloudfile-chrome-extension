const HOST = 'com.cloudfile.local_agent';
const SETTINGS = { autoOpen: true };

async function sendNative(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

async function updateState(state) {
  await chrome.storage.local.set({ localSessionState: { ...state, at: Date.now() } });
}

function isSessionDownload(item) {
  if (!item?.filename?.toLowerCase().endsWith('.cloudfile')) return false;
  try {
    const url = new URL(item.finalUrl || item.url);
    // Hub creates the descriptor with a browser Blob so its download URL is
    // usually blob:.  The Agent validates the descriptor's server origin and
    // one-time ticket before any network request, which is the security gate.
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'blob:';
  } catch {
    return false;
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== 'complete') return;
  try {
    const { autoOpen } = await chrome.storage.local.get(SETTINGS);
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (!isSessionDownload(item)) return;
    if (!autoOpen) {
      await updateState({ kind: 'paused', message: '已下载会话文件；自动打开已关闭。' });
      return;
    }
    const result = await sendNative({ type: 'open_session_file', path: item.filename });
    if (!result?.ok) throw new Error(result?.error || 'Agent rejected the session file.');
    await updateState({ kind: 'ready', message: '已交给本地 Agent 打开。' });
  } catch (error) {
    await updateState({ kind: 'error', message: error.message || '无法交给本地 Agent。' });
    console.warn('CloudFile Local Agent did not accept the session file.', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'agent_status') return false;
  sendNative({ type: 'status' }).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: error.message,
  }));
  return true;
});
