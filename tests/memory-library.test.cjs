// 不请求真实 API；使用实际 TS 模块和内存替身验证业务逻辑。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const persisted = new Map()
let failWrite = false
const localStorage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => { if (failWrite) throw Error('quota'); persisted.set(key, value) } }
const create = init => { let state = init(); return { getState: () => state, setState: next => { state = { ...state, ...next } } } }
let nextId = 0
function load(relative, dependencies) {
  const code = fs.readFileSync(path.join(root, relative), 'utf8')
  const out = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true })
  assert.deepEqual(out.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [])
  const module = { exports: {} }
  vm.runInNewContext(out.outputText, { module, exports: module.exports, localStorage, TextEncoder, require: id => { if (!(id in dependencies)) throw Error(`Unexpected dependency: ${id}`); return dependencies[id] } })
  return module.exports
}
const lib = load('src/services/memoryLibrary.ts', { zustand: { create }, '../utils/id.js': { createId: () => `id-${++nextId}` } })
assert.equal(lib.memoryLibrarySystem(), '')
lib.saveMemoryEntry('人设原文', 'manual')
assert.equal(lib.memoryLibrarySystem(), '')
lib.setLibraryEnabled(true)
assert.match(lib.memoryLibrarySystem(), /人设原文/)
const id = lib.useMemoryLibrary.getState().entries[0].id
lib.saveMemoryEntry('修订人设', 'manual', id)
assert.match(lib.memoryLibrarySystem(), /修订人设/)
assert.doesNotMatch(lib.memoryLibrarySystem(), /人设原文/)
lib.toggleMemoryEntry(id, false)
assert.equal(lib.memoryLibrarySystem(), '')
lib.saveMemoryEntry('AI 草稿内容', 'ai')
assert.match(lib.memoryLibrarySystem(), /AI 草稿内容/)
const exported = lib.exportMemoryLibrary()
assert.equal(lib.importMemoryLibrary(exported), 0)
const incoming = JSON.parse(exported)
incoming.entries = [{ ...incoming.entries[0], id: 'other', text: '导入内容', enabled: true }]
assert.equal(lib.importMemoryLibrary(JSON.stringify(incoming)), 1)
assert.doesNotMatch(lib.memoryLibrarySystem(), /导入内容/)
assert.throws(() => lib.saveMemoryEntry('x'.repeat(6001), 'manual'))
failWrite = true
assert.throws(() => lib.setLibraryEnabled(false))
assert.equal(lib.useMemoryLibrary.getState().enabled, true)
failWrite = false
lib.setLibraryEnabled(false)
assert.equal(lib.memoryLibrarySystem(), '')
lib.deleteMemoryEntry(id)
assert.equal(lib.useMemoryLibrary.getState().entries.length, 2)
const restored = load('src/services/memoryLibrary.ts', { zustand: { create }, '../utils/id.js': { createId: () => 'new' } })
assert.equal(restored.useMemoryLibrary.getState().entries.length, 2)
assert.equal(restored.memoryLibrarySystem(), '')
let sent
const fakeSession = { contextExcluded: ['excluded'], messages: [[{id:'excluded',content:'excluded secret',createdAt:0},{status:'done'}],[{id:'ok',content:'hello',createdAt:0},{status:'done',text:'world'}]] }
const summary = load('src/services/chat/memorySummary.ts', {
  '../api/client.js': { streamMessage: async function* (key, body) { sent = body; yield {type:'content_block_start',content_block:{type:'text',text:''}}; yield {type:'content_block_delta',delta:{type:'text_delta',text:'记忆草稿'}}; yield {type:'message_stop'} } },
  './branches.js': { getVisibleMessages: s => s.messages }, './reply.js': { getContextRounds: x => x, getReplyText: x => x.text }
})
;(async () => {
  assert.equal(await summary.generateMemorySummary(fakeSession, 10, 'test', new AbortController().signal), '记忆草稿')
  assert.match(sent.messages[0].content, /hello/)
  assert.doesNotMatch(sent.messages[0].content, /excluded secret/)
  assert.equal(sent.model, 'deepseek-flash')
  assert.equal(lib.useMemoryLibrary.getState().entries.length, 2)
  await assert.rejects(summary.generateMemorySummary(fakeSession, 10, '', new AbortController().signal))
  console.log('PASS: memory CRUD, switch, backup merge, persistence, quota error, summary request and draft isolation')
})().catch(error => { console.error(error); process.exitCode = 1 })
