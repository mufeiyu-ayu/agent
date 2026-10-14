import type { GoogleDataConnection, GoogleDataResource, GoogleDataService, GoogleDataVerification } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cancelGoogleData, connectGoogleData, disconnectGoogleData, getGoogleData, getGoogleResources, selectGoogleResource, verifyGoogleData } from '@/api/google-data'

export function useGoogleData() {
  const { t, te } = useI18n()
  const connection = ref<GoogleDataConnection | null>(null)
  const open = ref(false)
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const resourceErrors = ref<Partial<Record<GoogleDataService, string>>>({})
  const requested = ref<GoogleDataService[]>(['gsc'])
  const sites = ref<GoogleDataResource[]>([])
  const properties = ref<GoogleDataResource[]>([])
  const streams = ref<GoogleDataResource[]>([])
  const site = ref('')
  const property = ref('')
  const stream = ref('')
  const verification = ref<Partial<Record<GoogleDataService, GoogleDataVerification>>>({})
  watch(site, () => {
    delete verification.value.gsc
  })
  watch([property, stream], () => {
    delete verification.value.ga4
  })
  const controller = new AbortController()
  let alive = true
  let epoch = 0
  function update(value: GoogleDataConnection) {
    if (connection.value?.revision !== value.revision) {
      verification.value = {}
      sites.value = []
      properties.value = []
      streams.value = []
    }
    connection.value = value
    site.value = value.selection.gscSite ?? ''
    property.value = value.selection.ga4Property ?? ''
    stream.value = value.selection.ga4Stream ?? ''
  }
  function message(cause: unknown) {
    const reason = isAxiosError(cause) ? cause.response?.data?.message : undefined
    const key = typeof reason === 'string' ? `googleData.errors.${reason}` : ''
    return key && te(key) ? t(key) : t('googleData.errors.operationFailed')
  }
  async function reload() {
    const read = ++epoch
    try {
      const value = await getGoogleData(controller.signal)
      if (alive && read === epoch)
        update(value)
    }
    catch (cause) {
      if (alive && read === epoch)
        error.value = message(cause)
    }
  }
  async function run(operation: () => Promise<void>, redirect = false) {
    if (busy.value)
      return
    busy.value = true
    error.value = ''
    notice.value = ''
    ++epoch
    let completed = false
    try {
      await operation()
      completed = true
    }
    catch (cause) {
      if (alive) {
        error.value = message(cause)
        await reload()
      }
    }
    finally {
      if (alive && (!redirect || !completed))
        busy.value = false
    }
  }
  async function resources() {
    await run(async () => {
      const value = await getGoogleData(controller.signal)
      if (!alive)
        return
      update(value)
      if (!value.connected || value.needsAuth || value.authorizing)
        return
      resourceErrors.value = {}
      const [s, p] = await Promise.allSettled([
        value.services.includes('gsc') ? getGoogleResources('gsc', controller.signal) : [],
        value.services.includes('ga4') ? getGoogleResources('ga4', controller.signal) : [],
      ])
      if (!alive)
        return
      sites.value = s.status === 'fulfilled' ? s.value : []
      properties.value = p.status === 'fulfilled' ? p.value : []
      if (s.status === 'rejected')
        resourceErrors.value.gsc = message(s.reason)
      if (p.status === 'rejected')
        resourceErrors.value.ga4 = message(p.reason)
      if (p.status === 'fulfilled' && property.value) {
        try {
          const values = await getGoogleResources('ga4', controller.signal, property.value)
          if (alive)
            streams.value = values
        }
        catch (cause) {
          if (alive)
            resourceErrors.value.ga4 = message(cause)
        }
      }
      if (resourceErrors.value.gsc || resourceErrors.value.ga4)
        await reload()
    })
  }
  async function preview() {
    open.value = true
    if (connection.value?.services.length)
      requested.value = [...connection.value.services]
    await resources()
  }
  async function changeProperty() {
    streams.value = []
    stream.value = ''
    verification.value.ga4 = undefined
    await run(async () => {
      if (property.value) {
        const values = await getGoogleResources('ga4', controller.signal, property.value)
        if (alive)
          streams.value = values
      }
    })
  }
  async function save(service: GoogleDataService) {
    await run(async () => {
      if (!connection.value)
        return
      const value = await selectGoogleResource(service, connection.value.revision, service === 'gsc' ? site.value : property.value, service === 'ga4' ? stream.value : undefined, controller.signal)
      if (alive) {
        update(value)
        notice.value = t('googleData.saved')
      }
    })
    if (!error.value)
      await resources()
  }
  async function verify(service: GoogleDataService) {
    delete verification.value[service]
    await run(async () => {
      const revision = connection.value?.revision
      if (revision === undefined)
        return
      const value = await verifyGoogleData(service, revision, controller.signal)
      if (alive && value.revision === connection.value?.revision)
        verification.value[service] = value
    })
  }
  async function connect() {
    await run(async () => {
      const value = await connectGoogleData(requested.value, controller.signal)
      if (!alive)
        return
      const url = new URL(value.authorizationUrl)
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth')
        throw new Error('invalid authorization URL')
      window.location.assign(url.toString())
    }, true)
  }
  async function cancel() {
    await run(async () => {
      const value = await cancelGoogleData(controller.signal)
      if (alive)
        update(value)
    })
  }
  async function disconnect() {
    await run(async () => {
      const value = await disconnectGoogleData(controller.signal)
      if (alive)
        update(value)
    })
  }
  function pageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      busy.value = false
      void reload()
    }
  }
  onMounted(() => {
    window.addEventListener('pageshow', pageShow)
    void reload()
  })
  onScopeDispose(() => {
    alive = false
    ++epoch
    controller.abort()
    window.removeEventListener('pageshow', pageShow)
  })
  return { connection, open, busy, error, notice, resourceErrors, requested, sites, properties, streams, site, property, stream, verification, reload, preview, resources, changeProperty, save, verify, connect, cancel, disconnect }
}
