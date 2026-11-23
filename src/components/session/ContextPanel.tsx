import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useExitGhost } from '../../utils/exitGhost.js'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { buildSummary, estimateTokens } from '../../services/chat/context.js'
import { getContextRounds, getReplyText } from '../../services/chat/reply.js'
import {
  setContextCompress,
  setContextExcluded,
  setContextExcludedMany,
} from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { validCompaction } from '../../services/chat/compaction.js'
import { setAutoCompact, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconEllipsisOutline16 } from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import styles from './ContextPanel.module.css'
import { useEdgeSwipeBack } from '../historySearch/useEdgeSwipeBack.js'

const preview = (text: string, fallback: string) => {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  return line ? (line.length > 72 ? `${line.slice(0, 72)}…` : line) : fallback
}

/** 压缩轮数的常用值 */
const QUICK_COUNTS = [50, 100, 500, 800, 1000]
/** 「最近 N 轮」的快捷范围，从大到小 */
const RECENT_COUNTS = [20, 10, 5]
/** 上下文窗口上限（DeepSeek 1M） */
const WINDOW = 1_000_000

/** token 数加千分位，好读 */
const fmt = (value: number) => Math.round(value).toLocaleString('en-US')

/**
 * 上下文管理：顶部只回答「这次大概要发多少」，下面分两块——
 * 压缩早期对话（步进器 + 常用值 + 自动压缩开关），和发送哪些轮次（范围分段 + 逐轮勾选）。
 * 说明文字平时收起，点标题旁的「?」再看。
 */
export const ContextPanel = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const t = useTranslate()
  const maskRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useExitGhost(maskRef)
  useExitGhost(panelRef)
  // 和搜索页一样：从左边缘右滑返回
  useEdgeSwipeBack(panelRef, true, () => {}, () => {
    panelRef.current?.setAttribute('data-no-exit', '')
    onClose()
  })
  const rounds = useMemo(() => getContextRounds(getVisibleMessages(session)), [session])
  const excluded = useMemo(() => new Set(session.contextExcluded ?? []), [session.contextExcluded])
  const compress = session.contextCompress ?? 0
  const autoCompact = useSettings((state) => state.autoCompact)
  const compaction = useMemo(
    () => (autoCompact ? validCompaction(session, getVisibleMessages(session)) : undefined),
    [session, autoCompact]
  )
  const compactedIds = useMemo(() => new Set(compaction?.msgIds ?? []), [compaction])
  // 输入框里的文字：允许暂时为空，失焦后回到实际值
  const [typed, setTyped] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  /** 打开自动压缩前先确认：它是全局设置，对所有对话生效 */
  const [confirmingAuto, setConfirmingAuto] = useState(false)

  const allIds = rounds.map(([user]) => user.id)
  const roundTokens = ([user, reply]: (typeof rounds)[number]) =>
    estimateTokens(user.content) + estimateTokens(getReplyText(reply))

  // 和发请求时的顺序一致：先去掉排除的轮次和已自动整理的轮次，再把最早 N 轮换成摘要
  const included = rounds.filter(([user]) => !excluded.has(user.id))
  const live = included.filter(([user]) => !compactedIds.has(user.id))
  const manual = live.slice(0, compress)
  const manualIds = new Set(manual.map(([user]) => user.id))
  const before = manual.reduce((sum, round) => sum + roundTokens(round), 0)
  const summary = manual.length ? buildSummary(manual) : ''
  const after = summary ? estimateTokens(`【早期对话摘要】\n${summary}`) : 0
  const liveTotal = live.reduce((sum, round) => sum + roundTokens(round), 0)
  const memory = compaction ? estimateTokens(compaction.text) : 0
  const sent = liveTotal - before + after + memory
  const ratio = sent / WINDOW
  const level = ratio > 0.9 ? 'danger' : ratio > 0.7 ? 'warn' : 'normal'
  const compressedCount = manual.length + included.filter(([user]) => compactedIds.has(user.id)).length

  // 当前勾选正好是「全部」或「最近 N 轮」时，分段控件高亮对应项
  const activeRange = (() => {
    if (rounds.length === 0) {
      return null
    }
    if (allIds.every((id) => !excluded.has(id))) {
      return 'all'
    }
    for (const count of RECENT_COUNTS) {
      const keep = allIds.slice(-count)
      const drop = allIds.slice(0, -count)
      if (keep.every((id) => !excluded.has(id)) && drop.every((id) => excluded.has(id))) {
        return count
      }
    }
    return null
  })()

  const applyCompress = (value: number) => {
    const next = Math.max(0, Math.min(rounds.length, Math.floor(value) || 0))
    setContextCompress(session.id, next)
  }

  const toggleAuto = () => {
    if (autoCompact) {
      setAutoCompact(false)
    } else {
      setConfirmingAuto(true)
    }
  }

  const scrollToRound = (id: string | undefined) => {
    requestAnimationFrame(() => {
      const box = scrollRef.current
      const row = id ? box?.querySelector<HTMLElement>(`[data-round="${CSS.escape(id)}"]`) : null
      if (!box || !row) {
        return
      }
      // 只滚面板自己，不带动整页
      const offset = row.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 12
      if (offset > 0) {
        box.scrollTo({ top: box.scrollTop + offset, behavior: 'smooth' })
      }
    })
  }

  /** 只带最近 count 轮：更早的全部取消勾选 */
  const keepRecent = (count: number) => {
    const olderIds = allIds.slice(0, -count)
    if (olderIds.length) {
      setContextExcludedMany(session.id, olderIds, true)
    }
    setContextExcludedMany(session.id, allIds.slice(-count), false)
    // 列表滚到勾选的最后一轮，一眼看到哪些被选上了
    scrollToRound(allIds.at(-1))
  }

  const ranges: { key: 'all' | number; label: string; aria: string; pick: () => void }[] = [
    {
      key: 'all',
      label: t('contextRangeAll'),
      aria: t('contextAllOn'),
      pick: () => setContextExcludedMany(session.id, allIds, false),
    },
    ...RECENT_COUNTS.map((count) => ({
      key: count,
      label: t('contextRangeRecent', { count }),
      aria: t('contextLastN', { count }),
      pick: () => keepRecent(count),
    })),
  ]

  const shownCount = typed ?? String(compress)

  return (
    <>
      <div ref={maskRef} data-motion="fade" className={styles.mask} onClick={onClose} />
      <aside
        ref={panelRef}
        data-motion="panel"
        className={styles.panel}
        role="dialog"
        aria-label={t('contextManagerTitle')}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t('contextManagerTitle')}</h2>
          <button
            type="button"
            className={clsx(styles.help, showHelp && styles.helpOn)}
            aria-label={t('contextHelp')}
            aria-expanded={showHelp}
            onClick={() => setShowHelp((value) => !value)}
          >
            ?
          </button>
          <div className={styles.headSpacer} />
          <button
            className={styles.close}
            type="button"
            data-ripple
            onClick={onClose}
            aria-label={t('close')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div ref={scrollRef} className={styles.scroll}>
          {showHelp ? (
            <div className={styles.helpBox}>
              <p>{t('contextCompressHint')}</p>
              <p>{t('contextAutoCompressHint')}</p>
              <p>{t('contextHint')}</p>
            </div>
          ) : null}

          {/* 用量：这次大概要发多少 */}
          <section className={styles.card}>
            <div className={styles.label}>{t('contextEstimateLabel')}</div>
            <div className={styles.big}>
              <span className={styles.bigNumber}>{fmt(sent)}</span>
              <span className={styles.bigUnit}>tokens</span>
            </div>
            <div className={styles.meter}>
              <div
                className={clsx(styles.meterFill, styles[`meter_${level}`])}
                style={{ width: `${Math.max(1.5, Math.min(100, ratio * 100)).toFixed(1)}%` }}
              />
            </div>
            <div className={styles.meterLegend}>
              <span>{t('contextUsage', { percent: (ratio * 100).toFixed(1) })}</span>
              <span>{t('contextLimit')}</span>
            </div>
            <div className={styles.tags}>
              <span className={styles.tag}>{t('contextIncludedChip', { count: included.length })}</span>
              <span className={clsx(styles.tag, styles.tagAccent)}>
                {t('contextCompressedChip', { count: compressedCount })}
              </span>
              <span className={styles.tag}>
                {t('contextExcludedChip', { count: rounds.length - included.length })}
              </span>
            </div>
          </section>

          {/* 压缩早期对话 */}
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>{t('contextCompressTitle')}</h3>
              <span className={styles.cardSub}>{t('contextCompressSub')}</span>
            </div>
            <div className={styles.stepRow}>
              <span className={styles.stepWord}>{t('contextCompressEarliest')}</span>
              <div className={styles.stepper}>
                <button
                  type="button"
                  aria-label={t('contextCompressLess')}
                  onClick={() => {
                    setTyped(null)
                    applyCompress(compress - 1)
                  }}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={t('contextCompressCount')}
                  value={shownCount}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 5)
                    setTyped(digits)
                    applyCompress(digits ? Number(digits) : 0)
                  }}
                  onFocus={(event) => event.target.select()}
                  onBlur={() => setTyped(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={t('contextCompressMore')}
                  onClick={() => {
                    setTyped(null)
                    applyCompress(compress + 1)
                  }}
                >
                  +
                </button>
              </div>
              <span className={styles.stepWord}>{t('contextCompressRounds')}</span>
            </div>
            <div className={styles.quick}>
              {QUICK_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={clsx(compress === count && styles.quickOn)}
                  onClick={() => {
                    setTyped(null)
                    applyCompress(count)
                  }}
                >
                  {count}
                </button>
              ))}
            </div>
            {manual.length > 0 ? (
              <div className={styles.result} aria-live="polite">
                <div className={styles.resultText}>
                  <div className={styles.resultMain}>
                    {fmt(before)} <span>→</span> {fmt(after)}
                  </div>
                  <div className={styles.resultSub}>
                    {t('contextCompressSaved', { count: manual.length, saved: fmt(before - after) })}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.resultClear}
                  onClick={() => {
                    setTyped(null)
                    applyCompress(0)
                  }}
                >
                  {t('contextCompressClear')}
                </button>
              </div>
            ) : null}
            <div className={styles.divider} />
            <div className={styles.autoRow}>
              <div className={styles.autoText}>
                <div className={styles.autoTitle}>{t('contextAutoCompress')}</div>
                <div className={styles.autoSub}>{t('contextAutoSub')}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoCompact}
                aria-label={t('contextAutoCompress')}
                className={clsx(styles.switch, autoCompact && styles.switchOn)}
                onClick={toggleAuto}
              >
                <span />
              </button>
            </div>
            {/* 两种压缩同时开着时，说明它们怎么叠加 */}
            {autoCompact && compress > 0 ? (
              <p className={styles.stackNote}>{t('contextStackNote', { count: compress })}</p>
            ) : null}
          </section>

          {/* 发送哪些轮次 */}
          <section className={clsx(styles.card, styles.rangeCard)}>
            <div className={styles.rangeHead}>
              <div className={styles.rangeTitle}>
                <h3 className={styles.cardTitle}>{t('contextRangeTitle')}</h3>
                <span className={styles.cardSub}>{t('contextRangeSub')}</span>
              </div>
              <Menu
                options={[
                  {
                    key: 'all-on',
                    label: t('contextAllOn'),
                    icon: null,
                    onSelect: () => setContextExcludedMany(session.id, allIds, false),
                  },
                  {
                    key: 'all-off',
                    label: t('contextAllOff'),
                    icon: null,
                    onSelect: () => setContextExcludedMany(session.id, allIds, true),
                  },
                ]}
              >
                {({ toggle }) => (
                  <button type="button" className={styles.more} aria-label={t('contextMore')} onClick={toggle}>
                    <IconEllipsisOutline16 />
                  </button>
                )}
              </Menu>
            </div>
            <div className={styles.segment} role="radiogroup" aria-label={t('contextRangeTitle')}>
              {ranges.map((range) => (
                <button
                  key={range.key}
                  type="button"
                  role="radio"
                  aria-checked={activeRange === range.key}
                  aria-label={range.aria}
                  className={clsx(activeRange === range.key && styles.segmentOn)}
                  onClick={range.pick}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <div className={styles.list}>
              {rounds.length === 0 ? (
                <div className={styles.empty}>{t('contextEmpty')}</div>
              ) : (
                rounds.map(([user, reply], index) => {
                  const on = !excluded.has(user.id)
                  const compacted = compactedIds.has(user.id)
                  const squeezed = manualIds.has(user.id)
                  return (
                    <label key={user.id} data-round={user.id} className={clsx(styles.row, !on && styles.off)}>
                      <input
                        type="checkbox"
                        className={styles.checkInput}
                        checked={on}
                        onChange={(event) => setContextExcluded(session.id, user.id, !event.target.checked)}
                      />
                      <span className={styles.ring} aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path
                            d="M6.2 10.4l2.6 2.6 5-5.4"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className={styles.body}>
                        <span className={styles.line}>
                          <span className={styles.index}>{index + 1}</span>
                          <span className={styles.user}>
                            {preview(user.content, user.files.length ? t('contextAttachmentOnly') : '…')}
                          </span>
                        </span>
                        <span className={styles.reply}>{preview(getReplyText(reply), '…')}</span>
                      </span>
                      <span className={styles.side}>
                        <span className={styles.tokens}>{fmt(roundTokens([user, reply]))}</span>
                        {compacted || squeezed ? (
                          <span className={styles.compactTag}>
                            {compacted ? t('contextCompactedTag') : t('contextSqueezedTag')}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </aside>
      {confirmingAuto ? (
        <Modal
          title={t('contextAutoConfirmTitle')}
          onClose={() => setConfirmingAuto(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirmingAuto(false)}>
                {t('cancel')}
              </Button>
              <Button
                size="m"
                onClick={() => {
                  setAutoCompact(true)
                  setConfirmingAuto(false)
                }}
              >
                {t('contextAutoConfirmOk')}
              </Button>
            </>
          }
        >
          {t('contextAutoConfirmDescription')}
        </Modal>
      ) : null}
    </>
  )
}
