const HOST = 'com.cloudfile.local_agent';

async function sendNative(message) {
  return chrome.runtime.sendNativeMessage(HOST, message);
}

// 网页 → 扩展 → 本地 Agent 的消息通道。
// 安全分层：
//   1. manifest.json 的 externally_connectable.matches 是主闸，Chrome 强制
//      只允许白名单域名调用本监听器；
//   2. Agent 侧 config.allowed_origins 对 descriptor.server 二次校验。
// 因此这里不再重复校验 sender，域名只在一处（manifest）维护。
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'open_session') return;
  const payload = {
    type: 'open_session',
    protocol: message.protocol,
    server: message.server,
    ticket: message.ticket,
    expires_at: message.expires_at,
  };
  sendNative(payload).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: error.message || 'Agent rejected the session.',
  }));
  return true;
});

// 扩展 popup 查询 Agent 状态与已检测应用。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'agent_status') return false;
  sendNative({ type: 'status' }).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: error.message,
  }));
  return true;
});
