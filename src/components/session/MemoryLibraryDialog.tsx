import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import { generateMemorySummary, memorySummaryRounds } from '../../services/chat/memorySummary.js'
import { deleteMemoryEntry, exportMemoryLibrary, importMemoryLibrary, MAX_ENTRY_CHARS, MAX_MEMORY_CHARS, saveMemoryEntry, setLibraryEnabled, toggleMemoryEntry, useMemoryLibrary, type MemoryEntry } from '../../services/memoryLibrary.js'
import { saveFile } from '../../utils/saveFile.js'
import { Modal } from '../base/Modal.js'
import styles from './MemoryLibraryDialog.module.css'

export const MemoryLibraryDialog = ({ onClose }: { onClose: () => void }) => {
  const library = useMemoryLibrary()
  const session = useChatStore(state => state.activeId ? state.sessionCache[state.activeId] : undefined)
  const [draft, setDraft] = useState('')
  const [source, setSource] = useState<MemoryEntry['source']>('manual')
  const [editing, setEditing] = useState<string>()
  const [count, setCount] = useState(30)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const request = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => request.current?.abort(), [])
  const run = (action: () => void) => {
    try { action() } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败') }
  }
  const reset = () => { setDraft(''); setEditing(undefined); setSource('manual') }
  const close = () => {
    if ((draft.trim() || busy) && !window.confirm('关闭会丢弃未保存的草稿或取消总结，确定吗？')) return
    request.current?.abort()
    onClose()
  }
  const summarize = async () => {
    if (!session || busy || request.current) return
    if (draft.trim() && !window.confirm('用新的 AI 总结替换未保存的草稿？')) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setNotice('正在使用官方 DeepSeek API 总结…')
    try {
      const text = await generateMemorySummary(session, count, useSettings.getState().apiKey ?? '', controller.signal)
      if (controller.signal.aborted) return
      setDraft(text); setEditing(undefined); setSource('ai'); setNotice('AI 草稿已生成，请检查、修改后再保存。')
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '总结失败')
      else setNotice('已取消总结。')
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }
  const used = library.entries.filter(item => item.enabled).reduce((sum, item) => sum + item.text.length, 0)
  const available = session ? memorySummaryRounds(session).length : 0
  return <Modal title="长期记忆库" closable motion="sheet" onClose={close} className={styles.dialog} mainClassName={styles.main}>
    <div className={styles.root}>
      {notice && <div className={styles.notice} role="status" aria-live="polite">{notice}</div>}
      <div className={styles.section}>
        <label className={styles.switch}><input type="checkbox" checked={library.enabled} onChange={event => run(() => { setLibraryEnabled(event.target.checked); setNotice('设置已保存') })}/> <strong>聊天时使用记忆库（全局）</strong></label>
        <p>关闭时不会附加本记忆库内容。开启后，启用的记忆会追加在官方基础系统提示词之后，供所有对话参考。原有压缩设置独立生效。</p>
        <small>{library.entries.length} 条 · 已启用 {used.toLocaleString()} / {MAX_MEMORY_CHARS.toLocaleString()} 字符 · 本机保存</small>
      </div>
      <div className={styles.section}>
        <strong>{editing ? '编辑记忆' : '添加记忆'}</strong>
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => { if (!draft.trim() || window.confirm('放弃当前未保存草稿？')) reset() }}>手动添加</button>
          <select aria-label="AI 总结轮数" value={count} disabled={busy} onChange={event => setCount(Number(event.target.value))}>
            {[10, 30, 50, 100].map(n => <option key={n} value={n}>最近 {n} 轮</option>)}
          </select>
          <button type="button" disabled={busy || !available} onClick={() => void summarize()}>AI 总结当前对话</button>
          {busy && <button type="button" onClick={() => request.current?.abort()}>取消</button>}
        </div>
        <p>{session ? `当前对话有 ${available} 个可总结轮次（仅当前分支、未排除的已完成对话；不读取附件原件）。` : '打开一段聊天后即可使用 AI 总结。'} AI 总结会额外调用官方 API 并计费，不会自动写入记忆。</p>
        <textarea aria-label="记忆内容" placeholder="写下你希望 AI 记住的人设、偏好、约定或重要经历…" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} rows={6}/>
        <small>{source === 'ai' ? 'AI 草稿' : '手动记忆'} · {draft.length} / {MAX_ENTRY_CHARS} 字符</small>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy || !draft.trim() || draft.length > MAX_ENTRY_CHARS} onClick={() => run(() => { saveMemoryEntry(draft, source, editing); reset(); setNotice('记忆已保存') })}>保存记忆</button>
          <button disabled={busy} onClick={reset}>清空草稿</button>
        </div>
      </div>
      <div className={styles.section}>
        <strong>已保存的记忆</strong>
        <input type="search" placeholder="搜索记忆" aria-label="搜索记忆" value={search} onChange={event => setSearch(event.target.value)}/>
        {!library.entries.length && <p>还没有记忆。手动添加，或者让 AI 总结一段对话。</p>}
        {library.entries.filter(item => item.text.toLowerCase().includes(search.toLowerCase())).map(item => <article className={styles.entry} key={item.id}>
          <div className={styles.actions}><label className={styles.switch}><input type="checkbox" checked={item.enabled} onChange={event => run(() => toggleMemoryEntry(item.id, event.target.checked))}/> {item.enabled ? '启用' : '停用'}</label><small>{item.source === 'ai' ? 'AI 总结' : '手动'} · {new Date(item.updatedAt).toLocaleDateString()}</small></div>
          <div className={styles.memoryText}>{item.text}</div>
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => { if (draft.trim() && !window.confirm('放弃当前未保存草稿？')) return; setEditing(item.id); setDraft(item.text); setSource(item.source) }}>编辑</button>
            <button disabled={busy} onClick={() => { if (window.confirm('确定删除这条记忆？')) run(() => { deleteMemoryEntry(item.id); if (editing === item.id) reset(); setNotice('已删除') }) }}>删除</button>
          </div>
        </article>)}
      </div>
      <div className={styles.section}>
        <strong>备份与迁移</strong>
        <p>记忆库单独导出为 JSON，不包含 API Key。原版聊天 ZIP 不包含本记忆库；换网址或设备需要手动导入。</p>
        <div className={styles.actions}>
          <button onClick={() => { void saveFile(new File([exportMemoryLibrary()], 'white-memory-library.json', { type: 'application/json' })).catch(() => setNotice('导出失败')) }}>导出记忆库</button>
          <button onClick={() => fileInput.current?.click()}>导入记忆库</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 8_000_000) { setNotice('文件太大'); return } void file.text().then(raw => run(() => { const n = importMemoryLibrary(raw); setNotice(`已合并 ${n} 条新记忆（默认停用）`) })).catch(() => setNotice('读取失败')) }}/>
        </div>
      </div>
    </div>
  </Modal>
}
