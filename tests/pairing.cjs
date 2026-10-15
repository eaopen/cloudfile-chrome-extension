const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBackground } = require('./chrome-mock.cjs');

const NEW = 'com.cloudfile.agent2';
const ORIGIN = 'https://etech.example';

// First-use pairing is a real Agent2 capability; the routing fixture must
// advertise it or the bridge would correctly refuse to invent a fallback.
function fixture(native) {
  return loadBackground({ native: async (host, message) => {
    if (host === NEW && message.type === 'status') return {
      ok: true, version: '2.2.0', agent_family: 'agent2', platform: 'darwin',
      capabilities: ['pair_prepare', 'pair_sign', 'pair_confirm'],
    };
    if (message.type === 'status') throw Error('legacy host missing');
    if (native) return native(host, message);
    return { ok: true };
  }});
}

test('first-use pairing forwards only the sender origin and deployment path', async () => {
  const b = fixture(async (host, message) => {
    assert.equal(host, NEW);
    if (message.type === 'pair_prepare') {
      return { ok: true, state: 'pending', enrollment: { public_key: { kty: 'EC' } }, service_path: '/seafile' };
    }
    return { ok: true };
  });
  const reply = await b.sendExternal(
    { type: 'pair_prepare', server: ORIGIN + '/seafile', service_path: '/seafile' },
    { url: ORIGIN + '/library/Report.docx' });
  assert.equal(reply.ok, true);
  assert.equal(reply.state, 'pending');
  const call = b.nativeCalls.find(item => item.message.type === 'pair_prepare');
  assert.equal(call.host, NEW);
  // The Agent receives the canonical origin, never the page's full address.
  assert.equal(call.message.type, 'pair_prepare');
  assert.equal(call.message.server, ORIGIN);
  assert.equal(call.message.service_path, '/seafile');
});

test('a third-party page cannot start or finish device pairing', async () => {
  const b = fixture();
  for (const type of ['pair_prepare', 'pair_sign', 'pair_confirm']) {
    const reply = await b.sendExternal(
      { type, server: ORIGIN, service_path: '', response: { device_id: 'x' } },
      { url: 'https://other.example/file' });
    assert.equal(reply.ok, false, type);
  }
  assert.equal(b.nativeCalls.length, 0);
});

test('pairing cannot be redirected to a foreign server', async () => {
  const b = fixture();
  const reply = await b.sendExternal(
    { type: 'pair_prepare', server: 'https://files.example.com', service_path: '' },
    { url: ORIGIN + '/file' });
  assert.equal(reply.ok, false);
  assert.equal(b.nativeCalls.length, 0);
});

test('a malformed deployment path never reaches the native host', async () => {
  const b = fixture();
  for (const service_path of ['/a/', '/a//b', 'seafile', 5]) {
    const reply = await b.sendExternal(
      { type: 'pair_prepare', server: ORIGIN, service_path },
      { url: ORIGIN + '/file' });
    assert.equal(reply.ok, false, String(service_path));
  }
  assert.equal(b.nativeCalls.length, 0);
});

test('the page can relay a bounded pairing challenge and confirmation', async () => {
  const b = fixture();
  const challenge = {
    device_id: '11111111-1111-4111-8111-111111111111', state: 'pending', revision: '1',
  };
  const signed = await b.sendExternal(
    { type: 'pair_sign', server: ORIGIN, response: challenge }, { url: ORIGIN + '/file' });
  assert.equal(signed.ok, true);
  const finished = await b.sendExternal(
    { type: 'pair_confirm', server: ORIGIN, response: { device_id: challenge.device_id } },
    { url: ORIGIN + '/file' });
  assert.equal(finished.ok, true);
  const calls = b.nativeCalls.filter(item => item.message.type !== 'status');
  assert.deepEqual(calls.map(item => item.message.type), ['pair_sign', 'pair_confirm']);
  assert.equal(calls[0].message.server, ORIGIN);
  assert.equal(calls[0].message.response.device_id, challenge.device_id);
  assert.equal(calls[0].message.response.revision, '1');
});

test('an oversized pairing response is refused before the native host', async () => {
  const b = fixture();
  const reply = await b.sendExternal(
    { type: 'pair_sign', server: ORIGIN, response: { blob: 'x'.repeat(70000) } },
    { url: ORIGIN + '/file' });
  assert.equal(reply.ok, false);
  assert.equal(b.nativeCalls.length, 0);
});

test('an Agent2 without the pairing capability fails without a fallback host', async () => {
  const b = loadBackground({ native: async (host, message) => {
    if (host === NEW && message.type === 'status') return {
      ok: true, version: '2.0.1', agent_family: 'agent2', capabilities: ['open_session'],
    };
    if (message.type === 'status') return { ok: true, version: '1.0.1' };
    return { ok: true };
  }});
  const reply = await b.sendExternal(
    { type: 'pair_prepare', server: ORIGIN, service_path: '' }, { url: ORIGIN + '/file' });
  assert.equal(reply.ok, false);
  assert.equal(b.nativeCalls.filter(item => item.message.type === 'pair_prepare').length, 0);
});
