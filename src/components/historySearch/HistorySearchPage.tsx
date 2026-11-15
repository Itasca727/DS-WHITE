import clsx from 'clsx'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { searchHistory, type HistorySearchResult } from '../../services/chat/search.js'
import { selectSession } from '../../services/chat/store.js'
import { formatDate } from '../../utils/format.js'
import { haptic } from '../../utils/haptic.js'
import { IconSearchOutline16 } from '../base/icons.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import {
  closeHistorySearch,
  registerSearchPage,
  setOrigin,
  useHistorySearch,
} from './historySearchState.js'
import styles from './HistorySearchPage.module.css'

/** 把命中的关键词标出来 */
const Highlight = ({ text, query }: { text: string; query: string }) => {
  const q = query.trim()
  if (!q) {
    return <>{text}</>
  }
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let at = 0
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, at)) {
    if (index > at) {
      parts.push({ text: text.slice(at, index), hit: false })
    }
    parts.push({ text: text.slice(index, index + q.length), hit: true })
    at = index + q.length
  }
  parts.push({ text: text.slice(at), hit: false })
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}

/**
 * 历史对话搜索页：常驻挂载（隐藏），点边栏「搜索」时从按钮的位置展开成整页，
 * 关闭时缩回按钮；选中结果后原地淡出并打开那段对话。
 */
export const HistorySearchPage = () => {
  const t = useTranslate()
  const open = useHistorySearch((state) => state.open)
  const origin = useHistorySearch((state) => state.origin)
  const closing = useHistorySearch((state) => state.closing)
  const pageRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HistorySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // 每次搜索换一批 key，让结果按顺序依次浮现
  const [batch, setBatch] = useState(0)

  useLayoutEffect(() => {
    registerSearchPage(pageRef.current, inputRef.current)
    return () => registerSearchPage(null, null)
  }, [])

  // 窗口尺寸变化后，缩回的终点仍对准按钮
  useLayoutEffect(() => {
    if (origin && pageRef.current) {
      setOrigin(pageRef.current, origin)
    }
  }, [origin])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    let live = true
    setSearching(true)
    const timer = setTimeout(() => {
      searchHistory(q, 50)
        .then((found) => {
          if (live) {
            setResults(found)
            setBatch((value) => value + 1)
          }
        })
        .finally(() => {
          if (live) {
            setSearching(false)
          }
        })
    }, 220)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  // 关闭动画结束后清空，下次打开是干净的
  useEffect(() => {
    if (open) {
      return
    }
    const timer = setTimeout(() => {
      setQuery('')
      setResults([])
    }, 320)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeHistorySearch()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 空的时候搜索框停在可见区域的视觉中心（键盘弹出后是键盘上方那块的中心）
  useLayoutEffect(() => {
    const page = pageRef.current
    const header = headerRef.current
    if (!page || !header || !open) {
      return
    }
    const viewport = window.visualViewport
    const place = () => {
      const visible = viewport?.height ?? window.innerHeight
      const rect = header.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      page.style.setProperty('--dock-y', `${Math.max(0, visible * 0.42 - center)}px`)
    }
    place()
    viewport?.addEventListener('resize', place)
    window.addEventListener('resize', place)
    return () => {
      viewport?.removeEventListener('resize', place)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // 从左边缘右滑返回：页面跟手，松手过三分之一或快速一甩就关闭，否则弹回
  useEffect(() => {
    const page = pageRef.current
    if (!page || !open) {
      return
    }
    const EDGE = 28
    let drag: { x: number; y: number; time: number; dx: number; horizontal: boolean | null } | null =
      null
    const reset = () => {
      page.style.transform = ''
      page.style.transition = ''
      page.style.boxShadow = ''
    }
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (event.touches.length !== 1 || touch.clientX > EDGE) {
        drag = null
        return
      }
      drag = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, dx: 0, horizontal: null }
    }
    const onMove = (event: TouchEvent) => {
      if (!drag) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - drag.x
      const dy = touch.clientY - drag.y
      if (drag.horizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          return
        }
        drag.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2
        if (!drag.horizontal) {
          drag = null
          return
        }
        inputRef.current?.blur()
        page.style.transition = 'none'
      }
      event.preventDefault()
      drag.dx = Math.max(0, dx)
      page.style.transform = `translateX(${drag.dx}px)`
      page.style.boxShadow = '-14px 0 36px rgba(0, 0, 0, 0.32)'
    }
    const onEnd = (event: TouchEvent) => {
      if (!drag?.horizontal) {
        drag = null
        return
      }
      const { dx, time } = drag
      drag = null
      const velocity = dx / Math.max(1, event.timeStamp - time)
      const width = page.getBoundingClientRect().width
      if (dx > width * 0.33 || (velocity > 0.45 && dx > 30)) {
        haptic()
        const remaining = Math.max(120, Math.min(260, ((width - dx) / width) * 300))
        page.style.transition = `transform ${remaining}ms cubic-bezier(0.3, 0.6, 0.4, 1), opacity ${remaining}ms ease`
        page.style.transform = `translateX(${width}px)`
        page.style.opacity = '0.7'
        window.setTimeout(() => {
          closeHistorySearch('instant')
          requestAnimationFrame(() => {
            reset()
            page.style.opacity = ''
          })
        }, remaining)
      } else {
        page.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
        page.style.transform = 'translateX(0)'
        window.setTimeout(reset, 300)
      }
    }
    page.addEventListener('touchstart', onStart, { passive: true })
    page.addEventListener('touchmove', onMove, { passive: false })
    page.addEventListener('touchend', onEnd)
    page.addEventListener('touchcancel', onEnd)
    return () => {
      page.removeEventListener('touchstart', onStart)
      page.removeEventListener('touchmove', onMove)
      page.removeEventListener('touchend', onEnd)
      page.removeEventListener('touchcancel', onEnd)
    }
  }, [open])

  const q = query.trim()

  return createPortal(
    <div
      ref={pageRef}
      className={clsx(
        styles.page,
        open && styles.open,
        !open && closing === 'fade' && styles.fade,
        !open && closing === 'instant' && styles.instant
      )}
      role="dialog"
      aria-modal={open}
      aria-hidden={!open}
      aria-label={t('historySearchTitle')}
    >
      <div className={styles.inner}>
        <header ref={headerRef} className={styles.header}>
          <button
            type="button"
            className={styles.back}
            data-ripple
            aria-label={t('historySearchBack')}
            onClick={() => closeHistorySearch()}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M11 3.5 5.5 9l5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className={clsx(styles.dock, !q && styles.idle)}>
            <label className={styles.field}>
              <span className={styles.fieldIcon}>
                <IconSearchOutline16 />
              </span>
              <input
                ref={inputRef}
                className={styles.input}
                type="search"
                enterKeyHint="search"
                placeholder={t('searchHistoryPlaceholder')}
                value={query}
                tabIndex={open ? 0 : -1}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={t('historySearchClear')}
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus({ preventScroll: true })
                  }}
                >
                  ×
                </button>
              ) : null}
            </label>
            <div className={styles.hint} aria-hidden={Boolean(q)}>
              {t('historySearchHintSub')}
            </div>
          </div>
        </header>

        <div
          className={styles.body}
          // 开始滑动结果时收起键盘
          onTouchStart={() => inputRef.current?.blur()}
        >
          {!q ? null : searching && results.length === 0 ? (
            <div className={styles.status}>{t('searching')}</div>
          ) : results.length === 0 ? (
            <div className={styles.status}>{t('searchHistoryEmpty')}</div>
          ) : (
            <>
              <div className={styles.count}>{t('historySearchCount', { count: results.length })}</div>
              {results.map((result, index) => (
                <button
                  key={`${batch}-${result.sessionId}`}
                  type="button"
                  className={styles.result}
                  data-motion="rise"
                  style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
                  onClick={() => {
                    selectSession(result.sessionId)
                    closeMobileSider()
                    closeHistorySearch('fade')
                  }}
                >
                  <span className={styles.resultHead}>
                    <span className={styles.resultTitle}>
                      <Highlight text={result.title || t('untitledChat')} query={q} />
                    </span>
                    <time
                      className={styles.resultDate}
                      dateTime={formatDate(result.matchedAt) ?? undefined}
                    >
                      {formatDate(result.matchedAt)}
                    </time>
                  </span>
                  <span className={styles.resultSnippet}>
                    <Highlight text={result.snippet} query={q} />
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
