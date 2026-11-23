import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import styles from './SessionView.module.css'

/** 最近一次回复的缓存命中率；用量只在回复结束时变化，取值为纯数字，不会带来额外渲染 */
export const lastCacheRate = (session: Session): number | null => {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]
    if (message.role !== 'assistant' || !message.usage) {
      continue
    }
    const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = message.usage
    const total = (input_tokens || 0) + (cache_read_input_tokens || 0) + (cache_creation_input_tokens || 0)
    if (total <= 0) {
      return null
    }
    return Math.round(((cache_read_input_tokens || 0) / total) * 100)
  }
  return null
}

const R = 5
const C = 2 * Math.PI * R

export const CacheBadge = memo(function CacheBadge({ rate }: { rate: number | null }) {
  const t = useTranslate()
  if (rate === null) {
    return null
  }
  return (
    <span className={styles.cache} title={t('cacheHitTitle')} aria-label={`${t('cacheHit')} ${rate}%`}>
      <span>
        {t('cacheHit')} {rate}%
      </span>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r={R} className={styles.cacheTrack} />
        <circle
          cx="6"
          cy="6"
          r={R}
          className={styles.cacheArc}
          strokeDasharray={`${(C * rate) / 100} ${C}`}
          transform="rotate(-90 6 6)"
        />
      </svg>
    </span>
  )
})
