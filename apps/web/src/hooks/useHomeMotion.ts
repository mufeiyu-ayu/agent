import type { Ref } from 'vue'

import { onBeforeUnmount, onMounted } from 'vue'

import { clamp01, ease } from '@/utils/easing'

/** 用户是否要求减少动效；与原稿一样在进入首页时读一次。 */
export function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 用户允许动效时才编排滚动动画（原稿挂在 <html> 上的 js-motion 判定）。 */
export function homeMotion() {
  return !reducedMotion() && 'IntersectionObserver' in window
}

/**
 * 首页页面级副作用：标签页标题与平滑滚动只在首页生效、离开时恢复；
 * 滚动编排：导航显隐、Build 卡片发散、收尾放大、背景视差，以及 [data-reveal] 文案上浮。
 * 都在首页根元素内查询，数值照搬设计稿。
 */
export function useHomeScroll(root: Readonly<Ref<HTMLElement | null>>, motion: boolean) {
  const html = document.documentElement
  let previousTitle = ''
  let previousScrollBehavior = ''
  let raf = 0
  let revealIO: IntersectionObserver | undefined
  let stackRO: ResizeObserver | undefined
  let queue = () => {}

  onMounted(() => {
    previousTitle = document.title
    previousScrollBehavior = html.style.scrollBehavior
    document.title = 'Agent for Teams'
    if (!reducedMotion())
      html.style.scrollBehavior = 'smooth'

    const el = root.value!
    const nav = el.querySelector<HTMLElement>('.nav')!
    const stack = el.querySelector<HTMLElement>('.stack')!
    const slots = [...stack.querySelectorAll<HTMLElement>('.art-slot')]
    const finalCard = el.querySelector<HTMLElement>('.final-card')!
    const parallax = [...el.querySelectorAll<HTMLElement>('[data-parallax]')]

    // 文案只在初始位于首屏以下时上浮一次
    revealIO = new IntersectionObserver(entries => entries.forEach((e) => {
      if (!e.isIntersecting)
        return
      e.target.classList.remove('is-pending')
      revealIO!.unobserve(e.target)
    }), { rootMargin: '0px 0px -10% 0px' })
    if (motion) {
      el.querySelectorAll('[data-reveal]').forEach((r) => {
        if (r.getBoundingClientRect().top < innerHeight * 0.9)
          return
        r.classList.add('is-pending')
        revealIO!.observe(r)
      })
    }

    // Build 卡片起始叠在报表下面，随滚动发散
    function measureStack() {
      const page = stack.querySelector<HTMLElement>('.slot-page')!
      const cx = page.offsetLeft + page.offsetWidth / 2
      const cy = page.offsetTop + page.offsetHeight / 2
      slots.forEach((sl) => {
        sl.style.setProperty('--dx', `${(cx - (sl.offsetLeft + sl.offsetWidth / 2)).toFixed(1)}px`)
        sl.style.setProperty('--dy', `${(cy - (sl.offsetTop + sl.offsetHeight / 2)).toFixed(1)}px`)
      })
    }

    let lastY = scrollY
    let navHidden = false
    let queued = false
    function frame() {
      queued = false
      const y = scrollY
      const h = innerHeight
      nav.classList.toggle('is-scrolled', y > 8)
      if (motion) {
        if (y < 480 || y < lastY - 6)
          navHidden = false
        else if (y > lastY + 6)
          navHidden = true
        nav.classList.toggle('is-hidden', navHidden)
        const sr = stack.getBoundingClientRect()
        stack.style.setProperty('--p', ease(clamp01((h * 0.92 - sr.top) / (h * 0.55))).toFixed(3))
        const fr = finalCard.getBoundingClientRect()
        finalCard.style.setProperty('--p', ease(clamp01((h - fr.top) / (h * 0.75))).toFixed(3))
        parallax.forEach((p) => {
          const r = p.getBoundingClientRect()
          p.style.setProperty('--py', ((r.top + r.height / 2 - h / 2) * -0.08).toFixed(1))
        })
      }
      lastY = y
    }
    queue = () => {
      if (!queued) {
        queued = true
        raf = requestAnimationFrame(frame)
      }
    }
    addEventListener('scroll', queue, { passive: true })
    addEventListener('resize', queue)
    if (motion) {
      measureStack()
      stackRO = new ResizeObserver(() => {
        measureStack()
        queue()
      })
      stackRO.observe(stack)
    }
    frame()
  })

  onBeforeUnmount(() => {
    document.title = previousTitle
    html.style.scrollBehavior = previousScrollBehavior
    removeEventListener('scroll', queue)
    removeEventListener('resize', queue)
    cancelAnimationFrame(raf)
    revealIO?.disconnect()
    stackRO?.disconnect()
  })
}

/**
 * 场景入场：挂载时已在视口 80% 以内（或不允许动效）为 'now'；否则挂 will-enter 进入 'wait'，
 * 进入视口时移除 will-enter 并回调 'enter'。每个场景只入场一次。
 */
export function useSceneEntrance(
  target: Readonly<Ref<HTMLElement | null>>,
  onPhase?: (phase: 'now' | 'wait' | 'enter', el: HTMLElement) => void,
) {
  let io: IntersectionObserver | undefined

  onMounted(() => {
    const el = target.value!
    if (!homeMotion() || el.getBoundingClientRect().top < innerHeight * 0.8) {
      onPhase?.('now', el)
      return
    }
    el.classList.add('will-enter')
    onPhase?.('wait', el)
    io = new IntersectionObserver(([e]) => {
      if (!e!.isIntersecting)
        return
      io!.disconnect()
      el.classList.remove('will-enter')
      onPhase?.('enter', el)
    }, { rootMargin: '0px 0px -18% 0px' })
    io.observe(el)
  })

  onBeforeUnmount(() => io?.disconnect())
}

/** 数字从 0 缓动计数到 to；卸载时停止。 */
export function useCountUp() {
  let raf = 0
  onBeforeUnmount(() => cancelAnimationFrame(raf))

  return (el: HTMLElement, to: number, format: (v: number) => string, dur: number, delay: number) => {
    cancelAnimationFrame(raf)
    const t0 = performance.now() + delay
    const step = (now: number) => {
      const p = clamp01((now - t0) / dur)
      el.textContent = format(to * ease(p))
      if (p < 1)
        raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }
}

/** 审计日志按 1.5 倍速回放：reset 时先无过渡地退回入场前，再移除 will-enter 并挂 replaying 3.4s。卸载时停止。 */
export function useTraceReplay() {
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    clearTimeout(timer)
  })

  return (panel: HTMLElement, reset: boolean) => {
    if (reset) {
      panel.classList.add('no-trans', 'will-enter')
      panel.getBoundingClientRect()
      panel.classList.remove('no-trans')
    }
    panel.classList.remove('replaying')
    panel.getBoundingClientRect()
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      panel.classList.remove('will-enter')
      panel.classList.add('replaying')
      clearTimeout(timer)
      timer = setTimeout(() => panel.classList.remove('replaying'), 3400)
    })
  }
}
