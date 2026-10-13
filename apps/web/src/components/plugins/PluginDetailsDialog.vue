<script setup lang="ts">
import type { McpPlugin } from '@agent/contracts'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'
import { pluginIconName } from '@/utils/plugin-icon-name'

const props = defineProps<{
  plugin: McpPlugin | null
  busy: boolean
  authorizing?: boolean
  cancellingAuthorization?: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  cancelAuthorization: []
  connect: [headers?: Record<string, string>]
  toggle: []
  disconnect: []
  edit: []
  remove: []
}>()

const { t } = useI18n()

const connecting = computed(() => !props.plugin?.connected || props.plugin.needsAuth)
const headers = ref<Record<string, string>>({})
const deleting = ref(false)
const expandedTools = ref<Set<string>>(new Set())

watch(
  () => props.plugin?.id,
  () => {
    headers.value = {}
    deleting.value = false
    if (props.plugin?.tools && props.plugin.tools.length > 0) {
      // 默认展开第一个工具
      expandedTools.value = new Set([props.plugin.tools[0]!.name])
    }
    else {
      expandedTools.value = new Set()
    }
  },
  { immediate: true },
)

function toggleTool(name: string) {
  const next = new Set(expandedTools.value)
  if (next.has(name))
    next.delete(name)
  else
    next.add(name)
  expandedTools.value = next
}

function getToolIcon(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('search') || lower.includes('find') || lower.includes('query'))
    return 'tabler:file-search'
  if (lower.includes('read') || lower.includes('doc') || lower.includes('get_doc'))
    return 'tabler:book'
  if (lower.includes('status') || lower.includes('stat') || lower.includes('metric'))
    return 'tabler:chart-bar'
  return 'tabler:tool'
}

function getFirstLine(text: string): string {
  if (!text)
    return ''
  return text.trim().split('\n')[0]?.trim() || ''
}

function parseDescription(text: string): { intro: string, items: string[] } {
  if (!text)
    return { intro: '', items: [] }
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const introLines: string[] = []
  const items: string[] = []
  for (const line of lines) {
    if (line.startsWith('•') || line.startsWith('- ') || line.startsWith('* ')) {
      items.push(line.replace(/^[•\-*]\s*/, ''))
    }
    else if (items.length > 0) {
      items.push(line)
    }
    else {
      introLines.push(line)
    }
  }
  return {
    intro: introLines.join('\n') || text,
    items,
  }
}
</script>

<template>
  <DialogRoot :open="!!plugin" @update:open="!$event && !busy && emit('close')">
    <DialogPortal>
      <DialogOverlay class="plugin-overlay fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        v-if="plugin"
        class="plugin-panel fixed inset-0 z-50 m-auto h-fit max-h-[88dvh] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border border-agent-border bg-agent-surface text-agent-ink shadow-2xl outline-none"
        :class="connecting ? 'w-[min(480px,calc(100vw-32px))] rounded-2xl p-5' : 'w-[min(800px,calc(100vw-32px))] rounded-3xl p-7'"
        @escape-key-down="busy && $event.preventDefault()"
        @interact-outside="busy && $event.preventDefault()"
      >
        <!-- 头部 Header -->
        <div class="flex items-start" :class="connecting ? 'gap-3' : 'gap-4'">
          <div class="flex shrink-0 items-center justify-center overflow-hidden border border-agent-border/80 bg-agent-surface p-2 shadow-xs" :class="connecting ? 'size-12 rounded-xl' : 'size-16 rounded-2xl'">
            <img v-if="plugin.icon" :src="plugin.icon" alt="" class="size-full object-contain"><AppIcon
              v-else
              :name="pluginIconName(plugin.id)"
              :size="connecting ? 26 : 32"
            />
          </div>
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="flex flex-wrap items-center gap-2">
              <DialogTitle class="tracking-tight text-agent-ink" :class="connecting ? 'text-lg font-semibold' : 'text-xl font-bold'">
                {{ plugin.name }}
              </DialogTitle>
              <span
                v-if="plugin.connected"
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="plugin.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-agent-surface-raised text-agent-ink-muted'"
              >
                <span
                  class="size-1.5 rounded-full"
                  :class="plugin.enabled ? 'bg-emerald-500' : 'bg-agent-ink-muted'"
                />
                {{ plugin.enabled ? t('plugins.enabled') : t('plugins.disabled') }}
              </span>
            </div>
            <DialogDescription class="mt-1.5 text-agent-ink-muted" :class="connecting ? 'text-xs leading-5' : 'text-sm leading-relaxed'">
              {{ plugin.description || t('plugins.detailsFallback') }}
            </DialogDescription>
            <div class="mt-2 flex items-center gap-1.5 text-xs text-agent-ink-muted/80">
              <AppIcon name="tabler:link" :size="14" class="shrink-0" />
              <span :title="plugin.url" class="font-mono" :class="connecting ? 'truncate' : 'break-all'">{{ plugin.url }}</span>
            </div>
          </div>
          <button
            :aria-label="t('plugins.closeDetails')"
            :disabled="busy"
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-agent-surface-raised text-agent-ink-muted transition-colors hover:bg-agent-border/60 hover:text-agent-ink disabled:opacity-40"
            @click="emit('close')"
          >
            <AppIcon name="tabler:x" :size="16" />
          </button>
        </div>

        <p v-if="!plugin.available" class="mt-4 text-sm text-amber-700">
          {{ t('plugins.unavailable') }}
        </p>
        <p v-else-if="plugin.needsAuth" class="mt-4 text-sm text-amber-700">
          {{ t('plugins.needsAuth') }}
        </p>

        <p v-if="plugin.setupMessage" role="status" class="mt-4 rounded-xl bg-agent-surface-raised p-3 text-xs leading-5 text-agent-ink-muted">
          {{ t('plugins.setupRequired') }}
        </p>
        <div v-if="authorizing" role="status" class="mt-5 rounded-xl border border-agent-border p-4 text-sm">
          <div class="flex items-center gap-2">
            <AppIcon name="tabler:loader-2" :size="16" class="animate-spin" />{{ t('plugins.waitingAccount') }}
          </div>
          <p class="mt-2 text-xs text-agent-ink-muted">
            {{ t('plugins.waitingHint') }}
          </p>
          <button type="button" :disabled="cancellingAuthorization" class="mt-3 underline disabled:opacity-40" @click="emit('cancelAuthorization')">
            {{ cancellingAuthorization ? t('plugins.cancelling') : t('plugins.cancelAuth') }}
          </button>
        </div>
        <!-- 表单连接（未连接状态） -->
        <form
          v-if="connecting"
          class="mt-5 space-y-4"
          @submit.prevent="emit('connect', Object.values(headers).some(Boolean) ? headers : undefined)"
        >
          <label
            v-for="name in plugin.authType === 'headers' ? plugin.headerNames : []"
            :key="name"
            class="block text-sm font-medium"
          >{{ name
          }}<input
            v-model="headers[name]"
            type="password"
            :disabled="busy"
            autocomplete="new-password"
            class="mt-2 w-full rounded-xl border border-agent-border bg-transparent px-3 py-2 text-sm"
            :placeholder="t('plugins.keyPlaceholder')"
          ></label>
          <p v-if="!plugin.setupMessage && plugin.available" class="text-xs leading-5 text-agent-ink-muted">
            {{ t('plugins.permissions') }}
          </p>
          <button
            :disabled="busy || !plugin.available || !!plugin.setupMessage"
            class="w-full rounded-xl bg-agent-ink px-4 py-2.5 text-sm font-medium text-agent-surface disabled:opacity-40"
          >
            {{ busy ? (authorizing ? t('plugins.waiting') : t('plugins.connecting')) : plugin.authType === "oauth" ? t('plugins.connectAccount') : t('plugins.connect') }}
          </button>
        </form>

        <!-- 操作区（已连接状态） -->
        <div v-else class="mt-6 space-y-3">
          <div class="flex gap-3">
            <button
              :disabled="busy || !plugin.available || !!plugin.setupMessage"
              class="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-agent-ink px-4 text-sm font-medium text-agent-surface transition-opacity hover:opacity-90 disabled:opacity-40"
              @click="emit('toggle')"
            >
              <AppIcon
                :name="plugin.enabled ? 'tabler:circle-pause' : 'tabler:player-play'"
                :size="18"
              />
              <span>{{ plugin.enabled ? t('plugins.disable') : t('plugins.enable') }}</span>
            </button>
            <button
              :disabled="busy"
              class="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-agent-border bg-agent-surface px-4 text-sm font-medium text-agent-ink transition-colors hover:bg-agent-surface-raised disabled:opacity-40"
              @click="emit('disconnect')"
            >
              <AppIcon name="tabler:link-off" :size="18" />
              <span>{{ t('plugins.disconnect') }}</span>
            </button>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-agent-surface-raised/60 px-3.5 py-2.5 text-xs text-agent-ink-muted">
            <AppIcon name="tabler:info-circle" :size="16" class="shrink-0 text-agent-ink-muted/80" />
            <span>{{ t('plugins.disconnectHint') }}</span>
          </div>
        </div>

        <button
          v-if="plugin.needsAuth"
          :disabled="busy"
          class="mt-3 text-sm text-agent-ink-muted underline"
          @click="emit('disconnect')"
        >
          {{ t('plugins.clearCredentials') }}
        </button>

        <p v-if="error" role="alert" class="mt-4 text-sm leading-6 text-red-600">
          {{ error }}
        </p>

        <!-- 可用工具列表（Accordion 风格与展开/折叠动画） -->
        <div v-if="!connecting" class="mt-6 border-t border-agent-border/60 pt-5">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-agent-ink">
              <span>{{ t('plugins.tools') }}</span>
              <span class="rounded-full bg-agent-surface-raised px-2 py-0.5 text-xs font-medium text-agent-ink-muted">
                {{ plugin.tools.length }}
              </span>
            </h3>
          </div>
          <p v-if="!plugin.tools.length" class="mt-3 text-sm text-agent-ink-muted">
            {{ t('plugins.toolsEmpty') }}
          </p>
          <div v-else class="mt-3.5 space-y-3">
            <div
              v-for="tool in plugin.tools"
              :key="tool.name"
              class="rounded-2xl border border-agent-border/70 bg-agent-surface p-4.5 transition-colors"
            >
              <!-- 顶部主体：左侧图标 + 右侧标题与描述，无任何分界线 -->
              <div class="flex items-start gap-3.5">
                <!-- 工具图标容器 -->
                <div class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-agent-border/50 bg-agent-surface-raised/70 text-agent-ink">
                  <AppIcon :name="getToolIcon(tool.name)" :size="20" />
                </div>

                <!-- 右侧信息列 -->
                <div class="min-w-0 flex-1">
                  <!-- 标题与展开箭头行 -->
                  <div
                    class="flex cursor-pointer select-none items-center justify-between"
                    @click="toggleTool(tool.name)"
                  >
                    <div class="flex items-center gap-2">
                      <span class="break-all font-mono text-sm font-semibold text-agent-ink">{{ tool.name }}</span>
                      <span class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{{ t('plugins.available') }}</span>
                    </div>
                    <button
                      type="button"
                      class="flex size-6 items-center justify-center rounded-md text-agent-ink-muted transition-colors hover:text-agent-ink"
                      :aria-label="expandedTools.has(tool.name) ? t('plugins.collapseTool') : t('plugins.expandTool')"
                    >
                      <AppIcon
                        name="tabler:chevron-down"
                        :size="17"
                        class="transition-transform duration-250 ease-out"
                        :class="{ '-rotate-180': expandedTools.has(tool.name) }"
                      />
                    </button>
                  </div>

                  <!-- 折叠时的首行预览（无分界线，紧随标题） -->
                  <p
                    v-if="!expandedTools.has(tool.name) && tool.description"
                    class="mt-1 cursor-pointer truncate text-xs text-agent-ink-muted"
                    @click="toggleTool(tool.name)"
                  >
                    {{ getFirstLine(tool.description) }}
                  </p>

                  <!-- 展开时的完整正文描述（无分界线，紧随标题平滑展开） -->
                  <div
                    class="grid transition-[grid-template-rows] duration-250 ease-out"
                    :class="expandedTools.has(tool.name) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
                  >
                    <div class="overflow-hidden">
                      <div class="pt-1.5 text-xs text-agent-ink-muted">
                        <p class="leading-relaxed whitespace-pre-wrap">
                          {{ parseDescription(tool.description).intro }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 展开时的子列表项卡片（满宽排在下方，无分界线） -->
              <div
                class="grid transition-[grid-template-rows] duration-250 ease-out"
                :class="expandedTools.has(tool.name) && parseDescription(tool.description).items.length ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
              >
                <div class="overflow-hidden">
                  <div class="mt-3 rounded-xl border border-agent-border/40 bg-agent-surface-raised/50 p-4">
                    <div class="grid grid-cols-1 gap-x-6 gap-y-2 text-xs text-agent-ink-muted sm:grid-cols-2">
                      <div
                        v-for="(item, i) in parseDescription(tool.description).items"
                        :key="i"
                        class="flex items-start gap-2"
                      >
                        <span class="text-agent-ink-muted/60">•</span>
                        <span class="break-all leading-5">{{ item }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 个人插件删除/编辑 -->
        <div v-if="!plugin.system" class="mt-6 flex justify-end gap-4 border-t border-agent-border pt-4">
          <button :disabled="busy" class="text-sm disabled:opacity-40" @click="emit('edit')">
            {{ t('plugins.editConfig') }}
          </button><button
            :disabled="busy"
            class="text-sm text-red-600 disabled:opacity-40"
            @click="deleting ? emit('remove') : (deleting = true)"
          >
            {{ t(deleting ? 'plugins.confirmDelete' : 'plugins.delete') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.plugin-panel[data-state='open'] {
  animation: plugin-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.plugin-panel[data-state='closed'] {
  animation: plugin-panel-out 140ms ease-in both;
}

.plugin-overlay[data-state='open'] {
  animation: plugin-fade-in 180ms ease-out both;
}

.plugin-overlay[data-state='closed'] {
  animation: plugin-fade-in 140ms ease-in reverse both;
}

@keyframes plugin-panel-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes plugin-panel-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes plugin-fade-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .plugin-panel[data-state='open'],
  .plugin-panel[data-state='closed'] {
    animation-name: plugin-fade-in;
  }
}
</style>
