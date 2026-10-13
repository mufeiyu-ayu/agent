<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import PluginDetailsDialog from '@/components/plugins/PluginDetailsDialog.vue'
import PluginEditorDialog from '@/components/plugins/PluginEditorDialog.vue'
import { usePlugins } from '@/hooks/usePlugins'

const p = usePlugins()
const search = ref('')
const tab = ref<'system' | 'personal'>('system')
const route = useRoute()
const router = useRouter()
const oauthNotice = ref(
  route.query.oauth === 'connected'
    ? '账号已连接，插件已启用。'
    : route.query.oauth === 'failed'
      ? '授权未完成或已失效，请重新连接。'
      : '',
)
if (route.query.oauth)
  void router.replace({ name: 'plugins' })
const filtered = computed(() =>
  p.items.value.filter(
    item =>
      item.system === (tab.value === 'system')
      && `${item.name} ${item.description}`.toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
</script>

<template>
  <section class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-16 pt-20 sm:px-12 min-[960px]:pt-12">
    <div class="mx-auto max-w-[1000px]">
      <header class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 class="text-[23px] font-semibold tracking-tight text-agent-ink">
            插件
          </h1>
          <p class="mt-2 text-sm text-agent-ink-muted">
            连接你的工具，让 Kuro 帮你完成更多工作
          </p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex h-9 w-44 items-center gap-2 rounded-full border border-agent-border px-3 sm:w-52"><AppIcon name="tabler:search" :size="15" class="text-agent-ink-muted" /><input
            v-model="search"
            type="search"
            aria-label="搜索插件"
            placeholder="搜索插件"
            class="min-w-0 flex-1 bg-transparent text-xs text-agent-ink outline-none"
          ></label>
          <button
            aria-label="刷新插件"
            :disabled="p.loading.value || p.busy.value"
            class="rounded-full p-2 text-agent-ink-muted hover:bg-agent-surface-raised disabled:opacity-40"
            @click="p.reload"
          >
            <AppIcon name="tabler:refresh" :size="17" :class="{ 'animate-spin': p.loading.value }" />
          </button>
          <details class="relative">
            <summary
              class="flex cursor-pointer list-none items-center gap-1 rounded-full bg-agent-ink px-4 py-2 text-xs text-agent-surface"
            >
              添加<AppIcon name="tabler:chevron-down" :size="13" />
            </summary>
            <div
              class="absolute right-0 top-full z-20 mt-2 w-36 rounded-xl border border-agent-border bg-agent-surface p-1.5 text-sm text-agent-ink shadow-lg"
            >
              <button
                :disabled="p.busy.value"
                class="w-full rounded-lg px-3 py-2 text-left hover:bg-agent-surface-raised"
                @click="p.openEditor()"
              >
                通过 URL 添加
              </button><button
                :disabled="p.busy.value"
                class="w-full rounded-lg px-3 py-2 text-left hover:bg-agent-surface-raised"
                @click="p.openEditor(null, true)"
              >
                导入 JSON
              </button>
            </div>
          </details>
        </div>
      </header>
      <div class="mt-6 flex gap-2" role="tablist" aria-label="插件来源">
        <button
          v-for="option in ['system', 'personal'] as const"
          :key="option"
          role="tab"
          :aria-selected="tab === option"
          class="rounded-full px-4 py-2 text-sm"
          :class="tab === option ? 'bg-agent-surface-raised text-agent-ink' : 'text-agent-ink-muted'"
          @click="tab = option"
        >
          {{ option === "system" ? "系统" : "个人" }}
        </button>
      </div>
      <p v-if="oauthNotice" role="status" class="mt-5 text-sm text-agent-ink-muted">
        {{ oauthNotice }}<button class="ml-3 underline" @click="oauthNotice = ''">
          关闭
        </button>
      </p>
      <p
        v-if="p.error.value && !p.editorOpen.value && !p.selected.value"
        role="alert"
        class="mt-5 text-sm text-red-600"
      >
        {{ p.error.value }}
      </p>
      <div v-if="p.loading.value && !p.items.value.length" class="py-20 text-center text-sm text-agent-ink-muted">
        正在加载插件…
      </div>
      <div v-else-if="!filtered.length" class="py-24 text-center">
        <AppIcon name="tabler:plug" :size="30" class="mx-auto text-agent-ink-muted" />
        <p class="mt-4 text-sm text-agent-ink-muted">
          {{ search ? "没有匹配的插件" : tab === "personal" ? "添加你自己的 MCP 服务" : "暂时没有可用的系统插件" }}
        </p>
        <button
          v-if="tab === 'personal' && !search"
          class="mt-4 text-sm underline underline-offset-4"
          @click="p.openEditor()"
        >
          添加第一个插件
        </button>
      </div>
      <div v-else class="mt-9 grid grid-cols-1 gap-x-14 gap-y-2 md:grid-cols-2">
        <button
          v-for="plugin in filtered"
          :key="plugin.id"
          :disabled="p.busy.value"
          class="group flex min-w-0 items-center gap-3 rounded-xl px-2 py-4 text-left transition-colors hover:bg-agent-surface-raised disabled:opacity-50"
          @click="p.preview(plugin)"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-agent-border bg-agent-surface"
          ><img v-if="plugin.icon" :src="plugin.icon" alt="" class="size-full object-contain"><AppIcon
            v-else
            :name="plugin.id === 'google-developer-knowledge' ? 'logos:google-icon' : 'tabler:plug'"
            :size="23"
          /></span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-agent-ink">{{ plugin.name }}</span><span class="mt-1 block truncate text-xs text-agent-ink-muted">{{
            plugin.description || plugin.url
          }}</span></span>
          <span v-if="plugin.needsAuth" class="shrink-0 text-xs text-amber-700">需重连</span><span v-else-if="plugin.enabled" class="shrink-0 text-xs text-agent-ink-muted">已启用</span><AppIcon
            v-else
            :name="plugin.connected ? 'tabler:dots' : 'tabler:plus'"
            :size="19"
            class="shrink-0 text-agent-ink-muted"
          />
        </button>
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
      @close="p.selected.value = null"
      @connect="p.selected.value && p.connect(p.selected.value, $event)"
      @toggle="p.selected.value && p.toggle(p.selected.value)"
      @disconnect="p.selected.value && p.disconnect(p.selected.value)"
      @edit="p.openEditor(p.selected.value)"
      @remove="p.selected.value && p.remove(p.selected.value)"
    />
  </section>
</template>
