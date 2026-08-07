const HOST = 'com.cloudfile.local_agent';

async function sendNative(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== 'complete') return;
  try {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (!item?.filename?.toLowerCase().endsWith('.cloudfile')) return;
    await sendNative({ type: 'open_session_file', path: item.filename });
  } catch (error) {
    console.warn('CloudFile Local Agent did not accept the session file.', error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'agent_status') return;
  sendNative({ type: 'status' }).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
