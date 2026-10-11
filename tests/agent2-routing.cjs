const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBackground } = require('./chrome-mock.cjs');

const NEW = 'com.cloudfile.agent2';
const WINDOWS = 'com.cloudfile.current_agent';
const OLD_GO = 'com.cloudfile.local_agent';
const actionCalls = b => b.nativeCalls.filter(item =>
  item.message.type !== 'status' && item.message.type !== 'check_update');
function fixture(capabilities = ['open_session', 'open_workspace','query_local_file','query_local_folder']) {
  return loadBackground({ native: async (host, message) => {
    if (host === NEW && message.type === 'status') return {
      ok: true, version: '2.0.1', agent_family:'agent2', platform:'darwin', capabilities,
    };
    if (message.type === 'status') return {ok:true,version:'1.0.1'};
    return {ok:true};
  }});
}

test('Agent2 2.0.1 is first for declared Go capabilities; Windows .NET remains owner of open_uri', async () => {
  const b=fixture();
  const session=await b.sendExternal({
    type:'open_session', protocol:'cloudfile-local/v2', server:'https://etech.example',
    ticket:'opaque', expires_at:4102444800,
  });
  assert.equal(session.ok,true);
  const query=await b.sendExternal({type:'query_local_folder',repo_id:'repo',mode:'local-edit'});
  assert.equal(query.ok,true);
  const uri=await b.sendExternal({type:'open_uri',uri:'cloudfile-open://v1/open?ticket=abc'});
  assert.equal(uri.ok,true);
  assert.deepEqual(actionCalls(b).map(call => call.host),[NEW,NEW,WINDOWS]);
  const status=await b.sendInternal({type:'agent_status'});
  assert.equal(status.selected_family,'agent2');
  assert.equal(status.version,'2.0.1');
});

test('macOS Go2 takes open_session directly; an unimplemented open_uri has no fallback', async () => {
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEW&&msg.type==='status')return {ok:true,version:'2.0.1',agent_family:'agent2',platform:'darwin',capabilities:['open_session']};
    if(msg.type==='status')throw Error('Host missing');
    return {ok:true};
  }});
  assert.equal((await b.sendExternal({type:'open_session',ticket:'opaque'})).ok,true);
  const result=await b.sendExternal({type:'open_uri',uri:'cloudfile-open://v1/open?ticket=a'});
  assert.equal(result.ok,false);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[NEW]);
});

test('old Go 1.x remains usable if Agent2 is absent',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEW)throw Error('Agent2 absent');
    if(host===WINDOWS)throw Error('Windows .NET absent');
    if(host===OLD_GO&&msg.type==='status')return {ok:true,version:'1.0.1'};
    return {ok:true};
  }});
  assert.equal((await b.sendExternal({type:'open_session',ticket:'opaque'})).ok,true);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[OLD_GO]);
});

test('unknown Agent2 result never falls back to another host and commits remain closed',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(msg.type==='status')return host===NEW
      ? {ok:true,version:'2.0.1',agent_family:'agent2',capabilities:['open_session']}
      : {ok:true,version:'1.0.1'};
    if(host===NEW)throw Error('lost reply');
    return {ok:true};
  }});
  const reply=await b.sendExternal({type:'open_session',ticket:'consumable'});
  assert.equal(reply.ok,false);
  assert.match(reply.error,/lost reply/);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[NEW]);
  assert.equal(await b.sendExternal({type:'checkout_commit',intent:'untrusted'}),undefined);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[NEW]);
});

test('new extension retains old Agent1 update probe without forcing a downgrade',async()=>{
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEW&&msg.type==='status')return {ok:true,version:'2.0.1',agent_family:'agent2',capabilities:['open_session']};
    if(msg.type==='check_update')return {ok:true,version:'1.0.1',update_available:false,extension_latest_version:'1.0.1'};
    if(msg.type==='status')return {ok:true,version:'1.0.1'};
    return {ok:true};
  }});
  b.triggerAlarm('cloudfile-update-check');
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.store.agent_update?.current_version,'1.0.1');
  assert.equal(b.store.extension_update?.latest_version,'1.0.1');
});
