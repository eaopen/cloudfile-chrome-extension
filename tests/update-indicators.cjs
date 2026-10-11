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
