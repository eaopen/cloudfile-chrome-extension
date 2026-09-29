const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function bridge() {
  let external;
  const native = [];
  const chrome = {
    runtime: {
      onMessageExternal: { addListener: listener => { external = listener; } },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendNativeMessage: async (host, message) => {
        native.push({ host, message });
        return { ok: true };
      },
    },
    alarms: { onAlarm: { addListener() {} } },
    storage: { local: { set: async () => {} } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'),
    { chrome, URL, fetch: async () => ({ ok: false }) });
  return { external, native };
}

test('HTTPS page hands a bounded URI to the fixed native host', async () => {
  const { external, native } = bridge();
  let reply;
  assert.equal(external({ type: 'open_uri', uri: 'cloudfile-open://v1/open?ticket=a' },
    { url: 'https://etech.example/file' }, value => { reply = value; }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reply.ok, true);
  assert.equal(native.length, 1);
  assert.equal(native[0].host, 'com.cloudfile.current_agent');
  assert.equal(native[0].message.type, 'open_uri');
});

test('insecure page and unbounded or unrelated payload never reach native host', () => {
  const { external, native } = bridge();
  for (const [url, uri] of [
    ['http://etech.example/file', 'cloudfile-open://v1/open?ticket=a'],
    ['https://etech.example/file', 'file:///secret'],
    ['https://etech.example/file', 'cloudfile-open://v1/open?' + 'a'.repeat(2048)],
  ]) {
    let reply;
    assert.equal(external({ type: 'open_uri', uri }, { url }, value => { reply = value; }), false);
    assert.equal(reply.ok, false);
  }
  assert.equal(native.length, 0);
});
