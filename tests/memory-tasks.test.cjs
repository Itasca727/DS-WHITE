// Mock API, actual compiled modules. No key or remote calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript')
const storage = new Map(), localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) }
const create = init => { let state = init(); return { getState: () => state, setState: next => { state = {...state,...next} } } }
let seq=0, calls=[], failAt=0, splitOnce=false
const createId = () => `id-${++seq}`
function load(file,deps) {
 const result = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true})
 assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
 const module={exports:{}}; vm.runInNewContext(result.outputText,{module,exports:module.exports,localStorage,TextEncoder,AbortController,require:id=>{if(!(id in deps))throw Error(id);return deps[id]}});return module.exports
}
const lib=load('src/services/memoryLibrary.ts',{zustand:{create},'../utils/id.js':{createId}})
const summary=load('src/services/chat/memorySummary.ts',{'../api/client.js':{streamMessage:async function*(key,body){const input=body.messages[0].content;calls.push(input);assert.ok(Buffer.byteLength(input)<=22000);if(splitOnce){splitOnce=false;throw Error('user input too long, exceeds max 32768 tokens')}if(failAt===calls.length)throw Error('network error');yield {type:'content_block_delta',delta:{type:'text_delta',text:`摘要 ${calls.length}`}};yield {type:'message_stop'}}},'./branches.js':{getVisibleMessages:s=>s.pairs},'./reply.js':{getContextRounds:x=>x,getReplyText:x=>x.text}})
const deps={zustand:{create},'../../utils/id.js':{createId},'../memoryLibrary.js':lib,'./memorySummary.js':summary}
let tasks=load('src/services/chat/memoryTasks.ts',deps)
const pair=(i,size=10)=>[{role:'user',id:`u${i}`,createdAt:i*1000,content:'甲'.repeat(size)},{id:`a${i}`,role:'assistant',status:'done',text:'乙'.repeat(size)}]
const session=(pairs,id='s')=>({id,pairs,messages:pairs.flat()})
;(async()=>{
 const long=session([pair(1,15000),pair(2,20000),pair(3,20000)])
 const batches=summary.buildSummaryBatches(long.pairs)
 assert.ok(batches.length>8);assert.ok(batches.every(x=>Buffer.byteLength(x)<=22000))
 assert.equal(batches.join('').match(/甲/g).length,55000)
 failAt=2;await assert.rejects(tasks.startMemoryJob(long,1,3,'key'),/network error/)
 assert.equal(tasks.useMemoryTasks.getState().drafts.length,1)
 assert.equal(tasks.useMemoryTasks.getState().jobs.s.done,1)
 const first=calls[0];tasks=load('src/services/chat/memoryTasks.ts',deps)
 failAt=0;splitOnce=true;await tasks.resumeMemoryJob('s','key')
 assert.ok(!tasks.useMemoryTasks.getState().jobs.s)
 assert.equal(calls.filter(x=>x===first).length,1)
 assert.equal(lib.memoryLibrarySystem(),'')
 const draft=tasks.useMemoryTasks.getState().drafts[0];tasks.acceptMemoryDraft(draft.id,false)
 assert.equal(lib.useMemoryLibrary.getState().entries[0].enabled,false)
 lib.setLibraryEnabled(true);assert.equal(lib.memoryLibrarySystem(),'')
 const initial=session([pair(10)],'auto');tasks.configureAuto(initial,true,2)
 let next=session([pair(10),pair(11)],'auto');await tasks.noteMemoryReply(next,'a11','key');await tasks.noteMemoryReply(next,'a11','key')
 assert.equal(tasks.useMemoryTasks.getState().auto.auto.pending.length,1)
 next=session([pair(10),pair(11),pair(12)],'auto');await tasks.noteMemoryReply(next,'a12','key')
 assert.equal(tasks.useMemoryTasks.getState().auto.auto.pending.length,0)
 assert.ok(tasks.useMemoryTasks.getState().drafts.some(x=>x.kind==='auto'))
 assert.equal(lib.useMemoryLibrary.getState().entries.length,1)
 assert.equal(lib.memoryLibrarySystem(),'')
 console.log('PASS V2: UTF-8 batching, no dropped input, split on length error, persistent checkpoint, resume without redoing saved batches, approval isolation, auto interval and duplicate reply protection')
})().catch(e=>{console.error(e);process.exitCode=1})
