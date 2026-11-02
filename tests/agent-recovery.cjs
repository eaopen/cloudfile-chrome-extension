// 「Agent 未就绪」之后怎么办 —— 三条契约。
//
// 现场（2026-11-02）：点「本地查看」提示 agent 未就绪，重跑 install.cmd 才好；
// 用户能看到的只有一句「未就绪」，看不出是 Host 没注册、Host 起不来，还是任务中心没跑。
// 这里钉住三件事：
//   1) 未就绪要把 Host 的真实原因（detail）带出来，popup 才能给对下一步；
//   2) 「启动任务中心并重试」直接发 open_task_center，不要先探测一轮 status
//      （那一步本身就可能正卡在任务中心冷启动上，等于让用户等两轮）；
//   3) Host 没注册时，这个按钮要明确回错误，而不是假装成功。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBackground } = require('./chrome-mock.cjs');

test('未就绪时带上 Host 的真实原因，而不只是一句「未就绪」', async () => {
  const b = loadBackground({
    platform: 'win',
    native: async () => { throw new Error('Specified native messaging host not found.'); },
  });
  const result = await b.sendInternal({ type: 'agent_status' });
  assert.equal(result.ok, false);
  assert.match(String(result.detail), /native messaging host not found/i);
});

test('启动按钮直接让 Host 拉起任务中心，不再先探测一轮 status', async () => {
  const b = loadBackground({
    platform: 'win',
    native: async (host, message) => {
      if (message.type === 'status') throw new Error('Native host has exited.');
      if (message.type === 'open_task_center') return { ok: true, launched: true };
      return { ok: true };
    },
  });
  const launched = await b.sendInternal({ type: 'launch_agent' });
  assert.equal(launched.ok, true);
  assert.equal(launched.launched, true);
  assert.deepEqual(b.nativeCalls.map((call) => call.message.type), ['open_task_center']);
});

test('Host 没注册时启动按钮如实报错，不假装已启动', async () => {
  const b = loadBackground({
    platform: 'win',
    native: async () => { throw new Error('Specified native messaging host not found.'); },
  });
  const launched = await b.sendInternal({ type: 'launch_agent' });
  assert.equal(launched.ok, false);
  assert.match(String(launched.error), /not found/i);
});

test('任务中心已经在跑时，启动按钮如实说「切到前台」而不是「正在启动」', async () => {
  const b = loadBackground({
    platform: 'win',
    native: async (host, message) => {
      if (message.type === 'open_task_center') return { ok: true };
      return { ok: true };
    },
  });
  const launched = await b.sendInternal({ type: 'launch_agent' });
  assert.equal(launched.ok, true);
  assert.equal(launched.launched, false);
});
