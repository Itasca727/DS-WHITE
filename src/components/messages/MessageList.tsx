import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import {
  consumeJumpTarget,
  selectMessageVersion,
  useChatStore,
} from '../../services/chat/store.js'
import { showToast } from '../base/toastState.js'
import type { Message, Session } from '../../services/chat/types.js'
import { haptic } from '../../utils/haptic.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { MessageErrorBoundary } from './MessageErrorBoundary.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import { validCompaction } from '../../services/chat/compaction.js'
import { estimateTokens } from '../../services/chat/context.js'
import { useSettings } from '../../services/settings.js'
import {
  endRoundSelection,
  tapRound,
  useRoundSelection,
} from './roundSelection.js'
import styles from './MessageList.module.css'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 48
/** 距底部超过该值时显示「回到底部」 */
const JUMP_THRESHOLD = 320
/** 最后一次滚动事件后多久算惯性结束（iOS 没有可靠的 scrollend） */
const SCROLL_IDLE_MS = 140
/** 手势之后多久内的滚动算用户发起 */
const GESTURE_WINDOW_MS = 300
/** 距顶部小于几屏时自动加载更早的消息 */
const LOAD_EARLIER_SCREENS = 1.5
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/** 首次只渲染最近这么多条；往上翻再分批加。 */
const PAGE_SIZE = 60
const PAGE_SIZE_MOBILE = 24
/** 跳到某条消息时，它前面多渲染几条，往上翻不会马上碰到「加载更早」 */
const JUMP_CONTEXT = 6
/** 跳到离最新超过这么多条的旧消息时，只渲染它附近一段，不把它到最新之间的全部消息一次画出来 */
const JUMP_WINDOW_FROM = 80
/** 末尾这几条不做 content-visibility：正在输出、或刚发出的消息要实时布局。 */
const LIVE_TAIL = 2

/**
 * 单条消息外壳。离开末尾后量一次真实高度，打开 content-visibility：
 * 屏幕外的旧消息不再参与样式、布局和绘制，翻历史和出字时整列都更轻。
 * 先量后开，并把量到的高度写进 contain-intrinsic-size，
 * 避免没有滚动锚定的 Safari 在消息重新进入视口时跳动。
 */
const MessageItem = memo(function MessageItem({
  messageId,
  live,
  entering,
  role,
  roundId,
  selecting,
  selected,
  onTapRound,
  children,
}: {
  messageId: string
  live: boolean
  /** 刚发出 / 刚开始回复的消息：播放入场动画 */
  entering: boolean
  role: Message['role']
  /** 所属轮次（提问的 id），多选删除时用 */
  roundId: string | null
  selecting: boolean
  selected: boolean
  /** 多选时点了这一轮 */
  onTapRound: (roundId: string) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 只看挂载那一刻：之后重渲染去掉类名会把正在播放的动画掐断
  const [enterClass] = useState(() =>
    entering ? (role === 'user' ? styles.enterUser : styles.enterAssistant) : undefined
  )
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    if (live) {
      el.classList.remove(styles.offscreenSkippable)
      el.style.removeProperty('contain-intrinsic-size')
      return
    }
    // 读在 layout 阶段集中完成，写放到下一帧，避免读写交替反复强制布局。
    const height = el.offsetHeight
    const frame = requestAnimationFrame(() => {
      if (height > 0) {
        el.style.setProperty('contain-intrinsic-size', `auto ${height}px`)
        el.classList.add(styles.offscreenSkippable)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [live])
  const canSelect = selecting && roundId !== null
  return (
    <div
      ref={ref}
      data-msg={messageId}
      className={clsx(
        styles.item,
        enterClass,
        canSelect && styles.selecting,
        canSelect && selected && styles.selected,
        canSelect && (role === 'user' ? styles.roundHead : styles.roundTail)
      )}
      // 多选时整轮都是一个点击区：吞掉内部按钮的点击，只做勾选
      onClickCapture={
        canSelect
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              haptic()
              onTapRound(roundId)
            }
          : undefined
      }
    >
      {canSelect && role === 'user' ? (
        <span
          className={styles.selectMark}
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? '已选中这一轮' : '选择这一轮'}
        />
      ) : null}
      {children}
    </div>
  )
})

/**
 * 消息列表。
 *
 * 滚动原则：只要手指还在屏幕上、或者惯性还没停，就绝不写 scrollTop。
 * iOS 上写 scrollTop 会立刻掐断惯性，这是以前「被拽回」「滑一半卡住」的来源。
 * 贴底跟随按帧合并，惯性结束后再补一次。
 */
export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: ReactNode
}) => {
  const t = useTranslate()
  const selectionSession = useRoundSelection((state) => state.sessionId)
  const autoCompact = useSettings((state) => state.autoCompact)
  const selectedList = useRoundSelection((state) => state.ids)
  const selectedIds = useMemo(() => new Set(selectedList), [selectedList])
  // 多选时点某一轮：连选模式要知道轮次的先后顺序
  const roundOrderKey = getVisibleMessages(session)
    .filter((message) => message.role === 'user')
    .map((message) => message.id)
    .join(',')
  const onTapRound = useCallback(
    (roundId: string) => tapRound(roundId, roundOrderKey.split(',')),
    [roundOrderKey]
  )
  // 换会话就退出多选
  useEffect(() => {
    if (useRoundSelection.getState().sessionId !== session.id) {
      endRoundSelection()
    }
  }, [session.id])
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollMobileRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const jumpAnchorRef = useRef<HTMLDivElement>(null)

  /** 是否跟随底部 */
  const followRef = useRef(true)
  /** 手指是否按在列表上 */
  const touchingRef = useRef(false)
  /** 最近一次用户滚动的时间（含惯性） */
  const lastUserScrollRef = useRef(0)
  /** 最近一次手势输入（触摸、滚轮、键盘、按下滚动条）的时间 */
  const lastGestureRef = useRef(0)
  /** 我们自己最近一次写入的 scrollTop，用来区分程序滚动和用户滚动 */
  const writtenTopRef = useRef<number | null>(null)
  const lastTopRef = useRef(0)
  const followFrameRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 打开会话时已有的消息不播入场动画，之后新增的才播 */
  const seenRef = useRef<{ sessionId: string; ids: Set<string> } | null>(null)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const prependRef = useRef<{ height: number; top: number } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const showJumpRef = useRef(false)

  const messages = getVisibleMessages(session)
  const pageSize = isMobile ? PAGE_SIZE_MOBILE : PAGE_SIZE
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  // 从历史搜索跳进来：把目标消息之前留几条也一起渲染出来
  const jumpTarget = useChatStore((state) => state.jumpTarget)
  const target = jumpTarget?.sessionId === session.id ? jumpTarget : null
  const targetIndex = target ? messages.findIndex((message) => message.id === target.messageId) : -1
  // 跳得很远时只画目标附近：前面 JUMP_CONTEXT 条，后面一页；往下滑再接着加载更新的，回到底部时回到最新
  const farJump = targetIndex >= 0 && messages.length - targetIndex > JUMP_WINDOW_FROM
  const jumpCount = targetIndex >= 0 ? (farJump ? 1 + JUMP_CONTEXT : messages.length - targetIndex + JUMP_CONTEXT) : 0
  const jumpCut = farJump ? Math.max(0, messages.length - (targetIndex + 1 + pageSize)) : 0
  // 结尾截掉多少条；记下截断时的会话和最后一条，发新消息或换会话就自动回到最新
  const [tailCut, setTailCut] = useState<{ key: string; count: number } | null>(null)
  const cutKey = `${session.id}:${lastMessageId ?? ''}`
  const storedCut = tailCut?.key === cutKey ? tailCut.count : 0
  const cut = target && targetIndex >= 0 ? jumpCut : storedCut
  const end = messages.length - cut
  const renderCount = target && targetIndex >= 0 ? (farJump ? end - targetIndex + JUMP_CONTEXT : Math.max(visibleCount, jumpCount)) : visibleCount
  const start = Math.max(0, end - renderCount)
  const cutRef = useRef(cut)
  cutRef.current = cut
  const startRef = useRef(start)
  startRef.current = start
  const messageCountRef = useRef(messages.length)
  messageCountRef.current = messages.length

  // 删除轮次后，上方会补进更早的消息（只渲染最近若干条），内容整体下移，画面就跳了。
  // 渲染时发现有消息被删：趁旧 DOM 还在，记下屏幕顶部第一条留下来的消息和它的位置，提交后放回原处。
  const knownIdsRef = useRef<{ sessionId: string; ids: Set<string> } | null>(null)
  const deleteAnchorRef = useRef<{ id: string; top: number } | null>(null)
  // 删除后撑住列表的最小高度；空白离开屏幕或发新消息时收回
  const deleteFloorRef = useRef(0)
  const deleteBelowRef = useRef(0)
  const applyHoldRef = useRef<(() => void) | null>(null)
  const known = knownIdsRef.current
  if (known?.sessionId === session.id && !deleteAnchorRef.current) {
    const now = new Set(messages.map((message) => message.id))
    let removed = false
    for (const id of known.ids) {
      if (!now.has(id)) {
        removed = true
        break
      }
    }
    const el = removed ? (isMobile ? scrollMobileRef.current : containerRef.current) : null
    if (el && columnRef.current) {
      // 删除前的列表高度：删完先撑住，画面才能原地不动（停在底部时也一样）
      deleteBelowRef.current = columnRef.current.offsetHeight
    }
    if (el) {
      // 基准选删掉那几轮上方、完整露出来的最后一条：上面不动，下面的内容往上补位（和系统列表删除一样）。
      // 屏幕上方没有完整露出的就用半露的那条；被删的不在屏幕上，就用顶部第一条完整露出的。
      const box = el.getBoundingClientRect()
      let above: { id: string; top: number } | null = null
      let partial: { id: string; top: number } | null = null
      let first: { id: string; top: number } | null = null
      let offscreen: { id: string; top: number } | null = null
      let removedInView = false
      for (const node of el.querySelectorAll<HTMLElement>('[data-msg]')) {
        const id = node.dataset.msg
        const rect = node.getBoundingClientRect()
        if (!id) {
          continue
        }
        if (rect.bottom <= box.top + 1) {
          // 屏幕上方、已经滑出去的最后一条：被删的那轮正好顶在屏幕最上面时，拿它当基准
          if (now.has(id)) {
            offscreen = { id, top: rect.top - box.top }
          }
          continue
        }
        if (rect.top >= box.bottom) {
          break
        }
        if (!now.has(id)) {
          removedInView = true
          break
        }
        const spot = { id, top: rect.top - box.top }
        if (rect.top >= box.top - 1) {
          above = spot
          first ??= spot
        } else {
          partial = spot
        }
      }
      deleteAnchorRef.current = removedInView ? (above ?? partial ?? offscreen) : (first ?? partial)
      const columnTop = columnRef.current?.getBoundingClientRect().top
      if (deleteAnchorRef.current && columnTop !== undefined) {
        // 基准消息以下原来占的高度：删完要留够这么多，画面才能停在原处
        deleteBelowRef.current -= deleteAnchorRef.current.top + box.top - columnTop
      } else {
        deleteBelowRef.current = 0
      }
    }
  }

  const getScrollEl = useCallback(
    () => (isMobile ? scrollMobileRef.current : containerRef.current),
    [isMobile]
  )

  const setJumpVisible = useCallback((visible: boolean) => {
    if (showJumpRef.current !== visible) {
      showJumpRef.current = visible
      setShowJump(visible)
    }
  }, [])

  /** 立即贴底（仅在确定没有用户手势时生效） */
  const stickNow = useCallback(() => {
    const el = getScrollEl()
    if (!el || !followRef.current) {
      return
    }
    const userScrolling =
      touchingRef.current || performance.now() - lastUserScrollRef.current < SCROLL_IDLE_MS
    if (userScrolling) {
      return
    }
    const bottom = el.scrollHeight - el.clientHeight
    if (Math.abs(el.scrollTop - bottom) > 0.5) {
      el.scrollTop = bottom
      writtenTopRef.current = el.scrollTop
      lastTopRef.current = el.scrollTop
    }
    setJumpVisible(false)
  }, [getScrollEl, setJumpVisible])

  /** 请求贴底：同一帧内的多次请求合并成一次 */
  const requestFollow = useCallback(() => {
    if (!followRef.current || followFrameRef.current) {
      return
    }
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = 0
      stickNow()
    })
  }, [stickNow])

  const loadEarlier = useCallback(() => {
    const el = getScrollEl()
    if (!el || startRef.current <= 0 || prependRef.current) {
      return
    }
    prependRef.current = { height: el.scrollHeight, top: el.scrollTop }
    setVisibleCount((count) => Math.min(messageCountRef.current, count + pageSize))
  }, [getScrollEl, pageSize])

  /** 跳到旧消息后往下翻：在后面接上一页更新的消息（加在下方，当前位置不动） */
  const loadNewer = useCallback(() => {
    if (cutRef.current <= 0) {
      return
    }
    const step = Math.min(cutRef.current, pageSize)
    setTailCut((current) => (current ? { ...current, count: Math.max(0, current.count - step) } : null))
    setVisibleCount((count) => count + step)
  }, [pageSize])

  /** 惯性结束：补一次贴底，必要时加载更早 / 更新的消息 */
  const onScrollIdle = useCallback(() => {
    const el = getScrollEl()
    if (!el || touchingRef.current) {
      return
    }
    if (startRef.current > 0 && el.scrollTop < el.clientHeight * LOAD_EARLIER_SCREENS) {
      loadEarlier()
    }
    if (
      cutRef.current > 0 &&
      el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * LOAD_EARLIER_SCREENS
    ) {
      loadNewer()
    }
    requestFollow()
  }, [getScrollEl, loadEarlier, loadNewer, requestFollow])

  useLayoutEffect(() => {
    setVisibleCount(pageSize)
    setTailCut(null)
  }, [session.id, pageSize])

  // 从截断的旧片段回到最新后，等新的一页渲染出来再贴底
  const stickAfterCutRef = useRef(false)
  useLayoutEffect(() => {
    if (cut === 0 && stickAfterCutRef.current) {
      stickAfterCutRef.current = false
      stickNow()
    }
  }, [cut, stickNow])

  // 内容或容器尺寸变化（出字、图片加载、键盘弹出）时请求贴底。
  useLayoutEffect(() => {
    const content = columnRef.current
    const el = getScrollEl()
    if (!content || !el) {
      return
    }
    const observer = new ResizeObserver(requestFollow)
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [getScrollEl, requestFollow])

  // 切换会话或新增最后一条（自己刚发出消息）：恢复跟随并贴底。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const el = getScrollEl()
    if (anchor && el) {
      const switcher = el.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        el.scrollTop += switcher.getBoundingClientRect().top - anchor.top
        writtenTopRef.current = el.scrollTop
        lastTopRef.current = el.scrollTop
      }
      restoreScrollRef.current = null
      return
    }
    followRef.current = true
    touchingRef.current = false
    lastUserScrollRef.current = 0
    stickNow()
  }, [session.id, lastMessageId, getScrollEl, stickNow])

  const jumpPinRef = useRef<(() => void) | null>(null)
  useEffect(() => () => jumpPinRef.current?.(), [])

  // 历史搜索跳转：滚到那条消息（放在视口上部），闪一下标出来，暂停贴底跟随。
  // 写在「切换会话贴底」之后，同一次提交里后执行，覆盖掉贴底。
  useLayoutEffect(() => {
    if (!target) {
      return
    }
    const { nonce, messageId } = target
    if (targetIndex < 0) {
      if (messages.length > 0) {
        showToast(t('jumpTargetMissing'))
        consumeJumpTarget(nonce)
      }
      return
    }
    if (farJump) {
      setTailCut({ key: cutKey, count: jumpCut })
      setVisibleCount(end - targetIndex + JUMP_CONTEXT)
    } else {
      setTailCut(null)
      setVisibleCount((count) => Math.max(count, jumpCount))
    }
    consumeJumpTarget(nonce)
    const el = getScrollEl()
    const node = el?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(messageId)}"]`)
    if (!el || !node) {
      return
    }
    jumpPinRef.current?.()
    followRef.current = false
    touchingRef.current = false
    const startedAt = performance.now()
    /** 把目标放到视口上部 18% 处 */
    const align = () => {
      const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top
      const top = Math.max(0, el.scrollTop + offset - el.clientHeight * 0.18)
      if (Math.abs(el.scrollTop - top) > 0.5) {
        el.scrollTop = top
        writtenTopRef.current = el.scrollTop
        lastTopRef.current = el.scrollTop
      }
    }
    align()
    lastUserScrollRef.current = performance.now()
    setJumpVisible(true)
    // 刚打开时布局还在变（抽屉收起、宽度变化、正文渲染、图片加载），上面内容高度一变目标就会跑开：
    // 一段时间内持续把它钉住，用户一碰屏幕就放手。
    const content = columnRef.current
    const observer = new ResizeObserver(() => {
      if (lastGestureRef.current > startedAt || touchingRef.current) {
        observer.disconnect()
        return
      }
      align()
    })
    if (content) {
      observer.observe(content)
    }
    observer.observe(el)
    const release = setTimeout(() => observer.disconnect(), 2500)
    node.classList.remove(styles.jumpFlash)
    void node.offsetWidth
    node.classList.add(styles.jumpFlash)
    const timer = setTimeout(() => node.classList.remove(styles.jumpFlash), 2200)
    // 目标消费后依赖会变，不能靠 effect 清理；下一次跳转或卸载时再收拾
    jumpPinRef.current = () => {
      clearTimeout(timer)
      clearTimeout(release)
      observer.disconnect()
      node.classList.remove(styles.jumpFlash)
    }
    // 只在目标变化时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nonce, targetIndex, messages.length > 0])

  // 加载更早的消息后保持当前阅读位置。
  useLayoutEffect(() => {
    const pending = prependRef.current
    const el = getScrollEl()
    if (pending && el) {
      el.scrollTop = pending.top + (el.scrollHeight - pending.height)
      writtenTopRef.current = el.scrollTop
      lastTopRef.current = el.scrollTop
      prependRef.current = null
    }
  }, [visibleCount, getScrollEl])

  // 列表不突然变短：思考小窗收起会让页面瞬间少一截，贴底的画面就会先被拽上去、再被回答推回来。
  // 收起空出来的位置先留着（最多留 320px），让回答填进去；回答很短时这块空白也留着（官端也是这样），
  // 到切换对话、发新消息或删除时再按实际高度重新算。重新生成这类整段消失的大变化不留，免得一大片空白。
  // 回答是在消息组件里自己更新的，列表本身不一定重新渲染，所以盯着最后一条消息的尺寸变化
  useLayoutEffect(() => {
    const column = columnRef.current
    if (!column) {
      return
    }
    let held = 0
    const measure = () => {
      const last = column.lastElementChild
      const natural = last ? last.getBoundingClientRect().bottom - column.getBoundingClientRect().top + 24 : 0
      if (natural >= held || held - natural > 320) {
        held = natural
      }
      column.style.minHeight = `${Math.round(Math.max(held, deleteFloorRef.current))}px`
    }
    applyHoldRef.current = measure
    const resize = new ResizeObserver(measure)
    let watched: Element | null = null
    const rewatch = () => {
      const last = column.lastElementChild
      if (last !== watched) {
        if (watched) {
          resize.unobserve(watched)
        }
        if (last) {
          resize.observe(last)
        }
        watched = last
      }
      measure()
    }
    rewatch()
    const mutation = new MutationObserver(rewatch)
    mutation.observe(column, { childList: true })
    return () => {
      resize.disconnect()
      mutation.disconnect()
      applyHoldRef.current = null
      column.style.minHeight = ''
    }
  }, [session.id, messages.length])

  // 发新消息、切换对话时不再撑着删除留下的空白
  const floorKeyRef = useRef({ sessionId: session.id, count: messages.length })
  if (floorKeyRef.current.sessionId !== session.id || messages.length > floorKeyRef.current.count) {
    deleteFloorRef.current = 0
  }
  floorKeyRef.current = { sessionId: session.id, count: messages.length }

  // 往上滑到删除留下的空白完全离开屏幕后再收回：收的是屏幕外的部分，看不出变化
  useEffect(() => {
    const el = getScrollEl()
    const column = columnRef.current
    if (!el || !column) {
      return
    }
    const onScroll = () => {
      if (!deleteFloorRef.current) {
        return
      }
      const last = column.lastElementChild
      const natural = last ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 24 : 0
      if (natural >= el.clientHeight - 1) {
        deleteFloorRef.current = 0
        applyHoldRef.current?.()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [getScrollEl, session.id])

  // 删除后把记下的那条消息放回原来的位置
  useLayoutEffect(() => {
    knownIdsRef.current = { sessionId: session.id, ids: new Set(messages.map((message) => message.id)) }
    const anchor = deleteAnchorRef.current
    deleteAnchorRef.current = null
    const el = getScrollEl()
    if (!anchor || !el) {
      return
    }
    const node = el.querySelector<HTMLElement>(`[data-msg="${CSS.escape(anchor.id)}"]`)
    const column = columnRef.current
    if (!node || !column) {
      return
    }
    // 上方可能补进了更早的消息：按基准消息的新位置，把它下面原来的高度撑回来
    deleteFloorRef.current =
      node.getBoundingClientRect().top - column.getBoundingClientRect().top + deleteBelowRef.current
    deleteBelowRef.current = 0
    applyHoldRef.current?.()
    const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top
    if (Math.abs(delta) > 0.5) {
      el.scrollTop += delta
      writtenTopRef.current = el.scrollTop
      lastTopRef.current = el.scrollTop
    }
    // 底下撑着删除留下的空白时不贴底，否则会被拉到空白最底下
    followRef.current = !deleteFloorRef.current && el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
  })

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  // 编辑某条提问时：键盘弹出、编辑框变高，都把整个编辑区（含「取消 / 发送」）留在可见范围里。
  // 编辑期间暂停贴底跟随，不然键盘一顶，列表又被拉回最底部，编辑框就被推出屏幕。
  useEffect(() => {
    const el = getScrollEl()
    const column = columnRef.current
    if (!el || !column) {
      return
    }
    let editor: HTMLElement | null = null
    let frame = 0
    const keepVisible = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!editor?.isConnected) {
          return
        }
        const box = el.getBoundingClientRect()
        // 键盘弹出时，可见区域的底部以视觉视口为准
        const viewport = window.visualViewport
        const visibleBottom = Math.min(box.bottom, viewport ? viewport.offsetTop + viewport.height : box.bottom)
        const rect = editor.getBoundingClientRect()
        const margin = 12
        let delta = 0
        if (rect.bottom > visibleBottom - margin) {
          delta = rect.bottom - visibleBottom + margin
        }
        // 编辑区比可见高度还高时，优先保证顶部（正在打字的那几行）看得见
        if (rect.top - delta < box.top + margin) {
          delta = rect.top - box.top - margin
        }
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          writtenTopRef.current = el.scrollTop
          lastTopRef.current = el.scrollTop
        }
      })
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) {
        return
      }
      editor = target.closest<HTMLElement>('[data-msg]')?.querySelector<HTMLElement>('[data-editor]') ?? target
      followRef.current = false
      keepVisible()
      // iOS 键盘动画结束后视口才稳定，再补两次
      setTimeout(keepVisible, 300)
      setTimeout(keepVisible, 600)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.target instanceof HTMLTextAreaElement) {
        editor = null
      }
    }
    const onChange = () => {
      if (editor) {
        keepVisible()
      }
    }
    const observer = new ResizeObserver(onChange)
    observer.observe(el)
    observer.observe(column)
    column.addEventListener('focusin', onFocusIn)
    column.addEventListener('focusout', onFocusOut)
    window.visualViewport?.addEventListener('resize', onChange)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      column.removeEventListener('focusin', onFocusIn)
      column.removeEventListener('focusout', onFocusOut)
      window.visualViewport?.removeEventListener('resize', onChange)
    }
  }, [getScrollEl])

  // 记下已经出现过的消息；首次打开会话时全部算作已出现。
  useEffect(() => {
    if (seenRef.current?.sessionId !== session.id) {
      seenRef.current = { sessionId: session.id, ids: new Set() }
    }
    for (const message of messages) {
      seenRef.current.ids.add(message.id)
    }
  })

  // 「回到底部」按钮浮在输入区上方：跟踪输入区高度。
  useLayoutEffect(() => {
    const anchor = jumpAnchorRef.current
    const footerEl = anchor?.previousElementSibling
    if (!anchor || !(footerEl instanceof HTMLElement)) {
      return
    }
    const observer = new ResizeObserver(() => {
      anchor.style.setProperty('--footer-height', `${footerEl.offsetHeight}px`)
    })
    observer.observe(footerEl)
    return () => observer.disconnect()
  }, [isMobile])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      followRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 手势与滚动监听全部 passive，绝不阻塞合成线程滚动。
  useLayoutEffect(() => {
    const el = getScrollEl()
    if (!el) {
      return
    }
    if (followRef.current) {
      stickNow()
    } else {
      el.scrollTop = lastTopRef.current
      writtenTopRef.current = el.scrollTop
    }

    const scheduleIdle = () => {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(onScrollIdle, SCROLL_IDLE_MS)
    }
    const markGesture = () => {
      lastGestureRef.current = performance.now()
    }
    const onTouchStart = () => {
      touchingRef.current = true
      markGesture()
      lastUserScrollRef.current = performance.now()
    }
    const onTouchEnd = () => {
      touchingRef.current = false
      markGesture()
      lastUserScrollRef.current = performance.now()
      scheduleIdle()
    }
    const onWheel = (event: WheelEvent) => {
      markGesture()
      lastUserScrollRef.current = performance.now()
      if (event.deltaY < 0) {
        followRef.current = false
      }
    }
    const onScroll = () => {
      const top = el.scrollTop
      const distance = el.scrollHeight - top - el.clientHeight
      const written = writtenTopRef.current
      writtenTopRef.current = null
      const ours = written !== null && Math.abs(top - written) < 1
      const now = performance.now()
      // 用户滚动 = 手指按着 / 刚有手势 / 紧接着上一次用户滚动的惯性。
      // 浏览器自己的位置修正（内容高度变化、滚动锚定、越界回收）不算，不打断跟随。
      const byUser =
        !ours &&
        (touchingRef.current ||
          now - lastGestureRef.current < GESTURE_WINDOW_MS ||
          now - lastUserScrollRef.current < SCROLL_IDLE_MS)

      if (byUser) {
        lastUserScrollRef.current = now
        if (top < lastTopRef.current - 1 && distance > STICKY_THRESHOLD) {
          // 往上翻：停止跟随，让用户安心看历史。
          followRef.current = false
        } else if (distance < STICKY_THRESHOLD && cutRef.current === 0) {
          // 自己滑回了底部：恢复跟随。（停在旧片段的底部不算，后面还有更新的消息）
          followRef.current = true
        }
      }
      if (!ours) {
        // 停下来后检查是否需要加载更早的消息、补一次贴底。
        scheduleIdle()
      }
      lastTopRef.current = top
      setJumpVisible(distance > JUMP_THRESHOLD || cutRef.current > 0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('keydown', markGesture, { passive: true })
    el.addEventListener('pointerdown', markGesture, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(idleTimerRef.current)
      cancelAnimationFrame(followFrameRef.current)
      followFrameRef.current = 0
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('keydown', markGesture)
      el.removeEventListener('pointerdown', markGesture)
      el.removeEventListener('scroll', onScroll)
    }
  }, [getScrollEl, onScrollIdle, setJumpVisible, stickNow])

  const jumpToBottom = () => {
    const el = getScrollEl()
    if (!el) {
      return
    }
    haptic()
    followRef.current = true
    touchingRef.current = false
    setJumpVisible(false)
    if (cutRef.current > 0) {
      // 停在旧片段里：直接换成最新一页，渲染完贴底
      stickAfterCutRef.current = true
      lastUserScrollRef.current = 0
      setTailCut(null)
      setVisibleCount(pageSize)
      return
    }
    const bottom = el.scrollHeight - el.clientHeight
    // 离得很远时先瞬移到最后一屏，再平滑滚完：既利落，又保留「回到底部」的动感。
    if (bottom - el.scrollTop > el.clientHeight * 2) {
      el.scrollTop = bottom - el.clientHeight
      writtenTopRef.current = el.scrollTop
      lastTopRef.current = el.scrollTop
    }
    el.scrollTo({ top: bottom, behavior: 'smooth' })
  }

  const shown = messages.slice(start, end)
  const selecting = selectionSession === session.id
  const compaction = autoCompact ? validCompaction(session, messages) : undefined
  const lastCovered = compaction?.msgIds.at(-1)
  const lastCoveredIndex = lastCovered ? messages.findIndex((m) => m.id === lastCovered) : -1
  // 分隔线画在被整理的最后一轮的回答之后
  const dividerAfter =
    lastCoveredIndex >= 0
      ? (messages[lastCoveredIndex + 1]?.role === 'assistant'
          ? messages[lastCoveredIndex + 1]
          : messages[lastCoveredIndex]
        ).id
      : null
  const lastIndex = messages.length - 1
  const seen = seenRef.current?.sessionId === session.id ? seenRef.current.ids : null
  const uploadRetryId = getUploadRetryId(messages, streaming)

  return (
    <ScrollToBottomContext.Provider value={requestFollow}>
      <div ref={containerRef} className={styles.container}>
        <div ref={isMobile ? scrollMobileRef : undefined} className={styles.scroll}>
          <div ref={columnRef} className={styles.column}>
            {start > 0 ? (
              <button className={styles.loadEarlier} type="button" onClick={loadEarlier}>
                {t('loadEarlier')}
              </button>
            ) : null}
            {shown.map((message, offset) => {
              const index = start + offset
              return [
                <MessageItem
                  key={message.id}
                  messageId={message.id}
                  live={index > lastIndex - LIVE_TAIL}
                  entering={seen !== null && !seen.has(message.id) && index > lastIndex - LIVE_TAIL}
                  role={message.role}
                  roundId={message.role === 'user' ? message.id : (message.parentId ?? null)}
                  selecting={selecting}
                  onTapRound={onTapRound}
                  selected={selecting && selectedIds.has(
                    message.role === 'user' ? message.id : (message.parentId ?? '')
                  )}
                >
                  <MessageErrorBoundary fallback={t('messageRenderFailed')}>
                    {message.role === 'user' ? (
                      <UserMessage
                        sessionId={session.id}
                        message={message}
                        retryUploadId={uploadRetryId}
                        isFirst={index === 0}
                        isLast={index === lastIndex || index === lastIndex - 1}
                        busy={streaming}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                      />
                    ) : (
                      <AssistantMessage
                        sessionId={session.id}
                        message={message}
                        isLast={index === lastIndex}
                        streaming={streaming && index === lastIndex}
                        busy={streaming}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                      />
                    )}
                  </MessageErrorBoundary>
                </MessageItem>,
                message.id === dividerAfter && compaction ? (
                  <div key="compaction-divider" className={styles.compactDivider} role="note">
                    <span>
                      {t('compactionDivider', {
                        count: compaction.msgIds.length,
                        before: Math.round(compaction.coveredTokens).toLocaleString('en-US'),
                        after: Math.round(estimateTokens(compaction.text)).toLocaleString('en-US'),
                      })}
                    </span>
                  </div>
                ) : null,
              ]
            })}
            {cut > 0 ? (
              <button className={styles.loadEarlier} type="button" onClick={loadNewer}>
                {t('loadNewer')}
              </button>
            ) : null}
          </div>
        </div>
        {footer}
        <div ref={jumpAnchorRef} className={styles.jumpAnchor}>
          <button
            type="button"
            className={clsx(styles.jumpButton, showJump && styles.jumpVisible)}
            data-ripple
            aria-label={t('scrollToBottom')}
            tabIndex={showJump ? 0 : -1}
            onClick={jumpToBottom}
          >
            <IconChevronDownOutline14 />
          </button>
        </div>
      </div>
    </ScrollToBottomContext.Provider>
  )
}
