import { create } from 'zustand'
export type Favorite = { sessionId: string; messageId: string; title: string; text: string; savedAt: number }
const KEY = 'white:reply-favorites:v3'
const load = (): Favorite[] => {
  try { const items = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(items) ? items.filter((x: Favorite) => x && typeof x.sessionId === 'string' && typeof x.messageId === 'string' && typeof x.title === 'string' && typeof x.text === 'string' && Number.isFinite(x.savedAt)) : [] } catch { return [] }
}
export const useFavorites = create<{ items: Favorite[] }>(() => ({ items: load() }))
const commit = (items: Favorite[]) => { localStorage.setItem(KEY, JSON.stringify(items)); useFavorites.setState({ items }) }
export const removeFavorite = (sessionId: string, messageId: string) => commit(useFavorites.getState().items.filter(x => x.sessionId !== sessionId || x.messageId !== messageId))
export const toggleFavorite = (sessionId: string, messageId: string, title: string, text: string) => {
  const items = useFavorites.getState().items
  if (items.some(x => x.sessionId === sessionId && x.messageId === messageId)) { removeFavorite(sessionId,messageId); return false }
  if (!text.trim()) return false
  commit([{sessionId,messageId,title,text,savedAt:Date.now()},...items]); return true
}
export const exportFavorites = () => JSON.stringify({version:1,items:useFavorites.getState().items},null,2)
export const importFavorites = (raw: string) => {
  const data=JSON.parse(raw); if(data?.version!==1 || !Array.isArray(data.items)) throw new Error('收藏文件格式无效')
  const items=[...useFavorites.getState().items]; const seen=new Set(items.map(x=>JSON.stringify([x.sessionId,x.messageId])))
  for(const x of data.items){if(!x||typeof x.sessionId!=='string'||typeof x.messageId!=='string'||typeof x.title!=='string'||typeof x.text!=='string'||!Number.isFinite(x.savedAt))throw new Error('收藏条目无效');const key=JSON.stringify([x.sessionId,x.messageId]);if(!seen.has(key)){seen.add(key);items.push({sessionId:x.sessionId,messageId:x.messageId,title:x.title,text:x.text,savedAt:x.savedAt})}}
  commit(items.sort((a,b)=>b.savedAt-a.savedAt))
}
