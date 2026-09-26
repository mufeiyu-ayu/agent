import type { Ref } from 'vue'

import { onBeforeUnmount, onMounted } from 'vue'

import { reducedMotion } from '@/hooks/useHomeMotion'
import { clamp01, ease } from '@/utils/easing'

/*
 * Hero 演示窗口：打字 → 发送 → agent 规划并执行步骤 → 页面渲染 → 回答 → 分享给团队。
 * 每个画面状态都是 t 的纯函数（render(t)）；rAF 只负责推进 t。时间表、机位与缓动照搬设计稿。
 */
const DUR = 18.9
const Q = 'What share of last week\'s topuplist blog posts are indexed on Google?'
const T = {
  typeA: 0.5,
  move: 3.7,
  click: 4.45,
  send: 4.6,
  head: 4.95,
  planned: 5.65,
  split: 7.55,
  real: 8.65,
  bars: 8.85,
  actions: 9.75,
  answerA: 10.8,
  answerB: 12.3,
  verified: 12.6,
  shareMove: 14.2,
  shareClick: 15.0,
  okMove: 15.55,
  okClick: 16.2,
}
const stepT = [[5.95, 6.65], [6.75, 7.45], [7.55, 8.65]] as const
// 像人一样打字：约 20 字/秒带一点抖动，空格后与问号前各停一拍
const typeAt: number[] = []
for (let i = 0, acc = T.typeA; i < Q.length; i++) {
  acc += 0.03 + ((i * 37) % 11) * 0.002 + (Q[i - 1] === ' ' ? 0.06 : 0) + (Q[i] === '?' ? 0.1 : 0)
  typeAt.push(acc)
}
const typeB = typeAt[typeAt.length - 1]!

const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const easeIO = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return (x: number) => {
    let u = x
    for (let k = 0; k < 6; k++) {
      const e = ((ax * u + bx) * u + cx) * u - x
      const d = (3 * ax * u + 2 * bx) * u + cx
      if (Math.abs(e) < 1e-4 || !d)
        break
      u -= e / d
    }
    u = clamp01(u)
    return ((ay * u + by) * u + cy) * u
  }
}
const camEase = bezier(0.4, 0, 0.2, 1)

interface Shot { t: number, el?: HTMLElement, s: number, m?: number, oy?: number, dy?: number }
interface Cam { s: number, tx: number, ty: number }
interface Click { el: HTMLElement, move: number, click: number, chain?: boolean }

export function useHeroTour(demoRef: Readonly<Ref<HTMLElement | null>>) {
  const reduce = reducedMotion()
  let raf = 0
  let io: IntersectionObserver | undefined
  let seek = (_v: number) => {}

  onMounted(() => {
    const demo = demoRef.value!
    const $ = (id: string) => demo.querySelector<HTMLElement>(`#${id}`)!
    const demoBody = $('demoBody')
    const composer = $('composer')
    const composeText = $('composeText')
    const composePh = $('composePh')
    const sendBtn = $('sendBtn')
    const demoChat = $('demoChat')
    const chatEmpty = $('chatEmpty')
    const bubble = $('bubble')
    const agentMsg = $('agentMsg')
    const thinking = $('thinking')
    const skillPill = $('skillPill')
    const stepEls = [...demo.querySelectorAll<HTMLElement>('#steps li')]
    const page = $('demoPage')
    const bars = [...demo.querySelectorAll<SVGRectElement>('.bar')]
    const barCol = bars.map(r => Math.round((r.x.baseVal.value - 57.6) / 61.14)) // 同一列的堆叠段一起生长
    const kpiRev = $('kpiRev')
    const kpiGrowth = $('kpiGrowth')
    const actions = $('pageActions')
    const verified = $('verified')
    const cursor = $('cursor')
    const shareBtn = $('shareBtn')
    const sharePop = $('sharePop')
    const spBtn = $('spBtn')
    const words = [...$('answer').querySelectorAll<HTMLElement>('.w')]
    const scene = $('scene')
    const stepsEl = $('steps')

    // el 相对 root 的未变换布局位置
    function localPos(el: HTMLElement, root: HTMLElement) {
      let x = 0
      let y = 0
      let n: HTMLElement | null = el
      while (n && n !== root) {
        x += n.offsetLeft
        y += n.offsetTop
        if (n === composer)
          x -= n.offsetWidth / 2 // composer 用 translate(-50%) 居中
        n = n.offsetParent as HTMLElement | null
      }
      return { x, y }
    }

    // 指针沿弧线移到目标并点击；除非下一次点击接着从这里出发，否则点完就飘走
    const CLICKS: Click[] = [
      { el: sendBtn, move: T.move, click: T.click },
      { el: shareBtn, move: T.shareMove, click: T.shareClick },
      { el: spBtn, move: T.okMove, click: T.okClick, chain: true },
    ]
    const clickPts: { x: number, y: number }[] = []
    function clickPoint(i: number, t: number) {
      const c = CLICKS[i]!
      // 点击后不久之前一直跟随目标，之后钉住位置（发送后 composer 会滑走）
      if (t < c.click + 0.15 || !clickPts[i]) {
        const p = localPos(c.el, demo)
        clickPts[i] = { x: p.x + c.el.offsetWidth * 0.5, y: p.y + c.el.offsetHeight * 0.55 }
      }
      return clickPts[i]!
    }
    function pointer(t: number) {
      let i = CLICKS.length - 1
      while (i > 0 && t < CLICKS[i]!.move) i--
      const c = CLICKS[i]!
      const next = CLICKS[i + 1]
      if (t < c.move)
        return null
      const end = clickPoint(i, t)
      if (t >= c.click - 0.05) {
        if (t < c.click + 0.25 || (next && next.chain))
          return { x: end.x, y: end.y, o: 1, down: t >= c.click && t < c.click + 0.14 }
        const p = ease(clamp01((t - c.click - 0.25) / 0.5))
        return p < 1 ? { x: lerp(end.x, end.x + 46, p), y: lerp(end.y, end.y + 36, p), o: 1 - p, down: false } : null
      }
      const start = c.chain ? clickPoint(i - 1, t) : { x: end.x - demo.offsetWidth * 0.12, y: end.y - demo.offsetHeight * 0.2 }
      const ctrl = c.chain ? { x: end.x, y: start.y } : { x: end.x - 20, y: start.y + 20 }
      const p = easeIO(clamp01((t - c.move) / (c.click - 0.05 - c.move)))
      const ax = lerp(start.x, ctrl.x, p)
      const ay = lerp(start.y, ctrl.y, p)
      return { x: lerp(ax, lerp(ctrl.x, end.x, p), p), y: lerp(ay, lerp(ctrl.y, end.y, p), p), o: c.chain ? 1 : clamp01((t - c.move) / 0.15), down: false }
    }

    // 镜头：跟随动作缩放（Screen Studio 风格），带一点运动模糊。
    // 每个机位的终点先夹取再插值；机位落定后缓存终点，下一段从镜头真实所在处出发（不实时追踪）。
    const SHOTS: Shot[] = [
      { t: 0, s: 1 },
      { t: 0.25, el: composer, s: 1.5, oy: -0.1, m: 1.1 },
      { t: 4.6, el: stepsEl, s: 1.35, m: 1.2 },
      { t: 6.7, s: 1, m: 1.0 },
      { t: 8.1, el: page, s: 1.28, dy: -0.05, m: 1.1 },
      { t: 9.9, el: agentMsg, s: 1.4, m: 1.2 },
      { t: 13.4, s: 1, m: 1.1 },
    ]
    const cam = { s: 1, tx: 0, ty: 0, t: -1 }
    const rest: (Cam & { W: number, H: number })[] = []
    function endpoint(sh: Shot, W: number, H: number): Cam {
      // 窄窗口缩放更轻，文字不会出画
      const zk = Math.min(1, Math.max(0.2, (W - 360) / 640))
      const s = reduce ? 1 : 1 + (sh.s - 1) * zk
      if (!sh.el)
        return { s, tx: (W - s * W) / 2, ty: (H - s * H) / 2 }
      const q = localPos(sh.el, scene)
      const x = q.x + sh.el.offsetWidth / 2
      const y = q.y + sh.el.offsetHeight * (0.5 + (sh.dy || 0))
      return {
        s,
        tx: Math.min(0, Math.max(W - s * W, W / 2 - s * x)),
        ty: Math.min(0, Math.max(H - s * H, H * (0.5 + (sh.oy || 0)) - s * y)),
      }
    }
    function settled(k: number, W: number, H: number) {
      const r = rest[k]
      return r && r.W === W && r.H === H ? r : (rest[k] = { ...endpoint(SHOTS[k]!, W, H), W, H })
    }
    function camera(t: number) {
      const W = scene.offsetWidth
      const H = scene.offsetHeight
      let i = 0
      while (i + 1 < SHOTS.length && SHOTS[i + 1]!.t <= t) i++
      const p = i > 0 ? camEase(clamp01((t - SHOTS[i]!.t) / SHOTS[i]!.m!)) : 1
      let st: Cam
      if (p >= 1) {
        st = settled(i, W, H)
      }
      else {
        const a = settled(i - 1, W, H)
        const b = endpoint(SHOTS[i]!, W, H)
        st = { s: lerp(a.s, b.s, p), tx: lerp(a.tx, b.tx, p), ty: lerp(a.ty, b.ty, p) }
      }
      const dt = t - cam.t
      const speed = dt > 0 && dt < 0.2 ? (Math.abs(st.s - cam.s) * 0.6 + Math.hypot(st.tx - cam.tx, st.ty - cam.ty) * 0.0012) / dt : 0
      const blur = Math.min(0.6, speed * 0.45) / st.s
      cam.s = st.s
      cam.tx = st.tx
      cam.ty = st.ty
      cam.t = t
      scene.style.transform = `translate(${st.tx.toFixed(2)}px, ${st.ty.toFixed(2)}px) scale(${st.s.toFixed(4)})`
      scene.style.filter = blur > 0.12 ? `blur(${blur.toFixed(2)}px)` : ''
    }

    // 窗口落定后从空输入框开始；减少动效时直接展示跑完的结果
    let tt = reduce ? 17.2 : -1.4
    let playing = !reduce
    let inView = true
    let lastT = 0
    let looped = false

    function render(t: number) {
      let n = 0
      if (t < T.send) {
        while (n < typeAt.length && typeAt[n]! <= t) n++
      }
      composeText.textContent = Q.slice(0, n)
      composePh.hidden = n > 0
      composer.classList.toggle('is-typing', t >= T.typeA && t < T.send)
      composer.classList.toggle('is-keying', t >= T.typeA && t < typeB + 0.05)
      sendBtn.classList.toggle('is-ready', n > 0)
      sendBtn.classList.toggle('is-pressed', t >= T.click && t < T.click + 0.14)

      const cur = pointer(t)
      cursor.style.opacity = cur ? cur.o.toFixed(2) : '0'
      if (cur)
        cursor.style.translate = `${(cur.x - 5.8).toFixed(1)}px ${(cur.y - 2.9).toFixed(1)}px`
      cursor.classList.toggle('is-down', !!(cur && cur.down))
      // 点击涟漪属于按钮，跟着按钮走
      const rp = clamp01((t - T.click) / 0.3)
      sendBtn.style.setProperty('--ro', t >= T.click && rp < 1 ? (0.5 * (1 - rp)).toFixed(2) : '0')
      sendBtn.style.setProperty('--rs', (1 + 0.8 * rp).toFixed(2))

      const sent = t >= T.send
      demoChat.classList.toggle('is-fresh', !sent)
      chatEmpty.classList.toggle('is-off', sent)
      bubble.classList.toggle('is-off', !sent)
      agentMsg.classList.toggle('is-off', t < T.head)
      const live = t < T.planned
      thinking.hidden = !live
      skillPill.hidden = live
      thinking.classList.toggle('is-live', live)
      stepEls.forEach((li, i) => {
        const [a, b] = stepT[i]!
        li.classList.toggle('is-off', t < a)
        li.classList.toggle('is-run', t >= a && t < b)
        li.classList.toggle('is-done', t >= b)
      })

      demoBody.classList.toggle('is-split', t >= T.split)
      page.dataset.phase = t < T.real ? 'skel' : 'real'
      page.classList.toggle('is-landing', t >= T.real && t < T.real + 0.9)
      // 手机上页面抽屉给回答让位，要分享时再升上来
      page.classList.toggle('is-peek', t >= T.answerA - 0.2 && t < T.shareMove - 0.4)
      bars.forEach((r, j) => r.style.setProperty('--g', String(ease(clamp01((t - T.bars - barCol[j]! * 0.06) / 0.6)))))
      const kp = ease(clamp01((t - T.real - 0.3) / 0.8))
      kpiRev.textContent = `${Math.round(71 * kp)}%`
      kpiGrowth.textContent = `${Math.round(30 * kp)} / 42`
      actions.classList.toggle('is-off', t < T.actions)

      const k = t >= T.answerB ? words.length : Math.floor(clamp01((t - T.answerA) / (T.answerB - T.answerA)) * words.length)
      words.forEach((w, i) => w.classList.toggle('is-off', i >= k))
      verified.classList.toggle('is-off', t < T.verified)
      const popOpen = t >= T.shareClick + 0.08
      shareBtn.classList.toggle('is-open', popOpen)
      shareBtn.classList.toggle('is-pressed', t >= T.shareClick && t < T.shareClick + 0.14)
      sharePop.classList.toggle('is-off', !popOpen)
      spBtn.classList.toggle('is-pressed', t >= T.okClick && t < T.okClick + 0.14)
      spBtn.classList.toggle('is-done', t >= T.okClick + 0.1)
      camera(t)
      // 循环接缝处轻淡出；首次加载不淡入
      scene.style.opacity = t > DUR - 0.35 ? ((DUR - t) / 0.35).toFixed(2) : looped && t < 0.25 ? (t / 0.25).toFixed(2) : ''
    }

    // 跳到 t 时不让 CSS 过渡把布局倒着回放一遍
    function cut(t: number) {
      demo.classList.add('cam-cut')
      render(t)
      demo.getBoundingClientRect()
      demo.classList.remove('cam-cut')
    }
    render(Math.max(0, tt))
    function tick(now: number) {
      if (!lastT)
        lastT = now
      const dt = Math.min(0.1, (now - lastT) / 1000)
      lastT = now
      if (playing && inView && !document.hidden) {
        tt += dt
        if (tt >= DUR) {
          tt -= DUR
          looped = true
          cut(tt)
        }
        else {
          render(Math.max(0, tt))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // 观察外层舞台，而不是里面被缩放的画面
    io = new IntersectionObserver(([e]) => {
      inView = e!.isIntersecting
    }, { threshold: 0.1 })
    io.observe(demo.closest('.hero-stage')!)

    seek = (v: number) => {
      tt = Math.max(0, Math.min(DUR - 0.01, v))
      looped = true
      cut(tt)
      playing = true
    }
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    io?.disconnect()
  })

  /** Watch the tour：从 0 开始播；窗口没完整可见时滚过去。 */
  function playTour() {
    seek(0)
    const demo = demoRef.value!
    const r = demo.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight)
      demo.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  }

  return { playTour }
}
