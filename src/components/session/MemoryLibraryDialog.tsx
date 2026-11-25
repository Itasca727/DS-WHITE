import { useRef, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import { memorySummaryRounds } from '../../services/chat/memorySummary.js'
import { bindMemoryLibrary, createMemoryLibrary, deleteMemoryEntry, exportMemoryLibrary, importMemoryLibrary, libraryForSession, libraryName, privateLibraryId, renameMemoryLibrary, registerMemoryLibrary, LEGACY_LIBRARY, MAX_ENTRY_CHARS, MAX_MEMORY_CHARS, saveMemoryEntry, setLibraryEnabled, toggleMemoryEntry, TIER_NAMES, useMemoryLibrary, type MemoryEntry, type MemoryTier } from '../../services/memoryLibrary.js'
import { acceptMemoryDraft, cancelMemoryJob, configureAuto, defaultAuto, discardMemoryJob, removeMemoryDraft, resumeMemoryJob, setSummaryPrompt, startMemoryJob, updateMemoryDraft, useMemoryTasks } from '../../services/chat/memoryTasks.js'
import { saveFile } from '../../utils/saveFile.js'
import { Modal } from '../base/Modal.js'
import styles from './MemoryLibraryDialog.module.css'

export const MemoryLibraryDialog = ({ onClose }: { onClose: () => void }) => {
  const library = useMemoryLibrary()
  const session = useChatStore(state => state.activeId ? state.sessionCache[state.activeId] : undefined)
  const [managedId, setManagedId] = useState(LEGACY_LIBRARY)
  const groupId = session ? libraryForSession(session.id, library) : managedId
  const entries = library.entries.filter(e => e.libraryId === groupId).sort((a,b)=>['core','important','archive'].indexOf(a.tier)-['core','important','archive'].indexOf(b.tier))
  const tasks = useMemoryTasks()
  const groups = [...library.libraries]
  for (const item of [...tasks.drafts,...Object.values(tasks.jobs)]) { const id=item.libraryId ?? privateLibraryId(item.sessionId); if(!groups.some(g=>g.id===id))groups.push({id,name:libraryName(id,library)+' · 待审核'}) }
  if (session && !groups.some(g => g.id === privateLibraryId(session.id))) groups.push({ id: privateLibraryId(session.id), name: '本会话独立记忆库' })
  const [groupName, setGroupName] = useState('')
  const [tier, setTier] = useState<MemoryTier>('important')
  const [draftTiers, setDraftTiers] = useState<Record<string, MemoryTier>>({})
  const [draft, setDraft] = useState('')
  const [source, setSource] = useState<MemoryEntry['source']>('manual')
  const [editing, setEditing] = useState<string>()
  const [range, setRange] = useState('30')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(30)
  const job = session ? tasks.jobs[session.id] : undefined
  const busy = session ? !!tasks.running[session.id] : false
  const auto = session ? tasks.auto[session.id] ?? defaultAuto() : defaultAuto()
  const [interval, setInterval] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const run = (action: () => void) => {
    try { action() } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败') }
  }
  const reset = () => { setDraft(''); setEditing(undefined); setSource('manual'); setTier('important') }
  const close = () => {
    if (draft.trim() && !window.confirm('关闭会丢弃尚未保存的手动编辑内容，确定吗？')) return
    onClose()
  }
  const runAsync = (action: () => Promise<void>) => {
    setNotice('')
    void action().catch(error => setNotice(error instanceof Error ? error.message : '总结失败'))
  }
  const summarize = () => {
    if (!session || busy || job) return
    const n = memorySummaryRounds(session).length
    const start = range === 'custom' ? from : range === 'all' ? 1 : Math.max(1, n - Number(range) + 1)
    const end = range === 'custom' ? to : n
    if (!window.confirm(`总结第 ${start}～${end} 个可总结轮次？长对话会分批调用 DeepSeek API 并计费，结果进入待审核区。`)) return
    runAsync(() => startMemoryJob(session, start, end, useSettings.getState().apiKey ?? ''))
  }
  const used = entries.filter(item => item.enabled && item.tier !== 'archive').reduce((sum, item) => sum + item.text.length, 0)
  const visibleDrafts = tasks.drafts.filter(d => (d.libraryId ?? privateLibraryId(d.sessionId)) === groupId)
  const chooseGroup = (id: string) => { if (draft.trim() && !window.confirm('切换记忆库会放弃尚未保存的编辑内容，确定吗？')) return; run(() => { if (session) { registerMemoryLibrary(id); bindMemoryLibrary(session.id, id) } else setManagedId(id); reset() }) }
  const available = session ? memorySummaryRounds(session).length : 0
  return <Modal title="长期记忆库" closable motion="sheet" onClose={close} className={styles.dialog} mainClassName={styles.main}>
    <div className={styles.root}>
      {notice && <div className={styles.notice} role="status" aria-live="polite">{notice}</div>}
      <div className={styles.section}>
        <label className={styles.switch}><input type="checkbox" checked={library.enabled} onChange={event => run(() => { setLibraryEnabled(event.target.checked); setNotice('设置已保存') })}/> <strong>聊天时使用记忆库（总开关）</strong></label>
        <p>关闭时不会附加本记忆库内容。开启后仅发送本会话绑定库的内容：核心与重要记忆固定携带；历史档案按当前消息本地检索，最多 5 条 / 6000 字符。原有压缩设置独立生效。</p>
        <small>{entries.length} 条 · 固定记忆已启用 {used.toLocaleString()} / {MAX_MEMORY_CHARS.toLocaleString()} 字符 · 本机保存</small>
      </div>
      <div className={styles.section}>
        <strong>记忆库分组 · {session ? '当前会话绑定' : '管理全部记忆库'}</strong>
        <select aria-label="选择记忆库" value={groupId} onChange={e => chooseGroup(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <small>每个会话默认独立。两个会话选择同一库即可共享记忆。旧版记忆保留在「原有共享记忆库」，不会自动发送给独立会话。切换库不迁移已有记忆，进行中的总结仍归原库；切换后自动整理的未达标轮次仍按当前会话累计，新任务归新库。</small>
        <input aria-label="记忆库名称" type="text" maxLength={100} placeholder="输入新库名称或重命名" value={groupName} onChange={e => setGroupName(e.target.value)}/>
        <div className={styles.actions}><button disabled={!groupName.trim()} onClick={() => { if (draft.trim() && !window.confirm('新建库会放弃未保存编辑，确定吗？')) return; run(() => { const id = createMemoryLibrary(groupName); if (session) bindMemoryLibrary(session.id, id); else setManagedId(id); reset(); setGroupName('') }) }}>新建并选择</button><button disabled={!groupName.trim()} onClick={() => run(() => { renameMemoryLibrary(groupId, groupName); setGroupName('') })}>重命名当前库</button>{session && <button onClick={() => chooseGroup(privateLibraryId(session.id))}>恢复本会话独立库</button>}</div>
        <small>当前库：{libraryName(groupId, library)}</small>
      </div>
      <div className={styles.section}>
        <strong>{editing ? '编辑记忆' : '添加记忆'}</strong>
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => { if (!draft.trim() || window.confirm('放弃当前未保存草稿？')) reset() }}>手动添加</button>
          <select aria-label="AI 总结范围" value={range} disabled={busy || !!job} onChange={event => setRange(event.target.value)}>
            {[10, 30, 50, 100].map(n => <option key={n} value={String(n)}>最近 {n} 轮</option>)}
            <option value="all">全部历史</option><option value="custom">自定义范围</option>
          </select>
          <button type="button" disabled={busy || !!job || !available} onClick={summarize}>AI 分批总结</button>
        </div>
        {range === 'custom' && <div className={styles.actions}><label>第 <input type="number" min={1} max={available} value={from} disabled={busy || !!job} onChange={e => setFrom(Number(e.target.value))}/> 轮</label><label>至 <input type="number" min={1} max={available} value={to} disabled={busy || !!job} onChange={e => setTo(Number(e.target.value))}/> 轮</label></div>}
        <p>{session ? `当前分支有 ${available} 个可总结轮次（不含排除轮次、未完成回复或附件原件）；范围按这些轮次从 1 开始编号。` : '打开一段聊天后即可使用 AI 总结。'} 分批调用官方 API 会计费；每批结果独立保存为待审核草稿，不会自动注入聊天。</p>
        {job && <div className={styles.entry}>
          <strong>{job.kind === 'auto' ? '自动整理' : '手动总结'} · {busy ? '进行中' : '已暂停 / 待继续'}</strong>
          <progress value={job.done} max={job.done + job.queue.length}/><small>已完成 {job.done} / {job.done + job.queue.length} 批（遇到超长会自动增加批次）</small>
          {job.error && <p role="alert">{job.error}</p>}
          <div className={styles.actions}>
            {busy ? <button onClick={() => cancelMemoryJob(job.sessionId)}>暂停</button> : <><button onClick={() => runAsync(() => resumeMemoryJob(job.sessionId, useSettings.getState().apiKey ?? ''))}>继续未完成批次</button><button onClick={() => { if (window.confirm('放弃剩余批次？已生成的草稿会保留。')) run(() => discardMemoryJob(job.sessionId)) }}>放弃剩余批次</button></>}
          </div>
        </div>}
        <label>记忆层级 <select value={tier} onChange={e => setTier(e.target.value as MemoryTier)}>{Object.entries(TIER_NAMES).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <small>核心人设由人工编辑；重要记忆固定携带；历史档案只在词语匹配时发送。</small>
        <textarea aria-label="记忆内容" placeholder="写下你希望 AI 记住的人设、偏好、约定或重要经历…" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} rows={6}/>
        <small>{source === 'ai' ? 'AI 草稿' : '手动记忆'} · {draft.length} / {MAX_ENTRY_CHARS} 字符</small>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy || !draft.trim() || draft.length > MAX_ENTRY_CHARS} onClick={() => run(() => { saveMemoryEntry(draft, source, editing, groupId, tier); reset(); setNotice('记忆已保存') })}>保存记忆</button>
          <button disabled={busy} onClick={reset}>清空草稿</button>
        </div>
      </div>
      <div className={styles.section}>
        <strong>自动整理（当前聊天）</strong>
        <label className={styles.switch}><input type="checkbox" disabled={!session} checked={auto.enabled} onChange={e => { if (!session) return; const enabled = e.target.checked; if (enabled && !window.confirm('开启后每达到设定轮数将额外调用 API 并计费，结果仅进入待审核区，是否开启？')) return; run(() => configureAuto(session, enabled, Number(interval || auto.every))) }}/> 每隔指定轮数自动整理</label>
        <div className={styles.actions}><label>每 <input type="number" min={1} max={1000} value={interval || auto.every} disabled={!session} onChange={e => setInterval(e.target.value)}/> 轮</label><button disabled={!session} onClick={() => { if (session) run(() => { configureAuto(session, auto.enabled, Number(interval || auto.every)); setInterval(''); setNotice('自动整理间隔已保存') }) }}>保存间隔</button></div>
        <small>已积累 {auto.pending.length} / {auto.every} 个新轮次。默认关闭；从开启之后开始计算。同一提问重生成不重复计数。任务仅在网页运行且连接正常时进行，关闭网页后可手动继续；失败不自动反复扣费。</small>
        <label>自定义总结偏好（不改变普通聊天提示词）<textarea key={tasks.prompt} defaultValue={tasks.prompt} maxLength={2000} rows={4} onBlur={e => run(() => setSummaryPrompt(e.target.value))}/></label>
        <small>修改后点击输入框外自动保存，下一次新建总结任务生效。</small>
      </div>
      <div className={styles.section}>
        <strong>待审核的 AI 记忆草稿 · {visibleDrafts.length} 条</strong>
        <p>此处只显示属于当前库的草稿。可以编辑、逐条保存为启用或停用的记忆；未经确认不会进入聊天请求。</p>
        {visibleDrafts.map(item => <article key={item.id} className={styles.entry}>
          <small>{item.kind === 'auto' ? '自动整理' : '手动总结'} · 第 {item.batch} 批 · {new Date(item.createdAt).toLocaleString()} · {item.sessionId === session?.id ? '当前聊天' : '其他聊天'}</small>
          <textarea aria-label="待审核记忆" value={item.text} maxLength={MAX_ENTRY_CHARS} onChange={e => run(() => updateMemoryDraft(item.id, e.target.value))} rows={5}/>
          <label>保存层级 <select value={draftTiers[item.id] ?? 'archive'} onChange={e => setDraftTiers(old => ({...old,[item.id]:e.target.value as MemoryTier}))}><option value="archive">历史档案</option><option value="important">重要记忆</option><option value="core">核心人设（人工确认）</option></select></label>
          <div className={styles.actions}>
            <button disabled={!item.text.trim()} onClick={() => run(() => { acceptMemoryDraft(item.id, true, draftTiers[item.id] ?? 'archive'); setNotice('已保存为启用记忆') })}>保存并启用</button>
            <button disabled={!item.text.trim()} onClick={() => run(() => { acceptMemoryDraft(item.id, false, draftTiers[item.id] ?? 'archive'); setNotice('已保存为停用记忆') })}>保存为停用</button>
            <button onClick={() => { if (window.confirm('丢弃这条草稿？')) run(() => removeMemoryDraft(item.id)) }}>丢弃</button>
          </div>
        </article>)}
      </div>
      <div className={styles.section}>
        <strong>已保存的记忆</strong>
        <input type="search" placeholder="搜索记忆" aria-label="搜索记忆" value={search} onChange={event => setSearch(event.target.value)}/>
        {!entries.length && <p>还没有记忆。手动添加，或者让 AI 总结一段对话。</p>}
        {entries.filter(item => item.text.toLowerCase().includes(search.toLowerCase())).map(item => <article className={styles.entry} key={item.id}>
          <div className={styles.actions}><label className={styles.switch}><input type="checkbox" checked={item.enabled} onChange={event => run(() => toggleMemoryEntry(item.id, event.target.checked))}/> {item.enabled ? '启用' : '停用'}</label><small>{TIER_NAMES[item.tier]} · {item.source === 'ai' ? 'AI 总结' : '手动'} · {new Date(item.updatedAt).toLocaleDateString()}</small></div>
          <div className={styles.memoryText}>{item.text}</div>
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => { if (draft.trim() && !window.confirm('放弃当前未保存草稿？')) return; setEditing(item.id); setDraft(item.text); setSource(item.source); setTier(item.tier) }}>编辑</button>
            <button disabled={busy} onClick={() => { if (window.confirm('确定删除这条记忆？')) run(() => { deleteMemoryEntry(item.id); if (editing === item.id) reset(); setNotice('已删除') }) }}>删除</button>
          </div>
        </article>)}
      </div>
      <div className={styles.section}>
        <strong>备份与迁移</strong>
        <p>所有分组记忆单独导出为 JSON，不包含 API Key；导入合并条目（默认停用），不会自动绑定会话。原版聊天 ZIP 不包含本记忆库；待审核草稿、任务断点和自动整理配置也不在记忆库导出内。换网址或设备需要手动导入。</p>
        <div className={styles.actions}>
          <button onClick={() => { void saveFile(new File([exportMemoryLibrary()], 'white-memory-library.json', { type: 'application/json' })).catch(() => setNotice('导出失败')) }}>导出记忆库</button>
          <button onClick={() => fileInput.current?.click()}>导入记忆库</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 8_000_000) { setNotice('文件太大'); return } void file.text().then(raw => run(() => { const n = importMemoryLibrary(raw); setNotice(`已合并 ${n} 条新记忆（默认停用）`) })).catch(() => setNotice('读取失败')) }}/>
        </div>
      </div>
    </div>
  </Modal>
}
