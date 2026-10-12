<script setup lang="ts">
import type { SkillSummary } from '@agent/contracts'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { useSkills } from '@/hooks/useSkills'

const props = defineProps<{
  manage?: boolean
}>()

const emit = defineEmits<{
  manualCreate: []
}>()

const { t } = useI18n()

const skills = useSkills()
const query = ref('')
const deletingId = ref<string | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

async function confirmDelete(item: SkillSummary) {
  if (await skills.manage(item, 'delete')) {
    deletingId.value = null
    await nextTick()
    searchInput.value?.focus()
  }
}

// 技能库只展示已发布技能；未发布内容留在来源对话。
type FilterTab = 'all' | 'builtin' | 'custom'
const activeTab = ref<FilterTab>('all')
const counts = computed(() => {
  const items = skills.items.value.filter(item => item.published)
  return {
    all: items.length,
    builtin: items.filter(item => item.builtin).length,
    custom: items.filter(item => !item.builtin).length,
  }
})

// 过滤列表
const filtered = computed(() => {
  return skills.items.value.filter((item) => {
    if (props.manage && item.builtin)
      return false
    if (!item.published)
      return false

    if (!props.manage) {
      if (activeTab.value === 'builtin' && !item.builtin)
        return false
      if (activeTab.value === 'custom' && item.builtin)
        return false
    }

    if (query.value.trim()) {
      const q = query.value.trim().toLowerCase()
      const haystack = `${item.name} ${item.description}`.toLowerCase()
      if (!haystack.includes(q))
        return false
    }

    return true
  })
})

function useInChat(item: SkillSummary) {
  void skills.start(item.id, '')
}

function handleManualEdit() {
  emit('manualCreate')
}
</script>

<template>
  <div class="space-y-5">
    <!-- 极简工具栏：Tab 筛选与搜索 + 创建 -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <!-- 极简文字 Tabs -->
      <div
        v-if="!props.manage"
        class="flex items-center gap-1 border-b border-transparent text-xs"
      >
        <button
          class="rounded-md px-2.5 py-1.5 transition-colors"
          :class="activeTab === 'all' ? 'bg-agent-surface-sunken font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          @click="activeTab = 'all'"
        >
          <span>{{ t('skills.all') }}</span>
          <span class="ml-1 opacity-60">{{ counts.all }}</span>
        </button>
        <button
          class="rounded-md px-2.5 py-1.5 transition-colors"
          :class="activeTab === 'builtin' ? 'bg-agent-surface-sunken font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          @click="activeTab = 'builtin'"
        >
          <span>{{ t('skills.builtinTab') }}</span>
          <span class="ml-1 opacity-60">{{ counts.builtin }}</span>
        </button>
        <button
          class="rounded-md px-2.5 py-1.5 transition-colors"
          :class="activeTab === 'custom' ? 'bg-agent-surface-sunken font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          @click="activeTab = 'custom'"
        >
          <span>{{ t('skills.mine') }}</span>
          <span class="ml-1 opacity-60">{{ counts.custom }}</span>
        </button>
      </div>

      <!-- 右侧操作区：搜索框与创建技能按钮 -->
      <div class="flex items-center gap-2 sm:ml-auto">
        <div class="relative w-full sm:w-56">
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            :aria-label="t('skills.search')"
            :placeholder="t('skills.searchPlaceholder')"
            class="h-8 w-full rounded-lg border border-agent-border-subtle bg-agent-surface px-2.5 text-xs text-agent-ink placeholder:text-agent-ink-faint focus:border-agent-border focus:outline-none"
          >
          <button
            v-if="query"
            :aria-label="t('skills.clearSearch')"
            class="absolute inset-y-0 right-0 flex items-center pr-2 text-agent-ink-faint hover:text-agent-ink"
            @click="query = ''"
          >
            <AppIcon name="tabler:x" :size="13" />
          </button>
        </div>

        <!-- 下拉形式的创建技能按钮 -->
        <DropdownMenuRoot v-if="!props.manage">
          <DropdownMenuTrigger
            :aria-label="t('skills.create')"
            class="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-agent-ink px-3 text-agent-canvas transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-agent-focus"
          >
            <AppIcon name="tabler:plus" :size="14" />
            <span class="text-xs font-medium">{{ t('skills.create') }}</span>
            <AppIcon name="tabler:chevron-down" :size="12" class="ml-0.5 opacity-70 transition-transform data-[state=open]:rotate-180" />
          </DropdownMenuTrigger>

          <DropdownMenuPortal>
            <DropdownMenuContent
              align="end"
              :side-offset="6"
              class="min-w-[100px] w-auto !p-1"
              :class="dropdownMenuPanelClass"
            >
              <!-- 对话创建 -->
              <DropdownMenuItem
                class="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 outline-none transition-colors"
                :class="dropdownMenuOptionClass(false)"
                @select="skills.start()"
              >
                <AppIcon name="tabler:message-2" :size="14" class="shrink-0 text-agent-ink-muted" />
                <span class="whitespace-nowrap text-xs font-medium text-agent-ink">{{ t('skills.createInChat') }}</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator class="mx-1 my-1 h-px bg-agent-border-subtle" />

              <!-- 手动创建 -->
              <DropdownMenuItem
                class="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 outline-none transition-colors"
                :class="dropdownMenuOptionClass(false)"
                @select="handleManualEdit"
              >
                <AppIcon name="tabler:edit" :size="14" class="shrink-0 text-agent-ink-muted" />
                <span class="whitespace-nowrap text-xs font-medium text-agent-ink">{{ t('skills.createManually') }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </div>

    <!-- 异常状态 -->
    <div
      v-if="skills.error.value"
      role="alert"
      class="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400"
    >
      <span>{{ skills.error.value }}</span>
      <button
        :disabled="skills.loading.value"
        class="text-xs underline hover:no-underline"
        @click="skills.reload()"
      >
        <span>{{ t('skills.retry') }}</span>
      </button>
    </div>

    <!-- 加载中 -->
    <div v-if="skills.loading.value" class="py-8 text-center text-xs text-agent-ink-muted">
      <span>{{ t('skills.loading') }}</span>
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="!filtered.length"
      class="rounded-xl border border-dashed border-agent-border-subtle py-12 text-center"
    >
      <p class="text-xs text-agent-ink-muted">
        {{ query ? t('skills.noMatches') : t('skills.empty') }}
      </p>
      <button
        v-if="query"
        class="mt-2 text-xs text-agent-ink underline hover:no-underline"
        @click="query = ''"
      >
        <span>{{ t('skills.clearFilters') }}</span>
      </button>
    </div>

    <!-- 极简技能列表 -->
    <ul v-else class="space-y-2.5">
      <li
        v-for="item in filtered"
        :key="item.id"
        class="group rounded-xl border border-agent-border-subtle bg-agent-surface-raised px-3.5 py-3 transition-colors hover:border-agent-border/60"
        :class="{ 'opacity-65': item.published && !item.enabled }"
      >
        <!-- 头部：左侧技能名与标签，右上角操作图标组 -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="truncate font-mono text-sm font-medium text-agent-ink" :title="item.name">
              {{ item.name }}
            </h3>
            <span class="shrink-0 rounded-md border border-agent-border-subtle bg-agent-surface px-1.5 py-0.5 text-xs text-agent-ink-muted">
              {{ item.builtin ? t('skills.builtin') : t('skills.personal') }}{{ item.published && !item.enabled ? t('skills.disabledSuffix') : '' }}
            </span>
          </div>

          <!-- 右上角图标操作组：尺寸适中饱满，鼠标 hover 显示对应语义 -->
          <div class="flex shrink-0 items-center gap-1">
            <!-- 预览 -->
            <AppTooltip v-if="item.published" :content="t('skills.preview')">
              <button
                :disabled="skills.busy.value"
                :aria-label="t('skills.preview')"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                @click="skills.showPreview(item)"
              >
                <AppIcon name="tabler:eye" :size="16" />
              </button>
            </AppTooltip>

            <!-- 对话使用（普通模式） -->
            <AppTooltip v-if="item.published && item.enabled" :content="t('skills.useInChat')">
              <button
                :disabled="skills.busy.value"
                :aria-label="t('skills.useInChat')"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-soft transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                @click="useInChat(item)"
              >
                <AppIcon name="tabler:message-2" :size="16" />
              </button>
            </AppTooltip>

            <!-- 个人/自建技能管理操作 -->
            <template v-if="!item.builtin">
              <!-- 手动编辑 -->
              <AppTooltip :content="t('skills.manualEdit')">
                <button
                  :aria-label="t('skills.manualEdit')"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                  @click="skills.openEditor(item)"
                >
                  <AppIcon name="tabler:edit" :size="16" />
                </button>
              </AppTooltip>

              <!-- 停用 / 启用 -->
              <AppTooltip v-if="item.published" :content="item.enabled ? t('skills.disable') : t('skills.enable')">
                <button
                  :disabled="skills.busy.value"
                  :aria-label="item.enabled ? t('skills.disable') : t('skills.enable')"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                  @click="skills.manage(item, 'toggle')"
                >
                  <AppIcon :name="item.enabled ? 'tabler:player-pause' : 'tabler:player-play'" :size="16" />
                </button>
              </AppTooltip>

              <template v-if="deletingId === item.id">
                <button
                  :disabled="skills.busy.value"
                  class="flex h-7 items-center rounded px-2 py-1 text-red-600 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                  @click="confirmDelete(item)"
                >
                  <span class="text-xs">{{ skills.busy.value ? t('skills.deleting') : t('skills.confirmDelete') }}</span>
                </button>
                <button
                  :disabled="skills.busy.value"
                  class="flex h-7 items-center rounded px-2 py-1 text-agent-ink-muted hover:bg-agent-surface-sunken focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                  @click="deletingId = null"
                >
                  <span class="text-xs">{{ t('skills.cancel') }}</span>
                </button>
              </template>
              <AppTooltip v-else :content="t('skills.delete')">
                <button
                  :disabled="skills.busy.value"
                  :aria-label="t('skills.delete')"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-faint transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                  @click="deletingId = item.id"
                >
                  <AppIcon name="tabler:trash" :size="16" />
                </button>
              </AppTooltip>
            </template>
          </div>
        </div>

        <!-- 技能描述文本 -->
        <p
          class="mt-1.5 truncate text-xs leading-5 text-agent-ink-muted"
          :title="item.description || t('skills.noDescription')"
        >
          {{ item.description || t('skills.noDescription') }}
        </p>
      </li>
    </ul>
  </div>
</template>
