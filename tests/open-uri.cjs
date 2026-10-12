const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBackground, settle } = require('./chrome-mock.cjs');

test('a ping is answered synchronously', () => {
  const background = loadBackground();
  let reply;
  assert.equal(background.external({ type: 'ping' }, {}, (value) => { reply = value; }), false);
  assert.equal(reply?.ok, true);
});

test('HTTP or HTTPS same-instance page forwards exactly one bounded URI', async () => {
  const background = loadBackground({ platform: 'win', currentHostMissing: false });
  for (const scheme of ['https','http']) {
    const origin = scheme + '://etech.example';
    const uri = 'cloudfile-open://v1/open?instance=' +
      encodeURIComponent(origin) + '&session=11111111-1111-4111-8111-111111111111&ticket=' + 'A'.repeat(43);
    const reply = await background.sendExternal(
      { type: 'open_uri', uri }, { url: origin + '/file' });
      assert.equal(reply.ok, true);
  }
  await settle();
  // Read-only capability probes are expected; the real action is dispatched once.
  const actions = background.nativeCalls.filter(call => call.message.type !== 'status');
  assert.equal(actions.length, 2);
  assert.equal(actions[0].host, 'com.cloudfile.current_agent');
  assert.equal(actions[0].message.type, 'open_uri');
});

test('cross-origin, wrong-scheme and unbounded open URIs never reach the native host', async () => {
  const background = loadBackground();
  for (const [url, uri] of [
    ['http://etech.example/file', 'cloudfile-open://v1/open?instance=' +
      encodeURIComponent('https://etech.example') + '&session=s&ticket=t'],
    ['https://etech.example/file', 'cloudfile-open://v1/open?instance=' +
      encodeURIComponent('http://etech.example') + '&session=s&ticket=t'],
    ['http://other.example/file', 'cloudfile-open://v1/open?instance=' +
      encodeURIComponent('http://etech.example') + '&session=s&ticket=t'],
    ['https://etech.example/file', 'file:///secret'],
    ['https://etech.example/file', 'cloudfile-open://v1/open?' + 'a'.repeat(2048)],
  ]) {
    const reply = await background.sendExternal({ type: 'open_uri', uri }, { url });
    assert.equal(reply.ok, false, `${url} ${uri.slice(0, 24)}`);
  }
  assert.equal(background.nativeCalls.length, 0);
});

test('a page-initiated local open forwards the session and records the server', async () => {  const background = loadBackground({ native: async () => ({ ok: true }) });
  const reply = await background.sendExternal({
    type: 'open_session',
    protocol: 'cloudfile-open',
    server: 'https://etech.example/app',
    ticket: 't'.repeat(43),
    expires_at: 4102444800,
    local_action: 'edit',
  });
  await settle();
  assert.equal(reply.ok, true);
  const call = background.nativeCalls.find((item) => item.message.type === 'open_session');
  assert.equal(call.host, 'com.cloudfile.local_agent');
  assert.equal(call.message.local_action, 'edit');
  assert.equal(background.store.server, 'https://etech.example/app');
});

test('a failing native call is reported back to the page', async () => {
  const background = loadBackground({
    native: async (_host, message) => {
      if (message.type === 'open_session') throw new Error('Agent rejected the session');
      return { ok: true };
    },
  });
  const reply = await background.sendExternal({
    type: 'open_session',
    protocol: 'cloudfile-open',
    server: 'https://etech.example/app',
    ticket: 't'.repeat(43),
    expires_at: 4102444800,
  });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /Agent rejected the session/);
});

// The page decides whether to offer "open the local folder" from the agent's
// answer, so the bridge must forward the question verbatim.
test('the page can ask whether a library already has a local folder', async () => {
  const background = loadBackground({
    native: async (_host, message) => {
      if (message.type === 'query_local_folder') {
        return { ok: true, mode: 'local-edit', local_exists: true, local_path: 'D:\\CloudFileLocal\\sessions\\edit\\repo' };
      }
      return { ok: true };
    },
  });
  background.store.server = 'https://etech.example/app';
  const reply = await background.sendExternal({ type: 'query_local_folder', repo_id: 'repo-1', mode: 'local-edit' });
  assert.equal(reply.ok, true);
  assert.equal(reply.local_exists, true);

  const call = background.nativeCalls.find((item) => item.message.type === 'query_local_folder');
  assert.equal(call.host, 'com.cloudfile.local_agent');
  assert.equal(call.message.repo_id, 'repo-1');
  assert.equal(call.message.mode, 'local-edit');
});

test('a folder query with no library is forwarded anyway, so the agent can refuse it', async () => {
  const background = loadBackground({
    native: async (_host, message) => (
      message.type === 'query_local_folder' ? { ok: false, error: 'invalid query_local_folder request' } : { ok: true }
    ),
  });
  background.store.server = 'https://etech.example/app';
  const reply = await background.sendExternal({ type: 'query_local_folder', repo_id: '' });
  assert.equal(reply.ok, false);
});


test('a third-party HTTP origin cannot query local files or folders', async () => {
  const background = loadBackground();
  background.store.server = 'http://cloudfile.internal:8092/';
  for (const type of ['query_local_file', 'query_local_folder', 'open_workspace']) {
    const result = await background.sendExternal(
      { type, repo_id: 'repo' }, { url: 'http://other.internal:8092/' });
    assert.equal(result.ok, false);
  }
  assert.equal(background.nativeCalls.length, 0);
});

test('failed legacy open_session never authorizes future local queries', async () => {
  const background = loadBackground({ native: async (_host, message) =>
    message.type === 'open_session' ? { ok: false } : { ok: true } });
  const result = await background.sendExternal({
    type: 'open_session', protocol: 'cloudfile-open',
    server: 'http://etech.example/', ticket: 'A'.repeat(43), expires_at: 4102444800
  }, { url: 'http://etech.example/file' });
  assert.equal(result.ok, false);
  assert.equal(background.store.server, undefined);
});
