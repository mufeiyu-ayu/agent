import type { Ref } from 'vue'

import { onBeforeUnmount, onMounted } from 'vue'

import { reducedMotion } from '@/hooks/useHomeMotion'

/*
 * Connect 场景：打字机轮播问题；每问打完走一遍路由（发送 → 光点下落 → Gateway 校验 → 放行、连线点亮 → 命中数据源）。
 * 时间常量照搬设计稿。
 */
const asks: { q: string, hit: Partial<Record<SourceKey, string>> }[] = [
  { q: 'Which landing pages lost the most clicks this week?', hit: { gsc: '214 pages' } },
  { q: 'List orders over $500 that haven’t shipped yet.', hit: { orders: '37 orders' } },
  { q: 'Did the Germany redesign lift organic sessions and orders?', hit: { ga4: '90 days', orders: '412 orders' } },
  { q: 'Summarize the Q3 finance report in five bullet points.', hit: { finance: '3 files' } },
]
const names = { gsc: 'Search Console', ga4: 'GA4', orders: 'Orders API', finance: 'Finance' }
type SourceKey = keyof typeof names

export function useConnectRouting(routeRef: Readonly<Ref<HTMLElement | null>>) {
  const reduce = reducedMotion()
  let routeTimers: ReturnType<typeof setTimeout>[] = []
  let typeTimer: ReturnType<typeof setTimeout> | undefined
  let fanRO: ResizeObserver | undefined
  let visibleIO: IntersectionObserver | undefined
  let typingStarted = false
  let startTyping = (_fromEmpty: boolean) => {}

  onMounted(() => {
    const route = routeRef.value!
    const fan = route.querySelector<SVGSVGElement>('.fan')!
    const typeEl = route.querySelector<HTMLElement>('#typeText')!
    const gateway = route.querySelector<HTMLElement>('#gateway')!
    const gwState = gateway.querySelector('em')!
    const askSend = route.querySelector<HTMLElement>('#askSend')!
    const askStatus = route.querySelector<HTMLElement>('#askStatus')!
    const tileEls = [...route.querySelectorAll<HTMLElement>('.tile')]
    const hotEls = [...fan.querySelectorAll('.hot')]
    const tileOf = Object.fromEntries(tileEls.map(el => [el.dataset.k, el])) as Record<SourceKey, HTMLElement>
    const hotOf = Object.fromEntries(tileEls.map((el, i) => [el.dataset.k, hotEls[i]])) as Record<SourceKey, Element>

    function drawFan() {
      const W = fan.clientWidth
      const H = fan.clientHeight
      if (!W)
        return
      fan.setAttribute('viewBox', `0 0 ${W} ${H}`)
      const base = fan.querySelectorAll('.base')
      tileEls.forEach((el, i) => {
        const x = (el.offsetLeft + el.offsetWidth / 2).toFixed(1) // 卡片和扇形都贴着 route 左边缘
        const d = `M${W / 2} 0 C${W / 2} ${(H * 0.6).toFixed(1)} ${x} ${(H * 0.4).toFixed(1)} ${x} ${H}`
        base[i]!.setAttribute('d', d)
        hotEls[i]!.setAttribute('d', d)
      })
    }
    drawFan()
    fanRO = new ResizeObserver(drawFan)
    fanRO.observe(route)

    const later = (ms: number, fn: () => void) => routeTimers.push(setTimeout(fn, ms))
    // 状态栏文案都是写死的常量，不含外部输入
    function setStatus(html: string, busy: boolean) {
      askStatus.lastElementChild!.innerHTML = html
      askStatus.classList.toggle('is-busy', busy)
    }
    function routeOff() {
      routeTimers.forEach(clearTimeout)
      routeTimers = []
      route.classList.remove('is-sending', 'is-routing')
      gateway.classList.remove('is-check', 'is-ok')
      gwState.textContent = 'read-only'
      tileEls.forEach(el => el.classList.remove('is-hit'))
      Object.values(hotOf).forEach(h => h.classList.remove('is-on'))
      setStatus('4 sources connected', false)
    }
    function routeOn(a: typeof asks[number]) {
      routeOff()
      const keys = Object.keys(a.hit) as SourceKey[]
      const label = keys.map(k => names[k]).join(' + ')
      askSend.classList.add('is-pressed')
      later(150, () => {
        askSend.classList.remove('is-pressed')
        route.classList.add('is-sending')
        setStatus('Checking access…', true)
      })
      later(520, () => {
        gateway.classList.add('is-check')
        gwState.textContent = 'checking'
      })
      later(980, () => {
        gateway.classList.replace('is-check', 'is-ok')
        gwState.textContent = 'allowed'
        keys.forEach(k => hotOf[k].classList.add('is-on'))
        setStatus(`Reading ${label}…`, true)
      })
      later(1420, () => {
        route.classList.add('is-routing')
        keys.forEach((k) => {
          tileOf[k].querySelector('.tile-hit > span')!.textContent = a.hit[k]!
          tileOf[k].classList.add('is-hit')
        })
        setStatus(`Answered from <b>${label}</b> · 1.4 s`, false)
      })
    }

    startTyping = (fromEmpty) => {
      if (typingStarted)
        return
      typingStarted = true
      if (reduce) {
        routeOn(asks[0]!)
        return
      }
      let qi = 0
      let ci = fromEmpty ? 0 : asks[0]!.q.length
      let mode = fromEmpty ? 'type' : 'hold'
      let askVisible = true
      if (fromEmpty)
        typeEl.textContent = ''
      else
        routeOn(asks[0]!)
      visibleIO = new IntersectionObserver(([e]) => {
        askVisible = e!.isIntersecting
      })
      visibleIO.observe(route)
      const typeStep = () => {
        if (!askVisible) {
          typeTimer = setTimeout(typeStep, 400)
          return
        }
        let delay: number
        if (mode === 'hold') {
          mode = 'del'
          delay = 14
          routeOff()
        }
        else if (mode === 'del') {
          ci = Math.max(0, ci - 2)
          delay = 14
          if (ci === 0) {
            qi = (qi + 1) % asks.length
            mode = 'type'
            delay = 380
          }
        }
        else {
          ci += 1
          delay = 34 + Math.random() * 40
          if (ci >= asks[qi]!.q.length) {
            mode = 'hold'
            delay = 4200
            routeOn(asks[qi]!)
          }
        }
        typeEl.textContent = asks[qi]!.q.slice(0, ci)
        typeTimer = setTimeout(typeStep, delay)
      }
      typeTimer = setTimeout(typeStep, fromEmpty ? 1100 : 4200)
    }
  })

  onBeforeUnmount(() => {
    routeTimers.forEach(clearTimeout)
    clearTimeout(typeTimer)
    fanRO?.disconnect()
    visibleIO?.disconnect()
  })

  return { startTyping: (fromEmpty: boolean) => startTyping(fromEmpty) }
}
