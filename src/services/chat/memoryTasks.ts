import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { MAX_ENTRY_CHARS, saveMemoryDraftEntry, libraryForSession, privateLibraryId, registerMemoryLibrary, type MemoryTier } from '../memoryLibrary.js'
import { buildSummaryBatches, DEFAULT_SUMMARY_PROMPT, generateSummaryBatch, isSummaryTooLong, memorySummaryRounds, type SummaryRound } from './memorySummary.js'
import type { Session } from './types.js'

type Job = { id: string; sessionId: string; libraryId?: string; kind: 'manual' | 'auto'; queue: string[]; done: number; prompt: string; error?: string }
type Draft = { id: string; sessionId: string; libraryId?: string; jobId: string; kind: Job['kind']; batch: number; text: string; createdAt: number }
type AutoConfig = { enabled: boolean; every: number; seen: string[]; pending: string[] }
type Data = { jobs: Record<string, Job>; drafts: Draft[]; auto: Record<string, AutoConfig>; prompt: string }
type State = Data & { running: Record<string, boolean> }
const KEY = 'white:memory-tasks:v2'
const empty = (): Data => ({ jobs: {}, drafts: [], auto: {}, prompt: DEFAULT_SUMMARY_PROMPT })
const load = (): Data => {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') as Data | null
    if (!data || !data.jobs || !Array.isArray(data.drafts) || !data.auto || typeof data.prompt !== 'string') return empty()
    return {...data, jobs:Object.fromEntries(Object.entries(data.jobs).map(([id,j])=>[id,{...j,libraryId:j.libraryId??privateLibraryId(j.sessionId)}])),drafts:data.drafts.map(d=>({...d,libraryId:d.libraryId??privateLibraryId(d.sessionId)}))}
  } catch { return empty() }
}
export const useMemoryTasks = create<State>(() => ({ ...load(), running: {} }))
const commit = (patch: Partial<Data>) => {
  const { jobs, drafts, auto, prompt } = useMemoryTasks.getState()
  const next = { jobs, drafts, auto, prompt, ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  useMemoryTasks.setState(next)
}
const active = new Map<string, AbortController>()
const setRunning = (id: string, running: boolean) => useMemoryTasks.setState({ running: { ...useMemoryTasks.getState().running, [id]: running } })
export const defaultAuto = (): AutoConfig => ({ enabled: false, every: 30, seen: [], pending: [] })
export const setSummaryPrompt = (prompt: string) => {
  if (prompt.length > 2000) throw new Error('总结偏好最多 2000 字符')
  commit({ prompt: prompt.trim() || DEFAULT_SUMMARY_PROMPT })
}
export const configureAuto = (session: Session, enabled: boolean, every: number) => {
  if (!Number.isInteger(every) || every < 1 || every > 1000) throw new Error('自动整理间隔须为 1～1000 轮')
  const { auto, jobs } = useMemoryTasks.getState()
  const previous = auto[session.id] ?? defaultAuto()
  // 初次开启时，以全部现有用户消息为基线，不会突然总结已导入的几百轮。
  const config = enabled && !previous.enabled ? { enabled, every, seen: session.messages.filter(m => m.role === 'user').map(m => m.id), pending: [] } : { ...previous, enabled, every }
  commit({ auto: { ...auto, [session.id]: config } })
  if (!enabled && jobs[session.id]?.kind === 'auto') active.get(session.id)?.abort()
}
const makeJob = (sessionId: string, kind: Job['kind'], rounds: SummaryRound[]): Job => {
  const queue = buildSummaryBatches(rounds)
  if (!queue.length) throw new Error('没有可总结的已完成轮次')
  const libraryId = libraryForSession(sessionId)
  registerMemoryLibrary(libraryId)
  return { id: createId(), sessionId, libraryId, kind, queue, done: 0, prompt: useMemoryTasks.getState().prompt }
}
export const cancelMemoryJob = (sessionId: string) => active.get(sessionId)?.abort()
export const discardMemoryJob = (sessionId: string) => {
  if (active.has(sessionId)) throw new Error('请先暂停任务')
  const jobs = { ...useMemoryTasks.getState().jobs }; delete jobs[sessionId]; commit({ jobs })
}
export const resumeMemoryJob = async (sessionId: string, apiKey: string) => {
  if (active.has(sessionId)) return
  if (!useMemoryTasks.getState().jobs[sessionId]) return
  if (!apiKey.trim()) throw new Error('请先设置 DeepSeek API Key')
  const controller = new AbortController()
  active.set(sessionId, controller); setRunning(sessionId, true)
  try {
    while (!controller.signal.aborted) {
      const state = useMemoryTasks.getState()
      const job = state.jobs[sessionId]
      if (!job || !job.queue.length) break
      const input = job.queue[0]!
      let text: string
      try { text = await generateSummaryBatch(input, apiKey, controller.signal, job.prompt) }
      catch (error) {
        if (controller.signal.aborted) break
        if (isSummaryTooLong(error) && input.length > 256) {
          const chars = Array.from(input), mid = Math.ceil(chars.length / 2)
          const queue = [chars.slice(0, mid).join(''), chars.slice(mid).join(''), ...job.queue.slice(1)]
          commit({ jobs: { ...useMemoryTasks.getState().jobs, [sessionId]: { ...job, queue, error: undefined } } })
          continue
        }
        throw error
      }
      if (controller.signal.aborted) break
      const latest = useMemoryTasks.getState()
      // 按批次原子保存结果和进度；失败或刷新只重试尚未保存的批次。
      const parts: string[] = []
      let piece = ''
      for (const char of text) {
        if (piece.length + char.length > MAX_ENTRY_CHARS) { parts.push(piece); piece = '' }
        piece += char
      }
      if (piece) parts.push(piece)
      const drafts = parts.map((part): Draft => ({ id: createId(), sessionId, libraryId: job.libraryId ?? privateLibraryId(sessionId), jobId: job.id, kind: job.kind, batch: job.done + 1, text: part, createdAt: Date.now() }))
      const jobs = { ...latest.jobs }
      if (job.queue.length === 1) delete jobs[sessionId]
      else jobs[sessionId] = { ...job, queue: job.queue.slice(1), done: job.done + 1, error: undefined }
      commit({ jobs, drafts: [...latest.drafts, ...drafts] })
    }
  } catch (error) {
    const jobs = useMemoryTasks.getState().jobs
    const job = jobs[sessionId]
    if (job) {
      try { commit({ jobs: { ...jobs, [sessionId]: { ...job, error: error instanceof Error ? error.message : String(error) } } }) } catch { /* storage quota：原进度仍在 */ }
    }
    throw error
  } finally { active.delete(sessionId); setRunning(sessionId, false) }
}
export const startMemoryJob = async (session: Session, start: number, end: number, apiKey: string) => {
  if (!apiKey.trim()) throw new Error('请先设置 DeepSeek API Key')
  const state = useMemoryTasks.getState()
  if (state.jobs[session.id] || active.has(session.id)) throw new Error('已有未完成任务，请先继续或放弃')
  const rounds = memorySummaryRounds(session)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end || end > rounds.length) throw new Error('总结范围无效')
  const job = makeJob(session.id, 'manual', rounds.slice(start - 1, end))
  commit({ jobs: { ...state.jobs, [session.id]: job } })
  await resumeMemoryJob(session.id, apiKey)
}
/** 仅在普通聊天正常完成后调用，重生成相同用户消息不重复计数。自动结果永远先进入待审核区。 */
export const noteMemoryReply = async (session: Session, replyId: string, apiKey: string) => {
  const state = useMemoryTasks.getState()
  const config = state.auto[session.id]
  if (!config?.enabled) return
  const rounds = memorySummaryRounds(session)
  const pair = rounds.find(([, reply]) => reply.id === replyId)
  if (!pair) return
  const id = pair[0].id
  const visible = new Set(rounds.map(([user]) => user.id))
  const seen = config.seen.includes(id) ? config.seen : [...config.seen, id]
  const pending = [...new Set([...config.pending.filter(x => visible.has(x)), ...(!config.seen.includes(id) ? [id] : [])])]
  const auto = { ...state.auto, [session.id]: { ...config, seen, pending } }
  if (pending.length < config.every || state.jobs[session.id] || active.has(session.id) || !apiKey.trim()) { commit({ auto }); return }
  const chosen = new Set(pending.slice(0, config.every))
  const job = makeJob(session.id, 'auto', rounds.filter(([user]) => chosen.has(user.id)))
  // 启动与计数同时落盘，防止重载后重复总结同一批。
  commit({ auto: { ...auto, [session.id]: { ...auto[session.id]!, pending: pending.filter(x => !chosen.has(x)) } }, jobs: { ...state.jobs, [session.id]: job } })
  await resumeMemoryJob(session.id, apiKey)
}
export const updateMemoryDraft = (id: string, text: string) => {
  if (text.length > MAX_ENTRY_CHARS) throw new Error('草稿超过单条记忆长度限制')
  commit({ drafts: useMemoryTasks.getState().drafts.map(d => d.id === id ? { ...d, text } : d) })
}
export const removeMemoryDraft = (id: string) => commit({ drafts: useMemoryTasks.getState().drafts.filter(d => d.id !== id) })
export const acceptMemoryDraft = (id: string, enabled: boolean, tier: MemoryTier = 'archive') => {
  const draft = useMemoryTasks.getState().drafts.find(d => d.id === id)
  if (!draft) return
  saveMemoryDraftEntry(draft.id, draft.text, enabled, draft.libraryId ?? privateLibraryId(draft.sessionId), tier)
  removeMemoryDraft(id)
}
