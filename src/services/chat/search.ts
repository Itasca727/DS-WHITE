import * as db from './db.js'
import { getReplyText } from './reply.js'
import type { Message } from './types.js'

export type HistorySearchResult = {
  sessionId: string
  title: string
  snippet: string
  updatedAt: number
  /** 命中内容的时间：正文命中取那条消息的发送时间，标题命中取会话的更新时间 */
  matchedAt: number
}

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

/** 搜索全部会话：标题命中优先，其次正文命中；返回最多 limit 条。 */
export const searchHistory = async (
  query: string,
  limit = 20
): Promise<HistorySearchResult[]> => {
  const q = query.trim().toLowerCase()
  if (!q) {
    return []
  }
  const summaries = await db.loadSessionSummaries()
  const results: HistorySearchResult[] = []
  const matched = new Set<string>()

  for (const summary of summaries) {
    if (summary.title.toLowerCase().includes(q)) {
      results.push({
        sessionId: summary.id,
        title: summary.title || '…',
        snippet: summary.title,
        updatedAt: summary.updatedAt,
        matchedAt: summary.updatedAt,
      })
      matched.add(summary.id)
      if (results.length >= limit) {
        return results
      }
    }
  }

  for (const summary of summaries) {
    if (matched.has(summary.id)) {
      continue
    }
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    for (const message of session.messages) {
      const text = messageText(message)
      if (text.toLowerCase().includes(q)) {
        results.push({
          sessionId: summary.id,
          title: summary.title || '…',
          snippet: makeSnippet(text, q),
          updatedAt: summary.updatedAt,
          matchedAt: message.createdAt || summary.updatedAt,
        })
        break
      }
    }
    if (results.length >= limit) {
      break
    }
  }
  return results
}
