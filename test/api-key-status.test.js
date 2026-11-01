const test = require('node:test');
const assert = require('node:assert/strict');
const {createApiKeyStatus} = require('../src/api-key-status');
const {createTextCompletion} = require('../src/text-completion');
const reply = (status=200) => ({ok:status===200,status,json:async()=>({choices:[{message:{content:'OK'}}]})});

test('key verification proves model completion, deduplicates and caches without disclosing the key',async()=>{
 let calls=0;
 const gate=createApiKeyStatus({readKey:()=> 'private-test-key',fetchImpl:async(url,init)=>{
  calls++;const body=JSON.parse(init.body);
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(body.model,'gpt-6-luna');assert.equal(body.reasoning_effort,'none');assert.equal(body.temperature,undefined);
  assert.equal(body.messages[1].content,'Key check.');return reply();
 }});
 assert.equal(gate.ready(),false);
 await Promise.all([gate.validate(),gate.validate()]);await gate.validate();
 assert.equal(calls,1);assert.equal(gate.ready(),true);
 assert.doesNotMatch(JSON.stringify(gate.status()),/private-test-key/);
 gate.reject('old-key');assert.equal(gate.ready(),true);
 gate.reject('private-test-key');assert.equal(gate.ready(),false);
});

test('missing, rejected, unfunded and unavailable keys cannot enable improvements',async()=>{
 for(const status of [401,403,404,429,500]){
  const gate=createApiKeyStatus({readKey:()=> 'test-key',fetchImpl:async()=>reply(status)});
  await gate.validate();assert.equal(gate.ready(),false);
  let calls=0;
  const completion=createTextCompletion({readKey:()=> 'test-key',keyReady:gate.ready,fetchImpl:async()=>{calls++;return reply()}});
  await assert.rejects(completion.complete({system:'test',user:'test'}),/verified/);assert.equal(calls,0);
 }
 const missing=createApiKeyStatus({readKey:()=>'',fetchImpl(){throw Error('must not call')}});
 await missing.validate();assert.equal(missing.status().state,'missing');
 const offline=createApiKeyStatus({readKey:()=> 'test-key',fetchImpl:async()=>{throw Error('offline')}});
 await offline.validate();assert.equal(offline.status().state,'unavailable');
});

test('late validation of a replaced key cannot overwrite the current key status',async()=>{
 let key='old',finish;
 const gate=createApiKeyStatus({readKey:()=>key,fetchImpl:async()=>key==='old'?await new Promise(r=>finish=r):reply(401)});
 const old=gate.validate();key='new';await gate.validate();finish(reply());await old;
 assert.equal(gate.status().state,'invalid');assert.equal(gate.ready(),false);
 key='';await gate.validate();assert.equal(gate.status().state,'missing');
});

test('Luna cleanup uses one compatible request and preserves medium reasoning quality',async()=>{
 let calls=0;
 const completion=createTextCompletion({readKey:()=> 'test-key',keyReady:()=>true,fetchImpl:async(url,init)=>{
  calls++;const body=JSON.parse(init.body);
  assert.equal(body.reasoning_effort,'medium');assert.equal(body.temperature,undefined);assert.equal(body.store,false);
  return reply();
 }});
 await completion.complete({kind:'dictation-cleanup',system:'test',user:'test',temperature:0});assert.equal(calls,1);
});

test('temporary network and service errors retry once; saved keys can be rechecked without saving',async()=>{
 for(const failure of [()=>{throw Object.assign(new Error('offline'),{cause:{code:'ECONNRESET'}})},()=>reply(503),()=>({ok:true,status:200,json:async()=>{throw SyntaxError('not JSON')}})]){
  let calls=0;const gate=createApiKeyStatus({readKey:()=> 'test-key',retryDelay:0,fetchImpl:async()=>++calls===1?failure():reply()});
  await gate.validate();assert.equal(calls,2);assert.equal(gate.ready(),true);
 }
 let available=false,calls=0;
 const gate=createApiKeyStatus({readKey:()=> 'unchanged-key',retryDelay:0,fetchImpl:async()=>{calls++;if(!available)throw Error('offline');return reply()}});
 await gate.validate();assert.equal(gate.status().state,'unavailable');assert.doesNotMatch(gate.status().message,/save.*again/i);
 available=true;await gate.validate(true);assert.equal(gate.ready(),true);assert.equal(calls,3);
});

test('certificates, rejected keys, quota and malformed replies retain distinct safe statuses',async()=>{
 const cases=[
  [()=>{throw Object.assign(new Error('secret-key'),{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}})},'unavailable',/secure connection/,1],
  [()=>reply(401),'invalid',/rejected/,1],
  [()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota'}})}),'unavailable',/credit/,1],
  [()=>({ok:true,status:200,json:async()=>({choices:[]})}),'unavailable',/incomplete verification response/,2],
  [()=>{throw Object.assign(new Error('secret-key'),{name:'TimeoutError'})},'unavailable',/timed out/,2]
 ];
 for(const [failure,state,message,expected] of cases){let calls=0;const gate=createApiKeyStatus({readKey:()=> 'secret-key',retryDelay:0,fetchImpl:async()=>{calls++;return failure()}});await gate.validate();assert.equal(gate.status().state,state);assert.match(gate.status().message,message);assert.doesNotMatch(JSON.stringify(gate.status()),/secret-key/);assert.equal(calls,expected);assert.equal(gate.ready(),false)}
});
