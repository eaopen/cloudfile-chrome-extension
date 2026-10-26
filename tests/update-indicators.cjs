const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadBackground}=require('./chrome-mock.cjs');

const CURRENT='com.cloudfile.current_agent';
const NEXT='com.cloudfile.agent2';

const tick=()=>new Promise(r=>setImmediate(r));

test('existing update indicator survives Agent2 route discovery',async()=>{
  const b=loadBackground({platform:'win',native:async(host,msg)=>{
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

test('existing one-click updater still invokes the existing Windows host',async()=>{
  const b=loadBackground({platform:'win',native:async(host,msg)=>{
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
  assert.equal(action[0].host,CURRENT);
});

test('an upgrade rejected by 1.x host never falsely reports started',async()=>{
  const b=loadBackground({platform:'win',native:async(host,msg)=>{
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

test('macOS updates use the selected Rust Host and never Windows registration', async()=>{
  const b=loadBackground({platform:'mac',native:async(host,msg)=>{
    assert.equal(host,NEXT);
    return {ok:true,version:'2.0.1',agent_family:'agent2',capabilities:['check_update']};
  }});
  b.store.agent_update={latest_version:'2.0.2',has_update:true};
  assert.equal((await b.sendInternal({type:'upgrade',kind:'agent'})).ok,true);
  assert.equal(b.nativeCalls.find(call=>call.message.type==='update').host,NEXT);
});

test('non-Windows extension upgrade without a source offers manual setup and sends no update', async () => {
  const b = loadBackground({ platform: 'mac', native: async (host) => {
    assert.equal(host, NEXT);
    return { ok: true, version: '2.2.0', agent_family: 'agent2', update_source_set: false };
  }});
  b.store.extension_update = { latest_version: '2.0.3', has_update: true };
  assert.equal((await b.sendInternal({ type: 'agent_status' })).extension_upgrade_allowed, false);
  const result = await b.sendInternal({ type: 'upgrade', kind: 'extension' });
  assert.equal(result.ok, false);
  assert.match(result.error, /未配置更新源/);
  assert.equal(b.nativeCalls.filter(c => c.message.type === 'update_extension').length, 0);
  assert.equal(b.store.update_verify, undefined);
});

test('Windows and unavailable OS detection preserve the existing extension updater', async () => {
  for (const options of [{ platform: 'win' }, { getPlatformInfo: async () => { throw Error('unavailable'); } }]) {
    const b = loadBackground({ ...options, native: async (host) => {
      assert.equal(host, CURRENT);
      return { ok: true, version: '1.2.1', update_source_set: false };
    }});
    b.store.extension_update = { latest_version: '2.0.3', has_update: true };
    const status = await b.sendInternal({ type: 'agent_status' });
    assert.equal(status.windows_platform, true);
    assert.equal(status.extension_upgrade_allowed, true);
    assert.equal((await b.sendInternal({ type: 'upgrade', kind: 'extension' })).ok, true);
    assert.equal(b.nativeCalls.filter(c => c.message.type === 'update_extension').length, 1);
  }
});

test('configured macOS extension updater continues using the macOS Host', async () => {
  const b = loadBackground({ platform: 'mac', native: async (host) => {
    assert.equal(host, NEXT);
    return { ok: true, version: '2.2.0', agent_family: 'agent2', update_source_set: true };
  }});
  b.store.extension_update = { latest_version: '2.0.3', has_update: true };
  assert.equal((await b.sendInternal({ type: 'upgrade', kind: 'extension' })).ok, true);
  assert.equal(b.nativeCalls.filter(c => c.message.type === 'update_extension').length, 1);
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

test('Rust upgrade tracking uses its installed build while protocol version stays unchanged', async () => {
  for (const platform of ['win', 'mac', 'linux']) {
    let build = '2.0.2';
    const host = platform === 'win' ? CURRENT : NEXT;
    const b = loadBackground({ platform, native: async (selected, msg) => {
      assert.equal(selected, host);
      return { ok:true, version:'2.2.0', build_version:build, agent_family:'agent2', capabilities:['check_update'] };
    }});
    b.store.agent_update = {latest_version:'2.0.3', has_update:true};
    const status = await b.sendInternal({type:'agent_status'});
    assert.equal(status.version, '2.2.0', 'protocol negotiation must not change');
    assert.equal(b.store.agent_update.current_version, '2.0.2');
    assert.equal(b.store.agent_update.has_update, true);
    b.store.update_verify = {kind:'agent',target:'2.0.3',attempts:0};
    b.triggerAlarm('cloudfile-update-verify');
    await tick(); await tick();
    assert.equal(b.store.update_verify?.attempts, 1, 'protocol 2.2.0 cannot confirm build 2.0.3');
    build = '2.0.3';
    b.triggerAlarm('cloudfile-update-verify');
    await tick(); await tick();
    assert.equal(b.store.update_verify, undefined);
    assert.equal(b.store.agent_update.has_update, false);
  }
});

test('existing Windows version and updater behavior ignore unrelated build metadata', async () => {
  const b = loadBackground({platform:'win', native:async(host)=>{
    assert.equal(host,CURRENT);
    return {ok:true,version:'1.2.1',build_version:'99.0.0',agent_family:'agent1'};
  }});
  b.store.agent_update = {latest_version:'1.2.2',has_update:true};
  await b.sendInternal({type:'agent_status'});
  assert.equal(b.store.agent_update.current_version,'1.2.1');
  assert.equal(b.store.agent_update.has_update,true);
  b.store.update_verify = {kind:'agent',target:'1.2.2',attempts:0};
  b.triggerAlarm('cloudfile-update-verify');
  await tick(); await tick();
  assert.equal(b.store.update_verify?.attempts,1);
});
