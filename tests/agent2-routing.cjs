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

test('Windows sends status, sessions, local open and updates only to its fixed Host', async () => {
  const b = loadBackground({platform:'win', native:async(host,msg)=>{
    assert.equal(host,WINDOWS);
    return {ok:true,version:'1.2.1',agent_family:'agent1',capabilities:['open_uri','open_session']};
  }});
  await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'opaque'});
  await b.sendExternal({type:'open_uri',uri:'cloudfile-open://v1/open?instance=https%3A%2F%2Fetech.example&session=11111111-1111-4111-8111-111111111111&ticket=abc'});
  b.store.agent_update={latest_version:'1.2.2'};
  await b.sendInternal({type:'upgrade',kind:'agent'});
  const status=await b.sendInternal({type:'agent_status'});
  assert.equal(status.selected_host,WINDOWS);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[WINDOWS,WINDOWS,WINDOWS]);
});

test('macOS Go2 takes open_session directly; an unimplemented open_uri has no fallback', async () => {
  const b=loadBackground({native:async(host,msg)=>{
    if(host===NEW&&msg.type==='status')return {ok:true,version:'2.0.1',agent_family:'agent2',platform:'darwin',capabilities:['open_session']};
    if(msg.type==='status')throw Error('Host missing');
    if(msg.type==='open_uri')return {ok:false,error:'unsupported operation'};
    return {ok:true};
  }});
  assert.equal((await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'opaque'})).ok,true);
  const result=await b.sendExternal({type:'open_uri',uri:'cloudfile-open://v1/open?instance=https%3A%2F%2Fetech.example&session=11111111-1111-4111-8111-111111111111&ticket=a'});
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
  assert.equal((await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'opaque'})).ok,true);
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
  const reply=await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'consumable'});
  assert.equal(reply.ok,false);
  assert.match(reply.error,/lost reply/);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[NEW]);
  assert.equal((await b.sendExternal({type:'checkout_commit',intent:'untrusted'})).ok,false);
  assert.deepEqual(actionCalls(b).map(call=>call.host),[NEW]);
});

test('Windows never probes Go Hosts when its fixed Host is missing', async()=>{
  const b=loadBackground({platform:'win',native:async(host)=>{
    assert.equal(host,WINDOWS); throw Error('missing');
  }});
  assert.equal((await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'one-use'})).ok,false);
  assert.equal((await b.sendInternal({type:'agent_status'})).ok,false);
  assert.deepEqual(actionCalls(b),[]);
});

test('a future Windows Go controller uses the same Host ID', async()=>{
  const b=loadBackground({platform:'win',native:async(host)=>{
    assert.equal(host,WINDOWS);
    return {ok:true,version:'2.1.0',agent_family:'agent2',controller:'go'};
  }});
  assert.equal((await b.sendInternal({type:'agent_status'})).version,'2.1.0');
  assert.equal((await b.sendExternal({type:'open_session',server:'https://etech.example/app',ticket:'opaque'})).ok,true);
});
