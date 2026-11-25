import { create } from 'zustand'
import { createId } from '../utils/id.js'

export type MemoryTier = 'core' | 'important' | 'archive'
export type MemoryEntry = { id: string; text: string; source: 'manual' | 'ai'; enabled: boolean; createdAt: number; updatedAt: number; libraryId: string; tier: MemoryTier }
export type LibraryData = { enabled: boolean; entries: MemoryEntry[]; libraries: { id: string; name: string }[]; bindings: Record<string, string> }
const KEY = 'white:memory-library:v1'
export const LEGACY_LIBRARY = 'legacy'
export const MAX_MEMORY_CHARS = 24000
export const MAX_ARCHIVE_CHARS = 6000
export const MAX_ENTRY_CHARS = 6000
export const MAX_ENTRIES = 2000
export const TIER_NAMES: Record<MemoryTier, string> = { core: '核心人设', important: '重要记忆', archive: '历史档案' }
const empty = (): LibraryData => ({ enabled: false, entries: [], libraries: [{ id: LEGACY_LIBRARY, name: '原有共享记忆库' }], bindings: {} })
export const privateLibraryId = (sessionId: string) => `private:${sessionId}`
export const libraryForSession = (sessionId?: string, data: LibraryData = useMemoryLibrary.getState()) => sessionId ? data.bindings[sessionId] ?? privateLibraryId(sessionId) : LEGACY_LIBRARY
export const libraryName = (id: string, data: LibraryData = useMemoryLibrary.getState()) => data.libraries.find(l => l.id === id)?.name ?? (id.startsWith('private:') ? '独立记忆库' : id)
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !['__proto__','constructor','prototype'].includes(id)
export const validateLibrary = (value: unknown): LibraryData => {
  if (!value || typeof value !== 'object') throw new Error('记忆库格式无效')
  const data = value as Partial<LibraryData>
  if (typeof data.enabled !== 'boolean' || !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) throw new Error('记忆库格式或数量无效')
  const libraries = empty().libraries
  if (data.libraries !== undefined) {
    if (!Array.isArray(data.libraries) || data.libraries.length > 1000) throw new Error('记忆库分组无效')
    const groupIds = new Set<string>()
    for (const group of data.libraries) {
      if (!group || !validId(group.id) || groupIds.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 100) throw new Error('记忆库分组无效')
      groupIds.add(group.id)
      if (group.id === LEGACY_LIBRARY) libraries[0] = { id: group.id, name: group.name }
      else libraries.push({ id: group.id, name: group.name })
    }
  }
  const ids = new Set<string>()
  const entries = data.entries.map((item): MemoryEntry => {
    if (!item || !validId(item.id) || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_ENTRY_CHARS || !['manual', 'ai'].includes(item.source) || typeof item.enabled !== 'boolean' || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) throw new Error('记忆条目无效或超出长度限制')
    ids.add(item.id)
    const libraryId = item.libraryId ?? LEGACY_LIBRARY
    const tier = item.tier ?? 'important'
    if (!validId(libraryId) || !Object.hasOwn(TIER_NAMES, tier)) throw new Error('记忆分组或层级无效')
    if (!libraries.some(l => l.id === libraryId)) libraries.push({ id: libraryId, name: libraryId.startsWith('private:') ? '独立记忆库 ' + libraryId.slice(-6) : libraryId })
    return { id: item.id, text: item.text.trim(), source: item.source, enabled: item.enabled, createdAt: item.createdAt, updatedAt: item.updatedAt, libraryId, tier }
  })
  const bindings: Record<string, string> = Object.create(null)
  if (data.bindings !== undefined) {
    if (!data.bindings || typeof data.bindings !== 'object' || Array.isArray(data.bindings)) throw new Error('会话绑定无效')
    for (const [sessionId, group] of Object.entries(data.bindings)) {
      if (!validId(sessionId) || !validId(group) || !libraries.some(l => l.id === group)) throw new Error('会话绑定无效')
      bindings[sessionId] = group
    }
  }
  for (const group of libraries) {
    if (entries.filter(e => e.libraryId === group.id && e.enabled && e.tier !== 'archive').reduce((n,e) => n+e.text.length,0) > MAX_MEMORY_CHARS) throw new Error('此库启用的固定记忆超过 24000 字符，请停用部分记忆或转为历史档案')
  }
  return { enabled: data.enabled, entries, libraries, bindings }
}
const load = (): LibraryData => {
  try { const raw = localStorage.getItem(KEY); return raw ? validateLibrary(JSON.parse(raw)) : empty() } catch { return empty() }
}
export const useMemoryLibrary = create<LibraryData>(() => load())
const commit = (data: LibraryData) => { const valid = validateLibrary(data); localStorage.setItem(KEY, JSON.stringify(valid)); useMemoryLibrary.setState(valid) }
export const setLibraryEnabled = (enabled: boolean) => commit({ ...useMemoryLibrary.getState(), enabled })
const ensureLibrary = (data: LibraryData, id: string, name?: string) => data.libraries.some(l=>l.id===id) ? data.libraries : [...data.libraries,{id,name:name?.trim() || libraryName(id,data)+(id.startsWith('private:') ? ' '+id.slice(-6):'')}]
export const registerMemoryLibrary = (id: string) => { const data=useMemoryLibrary.getState(); if(!data.libraries.some(l=>l.id===id)) commit({...data,libraries:ensureLibrary(data,id)}) }
export const createMemoryLibrary = (name: string) => { const data=useMemoryLibrary.getState(); const id=createId(); commit({...data,libraries:ensureLibrary(data,id,name)}); return id }
export const renameMemoryLibrary = (id: string, name: string) => { const data=useMemoryLibrary.getState(); if (!name.trim()) throw new Error('请输入库名称'); commit({...data,libraries:ensureLibrary(data,id).map(l=>l.id===id?{...l,name:name.trim()}:l)}) }
export const bindMemoryLibrary = (sessionId: string, libraryId: string) => { const data=useMemoryLibrary.getState(); if (libraryId!==privateLibraryId(sessionId) && !data.libraries.some(l=>l.id===libraryId)) throw new Error('记忆库不存在'); commit({...data,libraries:ensureLibrary(data,libraryId),bindings:{...data.bindings,[sessionId]:libraryId}}) }
export const saveMemoryEntry = (text: string, source: MemoryEntry['source'], id?: string, libraryId = LEGACY_LIBRARY, tier: MemoryTier = 'important') => {
  const data=useMemoryLibrary.getState(), now=Date.now()
  if (id && !data.entries.some(e=>e.id===id)) throw new Error('该记忆已不存在')
  const entries=id?data.entries.map(e=>e.id===id?{...e,text:text.trim(),tier,libraryId,updatedAt:now}:e):[...data.entries,{id:createId(),text:text.trim(),source,enabled:true,createdAt:now,updatedAt:now,libraryId,tier}]
  commit({...data,libraries:ensureLibrary(data,libraryId),entries})
}
export const saveMemoryDraftEntry = (id: string, text: string, enabled: boolean, libraryId = LEGACY_LIBRARY, tier: MemoryTier = 'important') => {
  const data=useMemoryLibrary.getState(); if(data.entries.some(e=>e.id===id || (e.libraryId===libraryId&&e.tier===tier&&e.text===text.trim())))return
  const now=Date.now(); commit({...data,libraries:ensureLibrary(data,libraryId),entries:[...data.entries,{id,text:text.trim(),source:'ai',enabled,createdAt:now,updatedAt:now,libraryId,tier}]})
}
export const toggleMemoryEntry = (id: string, enabled: boolean) => {const data=useMemoryLibrary.getState();commit({...data,entries:data.entries.map(e=>e.id===id?{...e,enabled,updatedAt:Date.now()}:e)})}
export const deleteMemoryEntry = (id: string) => {const data=useMemoryLibrary.getState();commit({...data,entries:data.entries.filter(e=>e.id!==id)})}
export const exportMemoryLibrary = () => JSON.stringify({version:3,...useMemoryLibrary.getState()},null,2)
export const importMemoryLibrary = (raw: string) => {
  const parsed=JSON.parse(raw); if (![1,3].includes(parsed?.version)) throw new Error('不支持的记忆库版本')
  const imported=validateLibrary(parsed), current=useMemoryLibrary.getState()
  const ids=new Set(current.entries.map(e=>e.id)), texts=new Set(current.entries.map(e=>JSON.stringify([e.libraryId,e.tier,e.text])))
  const additions=imported.entries.filter(e=>!ids.has(e.id)&&!texts.has(JSON.stringify([e.libraryId,e.tier,e.text]))).map(e=>({...e,enabled:false}))
  const libraries=[...current.libraries,...imported.libraries.filter(l=>!current.libraries.some(x=>x.id===l.id))]
  commit({...current,libraries,entries:[...current.entries,...additions]}); return additions.length
}
// 中文二元词 + 英文词；本地词法检索，非向量/语义检索，不调用额外 API。
const terms = (text: string) => {
  const result = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]{2,}/gu) ?? []) {
    if (/\p{Script=Han}/u.test(word)) { const chars=Array.from(word); for(let i=0;i+1<chars.length;i++) result.add(chars[i]!+chars[i+1]!) }
    else result.add(word)
  }
  for(const stop of ['我们','你们','他们','这个','那个','什么','怎么','可以','就是','一个','一下','然后','现在','时候','the','and','you','that','with','this']) result.delete(stop)
  return result
}
export const retrieveArchive = (entries: MemoryEntry[], query: string) => {
  const q=terms(query.slice(-12000)); if(!q.size)return []
  const docs=entries.map(entry=>({entry,terms:terms(entry.text)})); const df=new Map<string,number>()
  for(const doc of docs) for(const term of doc.terms) if(q.has(term))df.set(term,(df.get(term)??0)+1)
  const ranked=docs.map(doc=>({entry:doc.entry,score:[...q].reduce((s,t)=>s+(doc.terms.has(t)?Math.log(1+(docs.length+1)/(1+(df.get(t)??0))):0),0)/Math.sqrt(Math.max(1,doc.terms.size))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.entry.updatedAt-a.entry.updatedAt)
  let used=0; const result:MemoryEntry[]=[]
  for(const {entry} of ranked){if(result.length>=5)break;if(used+entry.text.length>MAX_ARCHIVE_CHARS)continue;used+=entry.text.length;result.push(entry)}
  return result
}
export const memoryLibrarySystem = (data: LibraryData = useMemoryLibrary.getState(), sessionId?: string, query = '') => {
  if(!data.enabled)return ''
  const entries=data.entries.filter(e=>e.enabled&&e.libraryId===libraryForSession(sessionId,data))
  const core=entries.filter(e=>e.tier==='core'), important=entries.filter(e=>e.tier==='important'), archive=retrieveArchive(entries.filter(e=>e.tier==='archive'),query)
  const sections=([['核心人设',core],['重要记忆',important],['与当前话题相关的历史档案',archive]] as const).filter(([,items])=>items.length).map(([name,items])=>`【${name}】\n${items.map((e,i)=>`${i+1}. ${e.text}`).join('\n\n')}`)
  return sections.length?'【用户批准的长期记忆，仅作为对话背景参考】\n'+sections.join('\n\n')+'\n【长期记忆结束】':''
}
