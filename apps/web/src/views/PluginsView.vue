<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import GoogleDataCard from '@/components/plugins/GoogleDataCard.vue'
import PluginDetailsDialog from '@/components/plugins/PluginDetailsDialog.vue'
import PluginEditorDialog from '@/components/plugins/PluginEditorDialog.vue'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { usePlugins } from '@/hooks/usePlugins'
import { pluginIconName } from '@/utils/plugin-icon-name'
import { pluginText } from '@/utils/plugin-text'

const { locale, t } = useI18n()

const p = usePlugins()
const google = ref<InstanceType<typeof GoogleDataCard>>()
const search = ref('')
const tab = ref<'system' | 'personal'>('system')
const showGoogle = computed(() => tab.value === 'system' && `${t('googleData.title')} Google Search Console GSC GA4 Analytics`.toLowerCase().includes(search.value.trim().toLowerCase()))
const route = useRoute()
const router = useRouter()
const oauthNotice = ref(
  route.query.oauth === 'connected'
    ? t('plugins.oauthConnected')
    : route.query.oauth === 'failed'
      ? t('plugins.oauthFailed')
      : '',
)
if (route.query.oauth === 'connected' || route.query.oauth === 'failed') {
  const channelId = sessionStorage.getItem('kuro-mcp-oauth-channel')
  if (channelId) {
    sessionStorage.removeItem('kuro-mcp-oauth-channel')
    const channel = new BroadcastChannel(channelId)
    channel.postMessage(route.query.oauth)
    channel.close()
    window.close()
  }
  void router.replace({ name: 'plugins' })
}
const systemCount = computed(() => p.items.value.filter(item => item.system).length + 1)
const personalCount = computed(() => p.items.value.filter(item => !item.system).length)
const filtered = computed(() =>
  p.items.value.filter(
    item =>
      item.system === (tab.value === 'system')
      && `${item.name} ${item.description} ${pluginText(item, 'name', locale.value)} ${pluginText(item, 'description', locale.value)}`.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
</script>

<template>
  <section class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-16 pt-20 sm:px-12 min-[960px]:pt-12">
    <div class="mx-auto max-w-[1000px]">
      <header class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 class="text-[23px] font-semibold tracking-tight text-agent-ink">
            {{ t('plugins.title') }}
          </h1>
          <p class="mt-2 text-sm text-agent-ink-muted">
            {{ t('plugins.description') }}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex h-9 w-44 items-center gap-2 rounded-full border border-agent-border px-3 sm:w-52"><AppIcon name="tabler:search" :size="15" class="text-agent-ink-muted" /><input
            v-model="search"
            type="search"
            :aria-label="t('plugins.search')"
            :placeholder="t('plugins.search')"
            class="min-w-0 flex-1 bg-transparent text-xs text-agent-ink outline-none"
          ></label>
          <button
            :aria-label="t('plugins.refresh')"
            :disabled="p.loading.value || p.busy.value"
            class="rounded-full p-2 text-agent-ink-muted hover:bg-agent-surface-raised disabled:opacity-40"
            @click="p.reload(); google?.reload()"
          >
            <AppIcon name="tabler:refresh" :size="17" :class="{ 'animate-spin': p.loading.value }" />
          </button>
          <!-- 下拉形式的添加插件按钮（与 skills 模块结构与样式完全一致） -->
          <DropdownMenuRoot>
            <DropdownMenuTrigger
              :disabled="p.busy.value"
              :aria-label="t('plugins.add')"
              class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-agent-ink px-4 text-xs font-normal text-agent-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus disabled:opacity-50"
            >
              {{ t('plugins.add') }}<AppIcon name="tabler:chevron-down" :size="13" class="opacity-70 transition-transform data-[state=open]:rotate-180" />
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                :side-offset="6"
                class="min-w-[130px] w-auto !p-1"
                :class="dropdownMenuPanelClass"
              >
                <!-- 通过 URL 添加 -->
                <DropdownMenuItem
                  class="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 outline-none transition-colors"
                  :class="dropdownMenuOptionClass(false)"
                  @select="p.openEditor()"
                >
                  <AppIcon name="tabler:link" :size="14" class="shrink-0 text-agent-ink-muted" />
                  <span class="whitespace-nowrap text-xs font-medium text-agent-ink">{{ t('plugins.addUrl') }}</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator class="mx-1 my-1 h-px bg-agent-border-subtle" />

                <!-- 导入 JSON 配置 -->
                <DropdownMenuItem
                  class="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 outline-none transition-colors"
                  :class="dropdownMenuOptionClass(false)"
                  @select="p.openEditor(null, true)"
                >
                  <AppIcon name="tabler:code" :size="14" class="shrink-0 text-agent-ink-muted" />
                  <span class="whitespace-nowrap text-xs font-medium text-agent-ink">{{ t('plugins.importJson') }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </header>
      <div class="mt-6 flex min-w-0 flex-wrap items-center gap-1 text-sm" role="tablist" :aria-label="t('plugins.source')">
        <button
          v-for="option in ['system', 'personal'] as const"
          :key="option"
          role="tab"
          :aria-selected="tab === option"
          class="rounded-full px-3.5 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus"
          :class="tab === option ? 'bg-agent-surface-sunken/50 font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          @click="tab = option"
        >
          <span>{{ option === "system" ? t('plugins.system') : t('plugins.personal') }}</span>
          <span class="ml-1.5 text-xs text-agent-ink-muted" aria-hidden="true">{{ option === "system" ? systemCount : personalCount }}</span>
        </button>
      </div>
      <p v-if="oauthNotice" role="status" class="mt-5 text-sm text-agent-ink-muted">
        {{ oauthNotice }}<button class="ml-3 underline" @click="oauthNotice = ''">
          {{ t('plugins.close') }}
        </button>
      </p>
      <p
        v-if="p.error.value && !p.editorOpen.value && !p.selected.value"
        role="alert"
        class="mt-5 text-sm text-red-600"
      >
        {{ p.error.value }}
      </p>
      <div v-if="p.loading.value && !p.items.value.length && !showGoogle" class="py-20 text-center text-sm text-agent-ink-muted">
        {{ t('plugins.loading') }}
      </div>
      <div v-else-if="!filtered.length && !showGoogle" class="py-24 text-center">
        <AppIcon name="tabler:plug" :size="30" class="mx-auto text-agent-ink-muted" />
        <p class="mt-4 text-sm text-agent-ink-muted">
          {{ search ? t('plugins.noMatches') : tab === "personal" ? t('plugins.personalEmpty') : t('plugins.systemEmpty') }}
        </p>
        <button
          v-if="tab === 'personal' && !search"
          class="mt-4 text-sm underline underline-offset-4"
          @click="p.openEditor()"
        >
          {{ t('plugins.addFirst') }}
        </button>
      </div>
      <div v-else class="mt-9 grid grid-cols-1 gap-x-14 gap-y-2 md:grid-cols-2">
        <GoogleDataCard v-show="showGoogle" ref="google" />
        <div
          v-for="plugin in filtered"
          :key="plugin.id"
          :data-plugin-id="plugin.id"
          class="group flex min-w-0 items-center gap-1 rounded-xl transition-colors hover:bg-agent-surface-raised"
        >
          <button
            :disabled="p.busy.value"
            class="flex min-w-0 flex-1 items-center gap-3 px-2 py-4 text-left disabled:opacity-50"
            @click="p.preview(plugin)"
          >
            <span class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-agent-border bg-agent-surface">
              <img v-if="plugin.icon" :src="plugin.icon" alt="" class="size-full object-contain">
              <AppIcon v-else :name="pluginIconName(plugin.id)" :size="23" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-agent-ink">{{ pluginText(plugin, 'name', locale) }}</span>
              <span class="mt-1 block truncate text-xs text-agent-ink-muted">{{ pluginText(plugin, 'description', locale) || plugin.url }}</span>
            </span>
            <AppIcon v-if="!plugin.connected && !plugin.needsAuth" name="tabler:plus" :size="19" class="shrink-0 text-agent-ink-muted" />
          </button>
          <DropdownMenuRoot v-if="plugin.connected || plugin.needsAuth">
            <DropdownMenuTrigger
              :disabled="p.busy.value"
              :aria-label="t('plugins.actions')"
              :title="t('plugins.actionsFor', { name: pluginText(plugin, 'name', locale) })"
              class="mr-2 flex size-7 shrink-0 items-center justify-center rounded-full text-agent-ink-muted hover:bg-agent-surface-sunken focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-40 data-[state=open]:bg-agent-surface-sunken"
            >
              <AppIcon name="tabler:dots" :size="18" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent align="end" :side-offset="4" :class="dropdownMenuPanelClass" class="min-w-36">
                <DropdownMenuItem :disabled="p.busy.value" :class="dropdownMenuOptionClass(false)" class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none" @select="p.preview(plugin)">
                  <AppIcon name="tabler:settings" :size="15" /><span class="text-xs">{{ t('plugins.manage') }}</span>
                </DropdownMenuItem>
                <DropdownMenuItem v-if="plugin.connected && !plugin.needsAuth" :disabled="p.busy.value || !plugin.available" :class="dropdownMenuOptionClass(false)" class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none" @select="p.toggle(plugin)">
                  <AppIcon :name="plugin.enabled ? 'tabler:player-pause' : 'tabler:player-play'" :size="15" /><span class="text-xs">{{ plugin.enabled ? t('plugins.disable') : t('plugins.enable') }}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="mx-1 my-1 h-px bg-agent-border-subtle" />
                <DropdownMenuItem :disabled="p.busy.value" class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-red-600 outline-none data-[highlighted]:bg-red-500/5" @select="p.disconnect(plugin)">
                  <AppIcon name="tabler:unlink" :size="15" /><span class="text-xs">{{ t('plugins.disconnect') }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </div>
    </div>
    <PluginEditorDialog
      v-model:open="p.editorOpen.value"
      :plugin="p.editing.value"
      :busy="p.busy.value"
      :importing="p.importMode.value"
      :imported="p.imported.value"
      :callback-url="p.callbackUrl.value"
      :error="p.error.value"
      @save="p.save"
      @parse="p.parseImport"
      @import="p.saveImported"
      @select-import="
        (index, selected) => {
          p.imported.value[index]!.selected = selected;
        }
      "
    />
    <PluginDetailsDialog
      :plugin="p.selected.value"
      :busy="p.busy.value"
      :error="p.error.value"
      :authorizing="p.authorizing.value"
      :cancelling-authorization="p.cancellingAuthorization.value"
      @cancel-authorization="p.cancelAuthorization"
      @close="p.selected.value = null"
      @connect="p.selected.value && p.connect(p.selected.value, $event)"
      @toggle="p.selected.value && p.toggle(p.selected.value)"
      @disconnect="p.selected.value && p.disconnect(p.selected.value)"
      @edit="p.openEditor(p.selected.value)"
      @remove="p.selected.value && p.remove(p.selected.value)"
    />
  </section>
</template>
