import { create } from 'zustand'
import { createId } from '../utils/id.js'

export type MemoryEntry = { id: string; text: string; source: 'manual' | 'ai'; enabled: boolean; createdAt: number; updatedAt: number }
export type LibraryData = { enabled: boolean; entries: MemoryEntry[] }
const KEY = 'white:memory-library:v1'
export const MAX_MEMORY_CHARS = 24000
export const MAX_ENTRY_CHARS = 6000
export const MAX_ENTRIES = 200
const empty = (): LibraryData => ({ enabled: false, entries: [] })

export const validateLibrary = (value: unknown): LibraryData => {
  if (!value || typeof value !== 'object') throw new Error('记忆库格式无效')
  const data = value as Partial<LibraryData>
  if (typeof data.enabled !== 'boolean' || !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) throw new Error('记忆库格式或数量无效')
  const ids = new Set<string>()
  const entries = data.entries.map((item): MemoryEntry => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_ENTRY_CHARS || !['manual', 'ai'].includes(item.source) || typeof item.enabled !== 'boolean' || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) throw new Error('记忆条目无效或超出长度限制')
    ids.add(item.id)
    return { id: item.id, text: item.text.trim(), source: item.source, enabled: item.enabled, createdAt: item.createdAt, updatedAt: item.updatedAt }
  })
  if (entries.filter(item => item.enabled).reduce((sum, item) => sum + item.text.length, 0) > MAX_MEMORY_CHARS) throw new Error('启用的记忆总长度超过 24000 字符，请停用部分记忆')
  return { enabled: data.enabled, entries }
}
const load = (): LibraryData => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? validateLibrary(JSON.parse(raw)) : empty()
  } catch { return empty() }
}
export const useMemoryLibrary = create<LibraryData>(() => load())
const commit = (data: LibraryData) => {
  const valid = validateLibrary(data)
  // 写入成功后再更新 UI，避免保存失败却显示成功。
  localStorage.setItem(KEY, JSON.stringify(valid))
  useMemoryLibrary.setState(valid)
}
export const setLibraryEnabled = (enabled: boolean) => commit({ ...useMemoryLibrary.getState(), enabled })
export const saveMemoryEntry = (text: string, source: MemoryEntry['source'], id?: string) => {
  const data = useMemoryLibrary.getState()
  const now = Date.now()
  if (id) {
    if (!data.entries.some(item => item.id === id)) throw new Error('该记忆已不存在')
    commit({ ...data, entries: data.entries.map(item => item.id === id ? { ...item, text: text.trim(), updatedAt: now } : item) })
  } else {
    commit({ ...data, entries: [...data.entries, { id: createId(), text: text.trim(), source, enabled: true, createdAt: now, updatedAt: now }] })
  }
}
export const toggleMemoryEntry = (id: string, enabled: boolean) => {
  const data = useMemoryLibrary.getState()
  commit({ ...data, entries: data.entries.map(item => item.id === id ? { ...item, enabled, updatedAt: Date.now() } : item) })
}
export const deleteMemoryEntry = (id: string) => {
  const data = useMemoryLibrary.getState()
  commit({ ...data, entries: data.entries.filter(item => item.id !== id) })
}
export const exportMemoryLibrary = () => JSON.stringify({ version: 1, ...useMemoryLibrary.getState() }, null, 2)
/** 导入合并，不覆盖已有条目；不自动改变总开关。 */
export const importMemoryLibrary = (raw: string) => {
  const parsed = JSON.parse(raw) as { version?: unknown }
  if (parsed?.version !== 1) throw new Error('不支持的记忆库版本')
  const imported = validateLibrary(parsed)
  const current = useMemoryLibrary.getState()
  const ids = new Set(current.entries.map(item => item.id))
  const texts = new Set(current.entries.map(item => item.text))
  const additions = imported.entries.filter(item => !ids.has(item.id) && !texts.has(item.text)).map(item => ({ ...item, enabled: false }))
  commit({ ...current, entries: [...current.entries, ...additions] })
  return additions.length
}
/** 关闭时返回空字符串，聊天请求与原版完全相同。 */
export const memoryLibrarySystem = (data: LibraryData = useMemoryLibrary.getState()) => {
  if (!data.enabled) return ''
  const entries = data.entries.filter(item => item.enabled)
  if (!entries.length) return ''
  return '【用户批准的长期记忆，仅作为对话背景参考】\n' + entries.map((item, i) => `${i + 1}. ${item.text}`).join('\n\n') + '\n【长期记忆结束】'
}
