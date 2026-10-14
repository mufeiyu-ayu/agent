<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import { useGoogleData } from '@/hooks/useGoogleData'

const { t } = useI18n()
const g = useGoogleData()
const route = useRoute()
const router = useRouter()
const confirmingDisconnect = ref(false)
const editingAuthorization = ref(false)
const returned = route.query.googleData
const status = computed(() => !g.connection.value?.configured
  ? 'unconfigured'
  : g.connection.value.authorizing
    ? 'authorizing'
    : g.connection.value.needsAuth
      ? 'needsAuth'
      : g.connection.value.connected ? 'connected' : 'disconnected')
const ready = computed(() => status.value === 'connected')
const inputClass = 'mt-2 w-full rounded-lg border border-agent-border bg-agent-surface px-3 py-2 text-sm disabled:opacity-50'
const primaryClass = 'flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-agent-ink px-3 text-sm font-medium text-agent-surface transition-opacity hover:opacity-90 disabled:opacity-40'
const secondaryClass = 'flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-agent-border bg-agent-surface px-3 text-sm font-medium text-agent-ink transition-colors hover:bg-agent-surface-raised disabled:opacity-40'
watch(g.open, () => {
  editingAuthorization.value = false
  confirmingDisconnect.value = false
})
let handled = false
watch(g.connection, async (value) => {
  if (!value?.connected)
    confirmingDisconnect.value = false
  if (!value || handled || !returned)
    return
  handled = true
  const { googleData: _, ...query } = route.query
  await router.replace({ query })
  await g.preview()
  g.notice.value = returned === 'connected' && value.connected && !value.needsAuth
    ? t('googleData.authorized')
    : t('googleData.errors.authorizationFailed')
})
defineExpose({ reload: g.reload })
</script>

<template>
  <div data-connection-id="google-data" class="group flex min-w-0 items-center rounded-xl transition-colors hover:bg-agent-surface-raised">
    <button class="flex min-w-0 flex-1 items-center gap-3 px-2 py-4 text-left" @click="g.preview">
      <span class="grid size-10 shrink-0 place-items-center rounded-[10px] border border-agent-border bg-agent-surface"><AppIcon name="logos:google-icon" :size="23" /></span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-agent-ink">{{ t('googleData.title') }}</span>
        <span class="mt-1 block truncate text-xs text-agent-ink-muted">{{ t(`googleData.status.${status}`) }}</span>
      </span>
      <AppIcon name="tabler:chevron-right" :size="18" class="text-agent-ink-muted" />
    </button>
    <DialogRoot :open="g.open.value" @update:open="!g.busy.value && (g.open.value = $event)">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
        <DialogContent class="fixed inset-0 z-50 m-auto h-fit max-h-[88dvh] w-[min(620px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-agent-border bg-agent-surface p-5 text-agent-ink shadow-2xl sm:p-7" @escape-key-down="g.busy.value && $event.preventDefault()" @interact-outside="g.busy.value && $event.preventDefault()">
          <div class="flex items-start justify-between gap-4">
            <div>
              <DialogTitle class="text-lg font-semibold">
                {{ t('googleData.title') }}
              </DialogTitle>
              <DialogDescription class="mt-2 text-sm text-agent-ink-muted">
                {{ t('googleData.description') }}
              </DialogDescription>
            </div>
            <button :disabled="g.busy.value" :aria-label="t('plugins.close')" class="p-1 disabled:opacity-40" @click="g.open.value = false">
              <AppIcon name="tabler:x" :size="20" />
            </button>
          </div>
          <p v-if="g.error.value" role="alert" class="mt-4 text-sm text-red-600">
            {{ g.error.value }}
          </p>
          <p v-if="g.notice.value" role="status" class="mt-4 text-sm text-agent-ink-muted">
            {{ g.notice.value }}
          </p>
          <p v-if="!g.connection.value" class="mt-5 text-sm">
            {{ t('plugins.loading') }}
          </p>
          <template v-else>
            <div class="mt-5 rounded-xl bg-agent-surface-raised p-4 text-sm">
              <p>{{ t(`googleData.status.${status}`) }}</p>
              <p v-if="g.connection.value.email" class="mt-1 break-all text-agent-ink-muted">
                {{ g.connection.value.email }}
              </p>
            </div>
            <p v-if="!g.connection.value.configured" class="mt-4 text-sm text-agent-ink-muted">
              {{ t('googleData.setup') }}
            </p>
            <div class="mt-5">
              <template v-if="g.connection.value.configured && (!ready || editingAuthorization)">
                <p class="text-sm font-medium">
                  {{ t('googleData.chooseServices') }}
                </p>
                <div class="mt-3 flex flex-wrap gap-5">
                  <label v-for="service in ['gsc', 'ga4'] as const" :key="service" class="flex items-center gap-2 text-sm">
                    <input v-model="g.requested.value" type="checkbox" :value="service" :disabled="g.busy.value || g.connection.value.authorizing">{{ t(`googleData.${service}`) }}
                  </label>
                </div>
                <p class="mt-3 text-xs leading-5 text-agent-ink-muted">
                  {{ t('googleData.consent') }} <RouterLink to="/privacy" class="underline">
                    {{ t('googleData.privacy') }}
                  </RouterLink>
                </p>
              </template>
              <div class="mt-4 flex items-stretch gap-3" data-google-actions>
                <button v-if="g.connection.value.authorizing" :disabled="g.busy.value" :class="primaryClass" @click="g.cancel">
                  <span>{{ t('googleData.cancel') }}</span>
                </button>
                <button v-else :disabled="g.busy.value || !g.connection.value.configured || ((!ready || editingAuthorization) && !g.requested.value.length)" :class="primaryClass" @click="ready && !editingAuthorization ? editingAuthorization = true : g.connect()">
                  <AppIcon :name="g.busy.value && !g.progress.value ? 'tabler:loader-2' : 'tabler:refresh'" :size="18" class="shrink-0" :class="{ 'animate-spin': g.busy.value && !g.progress.value }" />
                  <span>{{ t(ready && !editingAuthorization ? 'googleData.reconnect' : g.connection.value.connected ? 'googleData.continueAuthorization' : 'googleData.connect') }}</span>
                </button>
                <button v-if="g.connection.value.connected" :disabled="g.busy.value" :class="secondaryClass" @click="confirmingDisconnect ? g.disconnect() : confirmingDisconnect = true">
                  <AppIcon name="tabler:link-off" :size="18" class="shrink-0" />
                  <span>{{ t(confirmingDisconnect ? 'googleData.confirmDisconnect' : 'googleData.disconnect') }}</span>
                </button>
              </div>
              <div v-if="confirmingDisconnect" class="mt-3 rounded-xl bg-agent-surface-raised/60 px-3.5 py-2.5 text-xs leading-5 text-agent-ink-muted">
                {{ t('googleData.disconnectHint') }}
                <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer" class="underline">{{ t('googleData.googlePermissions') }}</a>
                <button :disabled="g.busy.value" class="ml-2 underline disabled:opacity-40" @click="confirmingDisconnect = false">
                  {{ t('plugins.cancel') }}
                </button>
              </div>
            </div>
            <div v-if="ready" class="mt-6 space-y-5">
              <section v-for="service in g.connection.value.services" :key="service" class="border-t border-agent-border pt-5">
                <h3 class="text-sm font-semibold">
                  {{ t(`googleData.${service}`) }}
                </h3>
                <p v-if="g.resourceErrors.value[service]" role="alert" class="mt-2 text-xs text-red-600">
                  {{ g.resourceErrors.value[service] }}
                  <button :disabled="g.busy.value" class="ml-2 underline disabled:opacity-40" @click="g.resources">
                    {{ t('googleData.retry') }}
                  </button>
                </p>
                <template v-if="service === 'gsc'">
                  <label class="mt-3 block text-sm">{{ t('googleData.site') }}
                    <select v-model="g.site.value" :disabled="g.busy.value" :class="inputClass" @change="g.saveSelection('gsc')">
                      <option value="" disabled>{{ t('googleData.chooseResource') }}</option>
                      <option v-for="item in g.sites.value" :key="item.id" :value="item.id">{{ item.name }}</option>
                    </select>
                  </label>
                  <p v-if="!g.busy.value && !g.resourceErrors.value.gsc && !g.sites.value.length" class="mt-2 text-xs text-agent-ink-muted">
                    {{ t('googleData.noSites') }}
                  </p>
                </template>
                <template v-else>
                  <label class="mt-3 block text-sm">{{ t('googleData.property') }}
                    <select v-model="g.property.value" :disabled="g.busy.value" :class="inputClass" @change="g.changeProperty">
                      <option value="" disabled>{{ t('googleData.chooseResource') }}</option>
                      <option v-for="item in g.properties.value" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id }}</option>
                    </select>
                  </label>
                  <label class="mt-3 block text-sm">{{ t('googleData.stream') }}
                    <select v-model="g.stream.value" :disabled="g.busy.value || !g.property.value" :class="inputClass" @change="g.saveSelection('ga4')">
                      <option value="" disabled>{{ t('googleData.chooseResource') }}</option>
                      <option v-for="item in g.streams.value" :key="item.id" :value="item.id">{{ item.name }} · {{ item.url || t('googleData.noWebsite') }}</option>
                    </select>
                  </label>
                  <p class="mt-2 text-xs text-agent-ink-muted">
                    {{ t('googleData.productionStream') }}
                  </p>
                  <p v-if="!g.busy.value && !g.resourceErrors.value.ga4 && (!g.properties.value.length || (g.property.value && !g.streams.value.length))" class="mt-2 text-xs text-agent-ink-muted">
                    {{ t('googleData.noProperties') }}
                  </p>
                </template>
                <p v-if="g.progress.value?.service === service" role="status" class="mt-3 flex items-center gap-2 text-xs text-agent-ink-muted">
                  <AppIcon name="tabler:loader-2" :size="14" class="animate-spin" />{{ t(`googleData.${g.progress.value.phase}`) }}
                </p>
                <p v-else-if="g.verificationErrors.value[service]" role="alert" class="mt-3 text-xs text-red-600">
                  {{ t('googleData.savedVerificationFailed') }} {{ g.verificationErrors.value[service] }}
                  <button :disabled="g.busy.value" class="ml-2 underline disabled:opacity-40" @click="g.retryVerification(service)">
                    {{ t('googleData.retry') }}
                  </button>
                </p>
                <p v-if="g.verification.value[service]" role="status" class="mt-3 text-xs text-agent-ink-muted">
                  {{ t(g.verification.value[service]?.hasData ? 'googleData.verified' : 'googleData.verifiedEmpty') }} · {{ new Date(g.verification.value[service]!.checkedAt).toLocaleString() }}
                </p>
              </section>
              <p class="text-xs text-agent-ink-muted">
                {{ t('googleData.autoSaveHint') }}
              </p>
            </div>
          </template>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
