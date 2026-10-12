const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBackground } = require('./chrome-mock.cjs');

const GO2 = 'com.cloudfile.agent2';
const WINDOWS = 'com.cloudfile.current_agent';
const taskID = 'a'.repeat(64);
const modes = ['task_summary', 'focus_task'];

function fixture({ platform = 'mac', capabilities = modes } = {}) {
  return loadBackground({ platform, native: async (host, message) => {
    if (message.type === 'status') {
      if (platform === 'mac' && host !== GO2) throw Error('old host must not be used');
      if (platform === 'win' && host !== WINDOWS) throw Error('wrong Windows Host');
      return {ok: true, version: platform === 'win' ? '1.2.3' : '2.0.3',
        agent_family: 'agent2', capabilities};
    }
    if (message.type === 'task_summary') return {ok:true,tasks:[{
      task_id:taskID,file_name:'report.docx',mode:'local-edit',local_changed:true,
      needs_review:false, working_copy:'/private/never-return',device_id:'secret-device',
      checkout_token:'secret',pending_intent:{id:'secret'},
    }]};
    if (message.type === 'focus_task') return {ok: true, focused: true};
    return {ok: false, error: 'unexpected action'};
  }});
}

test('unsupported host never receives task calls or upload actions', async () => {
  const b = fixture({capabilities:['open_session']});
  assert.equal((await b.sendInternal({type:'agent_task_summary'})).ok,false);
  assert.equal((await b.sendInternal({type:'agent_focus_task',task_id:taskID})).ok,false);
  assert.deepEqual(b.nativeCalls.filter(c=>c.message.type!=='status'),[]);
});

test('task summary emits bounded nonsecret fields from the same trusted Agent2 host',async()=>{
  const b=fixture();
  const reply=await b.sendInternal({type:'agent_task_summary'});
  assert.equal(reply.ok,true);
  assert.equal(reply.tasks.length,1);
  assert.deepEqual(Object.keys(reply.tasks[0]).sort(),
    ['file_name','local_changed','mode','needs_review','task_id'].sort());
  assert.equal(JSON.stringify(reply).includes('/private'),false);
  const destinations=b.nativeCalls.filter(c=>c.message.type==='task_summary');
  assert.equal(destinations.length,1);
  assert.equal(destinations[0].host,GO2);
});

test('task location validates local opaque ID and is never an upload',async()=>{
  const b=fixture({platform:'win'});
  const bad=await b.sendInternal({type:'agent_focus_task',task_id:'../../etc/passwd'});
  assert.equal(bad.ok,false);
  assert.equal(b.nativeCalls.filter(c=>c.message.type==='focus_task').length,0);
  const good=await b.sendInternal({type:'agent_focus_task',task_id:taskID});
  assert.equal(good.ok,true);
  assert.equal(b.nativeCalls.filter(c=>c.message.type==='focus_task').length,1);
  assert.equal(b.nativeCalls.find(c=>c.message.type==='focus_task').host,WINDOWS);
  assert.equal((await b.sendExternal({type:'agent_focus_task',task_id:taskID})),undefined);
});

test('no fallback to legacy Host after an unknown Go2 summary result',async()=>{
  const b=loadBackground({native:async(host,message)=>{
    if(host===GO2&&message.type==='status')return {
      ok:true,version:'2.0.3',agent_family:'agent2',capabilities:modes,
    };
    if(message.type==='task_summary')throw Error('reply lost');
    return {ok:true,version:'1.0.1'};
  }});
  const result=await b.sendInternal({type:'agent_task_summary'});
  assert.equal(result.ok,false);
  assert.deepEqual(b.nativeCalls.filter(c=>c.message.type==='task_summary').map(c=>c.host),[GO2]);
});

test('session-scoped IDs are accepted but arbitrary path IDs are rejected', async () => {
  const id = 'session-' + 'b'.repeat(64);
  const b = fixture({platform:'win'});
  const reply = await b.sendInternal({type:'agent_focus_task',task_id:id});
  assert.equal(reply.ok,true);
  assert.equal(b.nativeCalls.some(c=>c.message.type==='focus_task' && c.message.task_id===id),true);
  assert.equal((await b.sendInternal({type:'agent_focus_task',task_id:'session-../../tmp'})).ok,false);
});
