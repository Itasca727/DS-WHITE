import { useRef, useState } from 'react'
import { openFavoriteAt, useChatStore } from '../../services/chat/store.js'
import { exportFavorites, importFavorites, removeFavorite, useFavorites, type Favorite } from '../../services/favorites.js'
import { saveFile } from '../../utils/saveFile.js'
import { Modal } from '../base/Modal.js'
import styles from './MemoryLibraryDialog.module.css'

export const FavoritesDialog = ({onClose,onJump}:{onClose:()=>void;onJump?:()=>void}) => {
  const items=useFavorites(s=>s.items), sessions=useChatStore(s=>s.sessions)
  const [query,setQuery]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false)
  const input=useRef<HTMLInputElement>(null)
  const groups=new Map<string,Favorite[]>()
  for(const item of items){const title=sessions.find(s=>s.id===item.sessionId)?.title||item.title;if(!(title+'\n'+item.text).toLowerCase().includes(query.toLowerCase()))continue;const group=groups.get(item.sessionId)??[];group.push(item);groups.set(item.sessionId,group)}
  const jump=async(item:Favorite)=>{setBusy(true);setNotice('');try{await openFavoriteAt(item.sessionId,item.messageId);onJump?.();onClose()}catch(e){setNotice(e instanceof Error?e.message:'无法跳转')}finally{setBusy(false)}}
  return <Modal title="回复收藏夹" closable motion="sheet" onClose={onClose} className={styles.dialog} mainClassName={styles.main}>
    <div className={styles.root}>
      {notice&&<div className={styles.notice} role="status">{notice}</div>}
      <div className={styles.section}><input type="search" placeholder="搜索对话名称或回复内容" value={query} onChange={e=>setQuery(e.target.value)}/><small>按原会话分组，共 {items.length} 条。收藏保留文本快照；不会改变聊天提示词，也不会发送给 API。</small><div className={styles.actions}><button onClick={()=>{void saveFile(new File([exportFavorites()],'white-favorites.json',{type:'application/json'})).catch(()=>setNotice('导出失败'))}}>导出收藏</button><button onClick={()=>input.current?.click()}>导入收藏</button><input ref={input} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;void f.text().then(raw=>{importFavorites(raw);setNotice('收藏已合并')}).catch(e=>setNotice(e.message||'导入失败'))}}/></div></div>
      {!groups.size&&<div className={styles.section}>没有匹配的收藏。在 AI 回复下方点击 ☆ 添加。</div>}
      {[...groups].map(([id,group])=><div className={styles.section} key={id}><strong>{sessions.find(s=>s.id===id)?.title||group[0]!.title} · {group.length} 条</strong>{!sessions.some(s=>s.id===id)&&<small>原会话不在当前设备，仍可查看收藏内容。</small>}{group.map(item=><article key={item.messageId} className={styles.entry}><small>{new Date(item.savedAt).toLocaleString()}</small><details><summary>{item.text.slice(0,80)}{item.text.length>80?'…':''}</summary><div className={styles.memoryText}>{item.text}</div></details><div className={styles.actions}><button disabled={busy||!sessions.some(s=>s.id===id)} onClick={()=>{void jump(item)}}>跳转到原对话</button><button onClick={()=>{if(window.confirm('取消收藏？不会删除原回复。'))try{removeFavorite(id,item.messageId)}catch{setNotice('保存失败')}}}>取消收藏</button></div></article>)}</div>)}
    </div>
  </Modal>
}
