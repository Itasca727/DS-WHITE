import clsx from 'clsx'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { haptic } from '../../utils/haptic.js'
import { Button } from './Button.js'
import {
  IconDataOutline16,
  IconEditOutline16,
  IconPlayOutline16,
  IconSearchOutline16,
} from './icons.js'
import { acknowledged, useSplashDone } from './IntroNotice.js'
import { Modal } from './Modal.js'
import styles from './IntroNotice.module.css'

/** 当前这条更新公告对应的版本；改了内容就换版本号，老用户会再看到一次 */
const NOTICE_VERSION = '1.1.2'
const KEY = 'chat-demo:update-notice'

const readSeen = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return NOTICE_VERSION
  }
}

const markSeen = () => {
  try {
    localStorage.setItem(KEY, NOTICE_VERSION)
  } catch {
    // 存不了就算了，下次打开再提示一次
  }
}

/** 「【…】」里的字加粗，括号去掉（公告里括号会和「」叠在一起） */
const emphasize = (text: string): ReactNode[] =>
  text.split(/(【[^】]*】)/).map((part, index) =>
    part.startsWith('【') ? <strong key={index}>{part.slice(1, -1)}</strong> : part
  )

/** 图片：小画框加一座山 */
const IconImage = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.8" cy="6.4" r="1.1" fill="currentColor" />
    <path d="M2.6 11.6l3.3-3 2.4 2.1 2-1.7 3.1 2.6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

/** 命中率：一圈底环加一段弧 */
const IconRing = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.3" opacity="0.3" />
    <path d="M8 2.4a5.6 5.6 0 1 1-5.3 7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

/**
 * 版本更新公告：老用户更新后弹一次，点「知道了」不再出现。
 * 新用户已经有第一次使用说明，直接记为看过，不再叠一层弹窗。
 * 正在生成回答时先不弹，等生成完。
 */
export const UpdateNotice = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(() => {
    if (readSeen() === NOTICE_VERSION) {
      return false
    }
    if (!acknowledged()) {
      markSeen()
      return false
    }
    return true
  })
  const splashDone = useSplashDone()
  const busy = useChatStore((state) => Object.keys(state.streaming).length > 0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open || !splashDone || busy) {
      return
    }
    const timer = setTimeout(() => setReady(true), 360)
    return () => clearTimeout(timer)
  }, [open, splashDone, busy])
  if (!open || !ready) {
    return null
  }
  const confirm = () => {
    markSeen()
    haptic()
    setOpen(false)
  }
  // 最要紧的四条放最前面并高亮
  const items = [
    { icon: <IconDataOutline16 />, title: t('updateContextTitle'), text: t('updateContext'), key: true },
    { icon: <IconPlayOutline16 />, title: t('updatePreviewTitle'), text: t('updatePreview'), key: true },
    { icon: <IconSearchOutline16 />, title: t('updateJumpTitle'), text: t('updateJump'), key: true },
    { icon: <IconImage />, title: t('updateImageTitle'), text: t('updateImage'), key: true },
    { icon: <IconRing />, title: t('updateCacheTitle'), text: t('updateCache') },
    { icon: <IconEditOutline16 />, title: t('updateInteractTitle'), text: t('updateInteract') },
  ]
  return (
    <Modal
      title={
        <div className={styles.hero}>
          <span className={styles.heading}>{t('updateTitle', { version: NOTICE_VERSION })}</span>
          <em className={styles.motto}>{t('updateSubtitle')}</em>
        </div>
      }
      className={styles.dialog}
      onClose={confirm}
      footer={
        <Button size="m" block onClick={confirm}>
          {t('updateConfirm')}
        </Button>
      }
    >
      <ol className={clsx(styles.body, styles.compact)}>
        {items.map((item, index) => (
          <li
            key={item.title}
            className={clsx(styles.item, item.key && styles.itemKey)}
            style={{ '--i': index } as CSSProperties}
          >
            <span className={clsx(styles.icon, 'white-glass')} aria-hidden="true">
              {item.icon}
            </span>
            <div className={styles.itemBody}>
              <div className={styles.itemTitle}>{item.title}</div>
              <p>{emphasize(item.text)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
