import { useEffect, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { haptic } from '../../utils/haptic.js'
import { Button } from './Button.js'
import { Modal } from './Modal.js'
import styles from './IntroNotice.module.css'

const KEY = 'chat-demo:intro-ack'

const acknowledged = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

/** 「【…】」里的字加粗（括号保留） */
const emphasize = (text: string): ReactNode[] =>
  text.split(/(【[^】]*】)/).map((part, index) =>
    part.startsWith('【') ? <strong key={index}>{part}</strong> : part
  )

/** 等开屏动画结束（#white-splash 被移除）再出现，避免压在签名上 */
const useSplashDone = () => {
  const [done, setDone] = useState(() => !document.getElementById('white-splash'))
  useEffect(() => {
    if (done) {
      return
    }
    const check = () => {
      if (!document.getElementById('white-splash')) {
        setDone(true)
      }
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true })
    // 兜底：开屏脚本出意外时也不至于一直不弹
    const timer = setTimeout(() => setDone(true), 4000)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [done])
  return done
}

/** 第一次打开时的使用说明，点「我已知晓」后不再出现 */
export const IntroNotice = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(() => !acknowledged())
  const splashDone = useSplashDone()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open || !splashDone) {
      return
    }
    // 开屏签名接力到欢迎页后稍停一下再弹
    const timer = setTimeout(() => setReady(true), 260)
    return () => clearTimeout(timer)
  }, [open, splashDone])
  if (!open || !ready) {
    return null
  }
  const confirm = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // 存不了也照常关闭，下次打开再提示
    }
    haptic()
    setOpen(false)
  }
  return (
    <Modal
      title={
        <>
          {t('introTitle')}
          <em className={styles.motto}>{t('introMotto')}</em>
        </>
      }
      className={styles.dialog}
      // 必须点按钮确认，Esc 和点遮罩都不关
      onClose={() => undefined}
      footer={
        <Button size="m" block onClick={confirm}>
          {t('introConfirm')}
        </Button>
      }
    >
      <div className={styles.body}>
        <p>{emphasize(t('introLocal'))}</p>
        <p>{emphasize(t('introUpdate'))}</p>
        <p>{emphasize(t('introFree'))}</p>
      </div>
    </Modal>
  )
}
