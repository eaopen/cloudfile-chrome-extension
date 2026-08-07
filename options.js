const form = document.querySelector('#settings');
const status = document.querySelector('#status');
chrome.storage.local.get({ endpoint: 'http://127.0.0.1:4317', token: '' }, (saved) => { form.endpoint.value = saved.endpoint; form.token.value = saved.token; });
form.onsubmit = (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { const url = new URL(values.endpoint); if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('Agent 地址必须是 localhost 或 127.0.0.1'); chrome.storage.local.set({ endpoint: url.origin, token: values.token }, () => { status.textContent = '已保存。现在可以关闭此页面。'; }); } catch (error) { status.textContent = error.message; } };
