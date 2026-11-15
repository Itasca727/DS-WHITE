import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import { getReplyText } from './reply.js'
import type { Message } from './types.js'

export type HistorySearchResult = {
  sessionId: string
  /** 命中的消息；标题命中时为空，点击只打开会话 */
  messageId: string | null
  title: string
  snippet: string
  updatedAt: number
  /** 命中内容的时间：正文命中取那条消息的发送时间，标题命中取会话的更新时间 */
  matchedAt: number
}

export type HistorySearchOutput = {
  results: HistorySearchResult[]
  /** 命中太多时只保留最新的 MAX_RESULTS 条 */
  truncated: boolean
}

/** 单次搜索最多保留的命中数；界面再分批显示 */
const MAX_RESULTS = 20000

const messageText = (message: Message): string =>
  message.role === 'user' ? message.content : getReplyText(message)

const makeSnippet = (text: string, query: string, radius = 56) => {
  const index = text.toLowerCase().indexOf(query)
  if (index < 0) {
    return text.slice(0, 80)
  }
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

type CachedSession = {
  updatedAt: number
  messages: { id: string; createdAt: number; text: string; lower: string }[]
}

/**
 * 搜索页打开期间缓存读过的会话（按更新时间失效）：连续输入时不必每次都把全部会话从数据库读一遍。
 * 搜索页关闭时清空，不常驻内存。
 */
const cache = new Map<string, CachedSession>()

export const clearSearchCache = () => cache.clear()

const loadMessages = async (id: string, updatedAt: number) => {
  const cached = cache.get(id)
  if (cached && cached.updatedAt === updatedAt) {
    return cached.messages
  }
  const session = await db.loadSession(id)
  if (!session) {
    return null
  }
  // 只搜当前显示的版本路径：搜到的消息一定能在对话里定位到
  const messages = getVisibleMessages(session).map((message) => {
    const text = messageText(message)
    return { id: message.id, createdAt: message.createdAt, text, lower: text.toLowerCase() }
  })
  cache.set(id, { updatedAt, messages })
  return messages
}

/**
 * 搜索全部会话的每一条消息：每处命中都是一条结果（同一会话可以有多条），标题命中另算一条。
 * 不限会话数量，结果按命中时间从新到旧排列。
 */
export const searchHistory = async (
  query: string,
  isStale: () => boolean = () => false
): Promise<HistorySearchOutput | null> => {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { results: [], truncated: false }
  }
  const summaries = await db.loadSessionSummaries()
  const results: HistorySearchResult[] = []

  for (const summary of summaries) {
    if (isStale()) {
      return null
    }
    const title = summary.title || '…'
    if (summary.title.toLowerCase().includes(q)) {
      results.push({
        sessionId: summary.id,
        messageId: null,
        title,
        snippet: summary.title,
        updatedAt: summary.updatedAt,
        matchedAt: summary.updatedAt,
      })
    }
    const messages = await loadMessages(summary.id, summary.updatedAt)
    for (const message of messages ?? []) {
      if (message.lower.includes(q)) {
        results.push({
          sessionId: summary.id,
          messageId: message.id,
          title,
          snippet: makeSnippet(message.text, q),
          updatedAt: summary.updatedAt,
          matchedAt: message.createdAt || summary.updatedAt,
        })
      }
    }
  }
  results.sort((a, b) => b.matchedAt - a.matchedAt)
  return { results: results.slice(0, MAX_RESULTS), truncated: results.length > MAX_RESULTS }
}
