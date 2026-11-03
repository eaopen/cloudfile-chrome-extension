const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadBackground}=require('./chrome-mock.cjs');

const CURRENT='com.cloudfile.current_agent';
const LEGACY='com.cloudfile.local_agent';
const NEXT='com.cloudfile.agent2';

const tick=()=>new Promise(r=>setImmediate(r));

test('existing update indicator survives Agent2 route discovery',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEXT)throw new Error('not installed');
    if(msg.type==='check_update')return {ok:true,version:'1.0.0',latest_version:'1.0.1',
      update_available:true,extension_latest_version:'1.0.2',extension_installed_version:'1.0.0'};
    if(msg.type==='status')return {ok:true,version:'1.0.0'};
    return {ok:true};
  }});
  b.triggerAlarm('cloudfile-update-check');
  await tick(); await tick();
  assert.equal(b.store.agent_update?.has_update,true);
  assert.equal(b.store.extension_update?.has_update,true);
  assert.equal(b.store.update_notified?.agent,'1.0.1');
  assert.equal(b.store.update_notified?.extension,'1.0.2');
  const seen=await b.sendInternal({type:'updates_seen',kind:'extension',version:'1.0.2'});
  assert.equal(seen.ok,true);
  assert.equal(b.store.update_ack?.extension,'1.0.2');
});

test('existing one-click updater still invokes the original 1.x Go host',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEXT)throw new Error('not installed');
    return {ok:true,version:'1.0.0'};
  }});
  b.store.agent_update={latest_version:'1.0.1',has_update:true};
  const response=await b.sendInternal({type:'upgrade',kind:'agent'});
  assert.equal(response.ok,true);
  assert.equal(b.store.update_verify?.kind,'agent');
  assert.equal(b.store.update_verify?.target,'1.0.1');
  const action=b.nativeCalls.filter(x=>x.message.type==='update');
  assert.equal(action.length,1);
  assert.equal(action[0].host,LEGACY);
});

test('an upgrade rejected by 1.x host never falsely reports started',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(msg.type==='update')return {ok:false,error:'blocked by policy'};
    if(msg.type==='status'&&host===NEXT)throw Error('not installed');
    return {ok:true,version:'1.0.0'};
  }});
  b.store.agent_update={latest_version:'1.0.1',has_update:true};
  const response=await b.sendInternal({type:'upgrade',kind:'agent'});
  assert.equal(response.ok,false);
  assert.match(response.error,/blocked/);
  assert.equal(b.store.update_verify,undefined);
});

test('Windows local status retains the signed update check, then clears it after activation', async()=>{
  let version='1.2.1';
  const b=loadBackground({platform:'win',native:async(host,msg)=>{
    assert.equal(host,CURRENT);
    return {ok:true,version,controller:'dotnet',update_source_set:true};
  }});
  b.store.agent_update={current_version:'1.2.1',latest_version:'1.2.2',has_update:true,notes:'signed release'};
  await b.sendInternal({type:'agent_status'});
  assert.equal(b.store.agent_update.has_update,true);
  assert.equal(b.store.agent_update.notes,'signed release');
  version='1.2.2';
  await b.sendInternal({type:'agent_status'});
  assert.equal(b.store.agent_update.has_update,false);
});

test('Windows signed bundle worker failure ends verification without another Host', async()=>{
  const b=loadBackground({platform:'win',native:async(host)=>{
    assert.equal(host,CURRENT);
    return {ok:true,version:'1.2.1',last_update_state:'failed',last_update_kind:'agent'};
  }});
  b.store.update_verify={kind:'agent',target:'1.2.2',attempts:0};
  b.triggerAlarm('cloudfile-update-verify');
  await tick();await tick();
  assert.equal(b.store.update_verify,undefined);
  assert.ok(b.nativeCalls.every(call=>call.host===CURRENT));
});

test('macOS updates use the selected Go2 Host and never Windows registration', async()=>{
  const b=loadBackground({platform:'mac',native:async(host,msg)=>{
    assert.equal(host,NEXT);
    return {ok:true,version:'2.0.1',agent_family:'agent2',capabilities:['check_update']};
  }});
  b.store.agent_update={latest_version:'2.0.2',has_update:true};
  assert.equal((await b.sendInternal({type:'upgrade',kind:'agent'})).ok,true);
  assert.equal(b.nativeCalls.find(call=>call.message.type==='update').host,NEXT);
});


test('Agent2.3 staged-but-deferred updates are not falsely reported as failed', async () => {
  const b = loadBackground({ platform: 'win', native: async(host) => {
    assert.equal(host, CURRENT);
    return {ok: true, version: '2.3.0-dev.1', agent_family:'agent2',
      last_update_kind:'agent', last_update_state:'prepared'};
  }});
  b.store.update_verify = {kind:'agent',target:'2.3.0-dev.2',attempts:2};
  b.triggerAlarm('cloudfile-update-verify');
  await tick(); await tick();
  assert.equal(b.store.update_verify, undefined);
  assert.equal(b.store.update_prepared?.target, '2.3.0-dev.2');
  assert.equal(b.store.update_notified?.agent, undefined);
});

test('extension upgrade reports the real outcome and never auto-reloads', async () => {
  // 老 Agent 不认识 upgrade_state：回 invalid native message，弹窗退回完整 status。
  // 磁盘上已经是新版本：即使 update-result 还写着 running，也算完成。
  const b = loadBackground({ platform: 'win', native: async (host, msg) => {
    if (msg.type === 'upgrade_state') return { ok: false, error: 'invalid native message' };
    if (msg.type === 'status') return { ok: true, version: '2.0.10', agent_family: 'agent2',
      extension_installed_version: '2.0.10', extension_latest_version: '2.0.10',
      last_update_kind: 'extension', last_update_state: 'running' };
    if (msg.type === 'update_extension') return { ok: true };
    return { ok: true };
  }});
  b.store.extension_update = { has_update: true, current_version: '2.0.9', latest_version: '2.0.10' };
  const accepted = await b.sendInternal({ type: 'upgrade', kind: 'extension' });
  assert.equal(accepted.ok, true);
  // 弹窗要靠 target 判断「到底升上去了没有」。
  assert.equal(accepted.target, '2.0.10');
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.10' });
  assert.equal(state.state, 'completed');
  assert.equal(state.version, '2.0.10');
  assert.ok(b.nativeCalls.some(c => c.message.type === 'status'), '老 Agent 必须退回 status');
});

test('a still-running extension upgrade keeps the popup polling', async () => {
  const b = loadBackground({ platform: 'win', native: async (host, msg) => {
    if (msg.type === 'upgrade_state') return { ok: false, error: 'invalid native message' };
    if (msg.type === 'status') return { ok: true, version: '2.0.10', agent_family: 'agent2',
      extension_installed_version: '2.0.9', last_update_kind: 'extension', last_update_state: 'running' };
    return { ok: true };
  }});
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.10' });
  assert.equal(state.ok, true);
  assert.equal(state.state, 'running');
});

test('a failed extension upgrade surfaces as failed, not as success', async () => {
  const b = loadBackground({ platform: 'win', native: async (host, msg) => {
    if (msg.type === 'upgrade_state') return { ok: false, error: 'invalid native message' };
    if (msg.type === 'status') return { ok: true, version: '2.0.10', agent_family: 'agent2',
      extension_installed_version: '2.0.9', last_update_kind: 'extension', last_update_state: 'failed',
      last_update_error: '下载扩展清单失败' };
    return { ok: true };
  }});
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.10' });
  assert.equal(state.ok, false);
  assert.equal(state.state, 'failed');
  assert.match(state.error, /失败/);
  assert.match(state.error, /下载扩展清单失败/, 'Agent 记下的失败原因要带到界面');
});

test('an unresponsive agent cannot be mistaken for a successful upgrade', async () => {
  const b = loadBackground({ platform: 'win', native: async () => { throw new Error('host gone'); } });
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.10' });
  // Agent 没响应 ≠ 升级失败：受理时它已确认过，分离进程很可能还在跑。
  // 继续 pending 等下一轮，超时文案会引导用户去扩展页核对版本。
  assert.equal(state.state, 'pending');
  assert.notEqual(state.state, 'completed');
});

test('polling uses the lightweight upgrade_state without a full status probe', async () => {
  // 2026-11-03 现场：老路径每 1.5 秒发一次 status，而 status 要拉两份更新清单
  // （各 30 秒超时），用户等到超时也看不到结果。轻量轮询必须一次 native 调用答完。
  const b = loadBackground({ platform: 'win', native: async (host, msg) => {
    if (msg.type === 'upgrade_state') return { ok: true, agent_version: '2.0.18',
      extension_installed_version: '2.0.11', last_update_kind: 'extension', last_update_state: 'running' };
    if (msg.type === 'status') throw new Error('轮询不该再走完整 status（含网络）');
    return { ok: true };
  }});
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.12' });
  assert.equal(state.state, 'running');
  assert.equal(state.version, '2.0.11');
  assert.ok(b.nativeCalls.every(c => c.message.type === 'upgrade_state'));
});

test('the lightweight upgrade_state reports completion from the on-disk version', async () => {
  const b = loadBackground({ platform: 'win', native: async (host, msg) => {
    if (msg.type === 'upgrade_state') return { ok: true, agent_version: '2.0.18',
      extension_installed_version: '2.0.12', last_update_kind: 'extension', last_update_state: 'running' };
    return { ok: true, version: '2.0.18', agent_family: 'agent2', capabilities: ['check_update'] };
  }});
  const state = await b.sendInternal({ type: 'extension_upgrade_state', target: '2.0.12' });
  // 完成判据是磁盘版本，不是 update-result 里的 running。
  assert.equal(state.state, 'completed');
  assert.equal(state.version, '2.0.12');
});
