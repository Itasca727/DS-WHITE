import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import styles from './HtmlPreview.module.css'

/**
 * HTML 代码块的网页预览：全屏盖一层，在沙盒 iframe 里运行。
 * sandbox 不带 allow-same-origin，页面是独立的「空来源」，读不到 DS WHITE 的本地存储（API Key、聊天记录）。
 */
export const HtmlPreview = ({ code, onClose }: { code: string; onClose: () => void }) => {
  const t = useTranslate()
  const [closing, setClosing] = useState(false)
  // 重新运行：换 key 让 iframe 重建
  const [run, setRun] = useState(0)

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  return createPortal(
    <div
      className={styles.viewer}
      data-closing={closing ? '' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t('htmlPreviewTitle')}
    >
      <header className={styles.bar}>
        <span className={styles.title}>{t('htmlPreviewTitle')}</span>
        <span className={styles.note}>{t('htmlPreviewNote')}</span>
        <button type="button" className={styles.action} onClick={() => setRun((n) => n + 1)}>
          {t('htmlPreviewRerun')}
        </button>
        <button type="button" className={styles.close} aria-label={t('close')} onClick={close}>
          ×
        </button>
      </header>
      <div className={styles.frame}>
        <iframe
          key={run}
          title={t('htmlPreviewTitle')}
          srcDoc={code}
          sandbox="allow-scripts allow-forms allow-modals"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>,
    document.body
  )
}
