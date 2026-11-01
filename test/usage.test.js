const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const flow=require('../src/flow');
const {createStore}=require('../src/store');
const {createTextCompletion}=require('../src/text-completion');
const {createDictationCleanup,legacyDictationUsage}=require('../src/dictation-cleanup');
const {commitDictation}=require('../src/dictation');

test('dictation usage captures API token totals including reasoning and cached input before validation',async()=>{
 for(const mode of ['fillers','polished']){
  const store=createStore(':memory:');store.updateSettings({dictationCleanupEnabled:true,dictationCleanupMode:mode});
  const completion=createTextCompletion({readKey:()=> 'test-key',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"text":"Bitte nicht absagen um 14 Uhr."}'}}],usage:{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:20},completion_tokens_details:{reasoning_tokens:30}}})})});
  const cleanup=createDictationCleanup({store,completion});
  const original='Ähm, bitte nicht absagen um 14 Uhr.';
  await commitDictation({store,cleanup,pasteText:async()=>{}},original,{text:original,usedPhrases:[],followUps:[]},{paste:true,sttEngine:'parakeet'});
  const [row]=store.listDictationUsage();assert.equal(row.mode,mode);assert.equal(row.prompt_tokens,100);assert.equal(row.completion_tokens,50);assert.equal(row.cached_tokens,20);assert.equal(row.cost_usd,0.000033);assert.equal(row.tokens_estimated,false);
  assert.equal(row.run_id,store.listHistory()[0].cleanup_run_id);
  assert.doesNotMatch(JSON.stringify(row),/absagen|Ähm|system|user/);
  assert.equal(legacyDictationUsage(store.listHistory()).length,0,'Metered history is not counted twice');
 }
});

test('rejected and late cancelled model outputs still retain consumed usage; raw mode consumes none',async()=>{
 const store=createStore(':memory:');store.updateSettings({dictationCleanupEnabled:true,dictationCleanupMode:'fillers'});
 let finish;
 const completion={selection:()=>({provider:'openai',model:'gpt-6-luna'}),complete:()=>new Promise(r=>finish=r)};
 const cleanup=createDictationCleanup({store,completion});
 let pending=cleanup.clean('Ähm, bitte nicht absagen.');finish({text:'invalid JSON',usage:{promptTokens:100,completionTokens:10}});
 assert.equal((await pending).status,'fallback');assert.equal(store.listDictationUsage().length,1);
 pending=cleanup.clean('Ähm, bitte nicht absagen.');cleanup.cancel();finish({text:'{"text":"Bitte nicht absagen."}',usage:{promptTokens:200,completionTokens:20}});
 assert.equal((await pending).status,'raw');assert.equal(store.listDictationUsage().length,2);
 store.updateSettings({dictationCleanupMode:'raw'});await cleanup.clean('Unchanged.');assert.equal(store.listDictationUsage().length,2);
});

test('combined API report sums notes and both dictation modes without counting chunks as extra runs',()=>{
 const now=new Date(2026,10,1,12),date=now.toISOString();
 const notes=[{kind:'snapshot',pad_id:'n',seq:1,content:'one two three four',created_at:date},
 {kind:'improve',provider:'openai',pad_id:'n',seq:2,content:'done',created_at:date,words:4,model:'gpt-6-luna',prompt_tokens:1000,completion_tokens:500,cost_usd:0.00035},
 {kind:'improve',provider:'local',pad_id:'l',seq:3,created_at:date,words:100,model:'qwen2.5-3b-instruct-q4',prompt_tokens:1000,completion_tokens:500,cost_usd:0}];
 const rows=[
 {id:'a',run_id:'clean',provider:'openai',mode:'fillers',created_at:date,words:4,prompt_tokens:100,completion_tokens:50,cached_tokens:0,model:'gpt-6-luna'},
 {id:'b',run_id:'clean',provider:'openai',mode:'fillers',created_at:date,words:6,prompt_tokens:200,completion_tokens:100,cached_tokens:0,model:'gpt-6-luna'},
 {id:'c',run_id:'polish',provider:'openai',mode:'polished',created_at:date,words:8,prompt_tokens:80,completion_tokens:20,cached_tokens:0,model:'gpt-6-luna'},
 {id:'old',run_id:'old',provider:'openai',created_at:new Date(2026,8,1).toISOString(),words:900,prompt_tokens:50000,completion_tokens:1000},
 {id:'local',provider:'local',created_at:date,words:900,prompt_tokens:50000,completion_tokens:1000}];
 const report=flow.noteAndDictationUsageReport(notes,rows,now);
 assert.equal(report.days.length,30);assert.equal(report.words,22);assert.equal(report.tokens,2050);assert.equal(report.costUsd,0.000473);
 assert.equal(report.noteChanges,1);assert.equal(report.dictations,2);assert.equal(report.changes,3);assert.equal(report.estimated,false);
 assert.equal(report.days[29].changes,3);assert.equal(report.days[29].tokens,2050);
});

test('legacy successful cloud cleanup is estimated with its actual prompt, excluding raw, local and metered rows',()=>{
 const now=new Date();
 const base={id:'legacy',created_at:now.toISOString(),cleanup_status:'cleaned',cleanup_provider:'openai',cleanup_mode:'polished',cleanup_model:'gpt-6-luna',prepared_text:'Ähm, bitte nicht absagen um 14 Uhr.',formatted_text:'Bitte nicht absagen um 14 Uhr.'};
 const rows=legacyDictationUsage([base,{...base,id:'raw',cleanup_status:'raw'},{...base,id:'local',cleanup_provider:'local'},{...base,id:'metered',cleanup_run_id:'run'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].tokens_estimated,true);assert.ok(rows[0].prompt_tokens>0);
 const report=flow.noteAndDictationUsageReport([],rows,now);assert.equal(report.estimated,true);assert.equal(report.dictations,1);assert.ok(report.costUsd>0);
});

test('usage survives persistence and transcript deletion without retaining dictation content',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openflow-usage-'));
 try{
  const file=path.join(dir,'data.json');const store=createStore(file);
  const history=store.addHistory({asr_text:'private dictation'});
  store.addDictationUsage({run_id:'r',provider:'openai',model:'gpt-6-luna',mode:'fillers',words:2,promptTokens:100,completionTokens:20,cachedTokens:0,costUsd:0.00002,tokensEstimated:false});
  store.deleteHistory(history.id);const loaded=createStore(file);
  assert.equal(loaded.listDictationUsage().length,1);assert.equal(loaded.listHistory().length,0);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/private dictation/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
