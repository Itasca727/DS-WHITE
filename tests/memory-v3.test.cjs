const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript')
const persisted=new Map(),localStorage={getItem:k=>persisted.get(k)??null,setItem:(k,v)=>persisted.set(k,v)}
const create=init=>{let state=init();return {getState:()=>state,setState:p=>{state={...state,...p}}}}
let seq=0;const createId=()=>`test-${++seq}`
function load(file,deps={}){const out=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});assert.equal(out.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);const module={exports:{}};vm.runInNewContext(out.outputText,{module,exports:module.exports,localStorage,require:id=>{if(!(id in deps))throw Error(id);return deps[id]}});return module.exports}
persisted.set('white:memory-library:v1',JSON.stringify({enabled:true,entries:[{id:'old',text:'旧版记忆',source:'manual',enabled:true,createdAt:1,updatedAt:1}]}))
const deps={zustand:{create},'../utils/id.js':{createId}}
const lib=load('src/services/memoryLibrary.ts',deps)
const send=(session,query='')=>lib.memoryLibrarySystem(undefined,session,query)
assert.match(send(undefined),/旧版记忆/);assert.equal(send('A'),'');assert.equal(send('B'),'')
const a=lib.privateLibraryId('A'),b=lib.privateLibraryId('B')
lib.saveMemoryEntry('核心人设原文','manual',undefined,a,'core');lib.saveMemoryEntry('重要约定','manual',undefined,a,'important');lib.saveMemoryEntry('海边旅行看灯塔','manual',undefined,a,'archive');lib.saveMemoryEntry('苹果蛋糕食谱','manual',undefined,a,'archive');lib.saveMemoryEntry('独立秘密','manual',undefined,b,'core')
assert.match(send('A','灯塔'),/核心人设原文/);assert.match(send('A','灯塔'),/重要约定/);assert.match(send('A','灯塔'),/海边旅行/);assert.doesNotMatch(send('A','灯塔'),/苹果蛋糕|独立秘密|旧版记忆/);assert.doesNotMatch(send('A',''),/灯塔/);assert.doesNotMatch(send('B','灯塔'),/核心人设原文|海边旅行/)
lib.bindMemoryLibrary('B',a);assert.equal(send('B','灯塔'),send('A','灯塔'));lib.bindMemoryLibrary('B',b);assert.match(send('B'),/独立秘密/)
lib.bindMemoryLibrary('A',lib.LEGACY_LIBRARY);assert.match(send('A'),/旧版记忆/);assert.doesNotMatch(send('A'),/重要约定/)
lib.setLibraryEnabled(false);assert.equal(send('A'),'');lib.setLibraryEnabled(true)
const f=load('src/services/favorites.ts',{zustand:{create}});assert.equal(f.toggleFavorite('A','r1','对话甲','回复一'),true);assert.equal(f.toggleFavorite('B','r1','对话乙','回复二'),true);assert.equal(f.useFavorites.getState().items.length,2);assert.equal(f.toggleFavorite('A','r1','对话甲','回复一'),false);assert.equal(f.useFavorites.getState().items[0].sessionId,'B');const backup=f.exportFavorites();f.importFavorites(backup);assert.equal(f.useFavorites.getState().items.length,1);assert.equal(load('src/services/favorites.ts',{zustand:{create}}).useFavorites.getState().items.length,1)
const branch=load('src/services/chat/branches.ts');const old={id:'A',rootMessageId:'u',messages:[{id:'u',parentId:null,selectedChildId:'r2'},{id:'r1',parentId:'u',selectedChildId:'u2'},{id:'r2',parentId:'u'},{id:'u2',parentId:'r1',selectedChildId:'r3'},{id:'r3',parentId:'u2'}]};const revealed=branch.revealMessage(old,'r3');assert.equal(branch.getVisibleMessages(revealed).map(m=>m.id).join(','),'u,r1,u2,r3');assert.equal(old.messages[0].selectedChildId,'r2');assert.equal(branch.revealMessage(old,'missing'),undefined)
console.log('PASS V3: legacy migration, isolation, shared binding, local retrieval, disable, favorites persistence and dedupe, branch restoration')
