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
  const verificationErrors = ref<Partial<Record<GoogleDataService, string>>>({})
  const progress = ref<{ service: GoogleDataService, phase: 'saving' | 'verifying' } | null>(null)
  watch(site, () => {
    delete verification.value.gsc
    delete verificationErrors.value.gsc
  }, { flush: 'sync' })
  watch([property, stream], () => {
    delete verification.value.ga4
    delete verificationErrors.value.ga4
  }, { flush: 'sync' })
  const controller = new AbortController()
  let alive = true
  let epoch = 0
  function update(value: GoogleDataConnection) {
    if (connection.value?.revision !== value.revision) {
      verification.value = {}
      verificationErrors.value = {}
    }
    if (connection.value?.email !== value.email || !value.connected || value.needsAuth) {
      resourceErrors.value = {}
      sites.value = []
      properties.value = []
      streams.value = []
    }
    if (property.value !== (value.selection.ga4Property ?? ''))
      streams.value = []
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
        if (connection.value)
          update(connection.value)
        await reload()
        if (connection.value?.connected && !connection.value.needsAuth && property.value && !streams.value.length) {
          try {
            const values = await getGoogleResources('ga4', controller.signal, property.value)
            if (alive)
              streams.value = values
          }
          catch (restoreError) {
            if (alive)
              resourceErrors.value.ga4 = message(restoreError)
          }
        }
      }
    }
    finally {
      if (alive && (!redirect || !completed)) {
        busy.value = false
        progress.value = null
      }
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
  async function verifySaved(service: GoogleDataService) {
    const revision = connection.value?.revision
    if (revision === undefined)
      return
    delete verification.value[service]
    delete verificationErrors.value[service]
    progress.value = { service, phase: 'verifying' }
    try {
      const value = await verifyGoogleData(service, revision, controller.signal)
      if (alive && value.revision === connection.value?.revision)
        verification.value[service] = value
    }
    catch (cause) {
      if (alive) {
        verificationErrors.value[service] = message(cause)
        await reload()
        if (connection.value?.revision !== revision && !connection.value?.needsAuth)
          error.value = message(cause)
      }
    }
  }
  async function saveSelection(service: GoogleDataService) {
    const current = connection.value
    if (!current || busy.value || (service === 'gsc' ? !site.value : !property.value || !stream.value))
      return
    if (service === 'gsc'
      ? site.value === current.selection.gscSite
      : property.value === current.selection.ga4Property && stream.value === current.selection.ga4Stream) {
      return
    }
    await run(async () => {
      progress.value = { service, phase: 'saving' }
      const value = await selectGoogleResource(service, current.revision, service === 'gsc' ? site.value : property.value, service === 'ga4' ? stream.value : undefined, controller.signal)
      if (!alive)
        return
      // 保存响应可能包含另一个标签页的最新选择；验证前先同步本服务，保留另一服务草稿。
      connection.value = value
      verification.value = {}
      if (current.selection.gscSite !== value.selection.gscSite)
        delete verificationErrors.value.gsc
      if (current.selection.ga4Property !== value.selection.ga4Property || current.selection.ga4Stream !== value.selection.ga4Stream)
        delete verificationErrors.value.ga4
      if (service === 'gsc') {
        site.value = value.selection.gscSite ?? ''
      }
      else {
        const propertyChanged = property.value !== (value.selection.ga4Property ?? '')
        property.value = value.selection.ga4Property ?? ''
        stream.value = value.selection.ga4Stream ?? ''
        if (propertyChanged) {
          streams.value = []
          try {
            const values = property.value ? await getGoogleResources('ga4', controller.signal, property.value) : []
            if (alive)
              streams.value = values
          }
          catch (cause) {
            if (alive)
              resourceErrors.value.ga4 = message(cause)
          }
        }
      }
      if (alive)
        await verifySaved(service)
    })
  }
  async function retryVerification(service: GoogleDataService) {
    await run(() => verifySaved(service))
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
  return { connection, open, busy, error, notice, resourceErrors, requested, sites, properties, streams, site, property, stream, verification, verificationErrors, progress, reload, preview, resources, changeProperty, saveSelection, retryVerification, connect, cancel, disconnect }
}
