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
import SkillDetailsDrawer from './SkillDetailsDrawer.vue'

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
const detailItem = ref<SkillSummary | null>(null)
const detailsOpen = ref(false)
let detailTrigger: HTMLElement | null = null

function showDetails(item: SkillSummary, event: MouseEvent) {
  detailItem.value = item
  detailTrigger = event.currentTarget as HTMLElement
  detailsOpen.value = true
}

function restoreDetailFocus(event: Event) {
  event.preventDefault()
  // 切换到预览或编辑时，让新弹窗接管焦点。
  if (skills.previewDialogOpen.value || skills.editorOpen.value)
    return
  if (detailTrigger?.isConnected)
    detailTrigger.focus()
  else
    searchInput.value?.focus()
}

async function confirmDelete(item: SkillSummary) {
  if (await skills.remove(item)) {
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
  <div class="skills-list space-y-6" :class="{ 'skills-list--manage': props.manage }">
    <!-- 筛选、搜索和创建沿用现有行为。 -->
    <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-4">
      <!-- 极简文字 Tabs -->
      <div
        v-if="!props.manage"
        class="flex min-w-0 flex-wrap items-center gap-1 text-sm"
      >
        <button
          class="rounded-full px-3.5 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus"
          :class="activeTab === 'all' ? 'bg-agent-surface-sunken/50 font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          :aria-pressed="activeTab === 'all'"
          @click="activeTab = 'all'"
        >
          <span>{{ t('skills.all') }}</span>
          <span class="ml-1.5 text-xs text-agent-ink-muted">{{ counts.all }}</span>
        </button>
        <button
          class="rounded-full px-3.5 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus"
          :class="activeTab === 'builtin' ? 'bg-agent-surface-sunken/50 font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          :aria-pressed="activeTab === 'builtin'"
          @click="activeTab = 'builtin'"
        >
          <span>{{ t('skills.builtinTab') }}</span>
          <span class="ml-1.5 text-xs text-agent-ink-muted">{{ counts.builtin }}</span>
        </button>
        <button
          class="rounded-full px-3.5 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus"
          :class="activeTab === 'custom' ? 'bg-agent-surface-sunken/50 font-medium text-agent-ink' : 'text-agent-ink-muted hover:text-agent-ink'"
          :aria-pressed="activeTab === 'custom'"
          @click="activeTab = 'custom'"
        >
          <span>{{ t('skills.mine') }}</span>
          <span class="ml-1.5 text-xs text-agent-ink-muted">{{ counts.custom }}</span>
        </button>
      </div>

      <!-- 右侧操作区：搜索框与创建技能按钮 -->
      <div class="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
        <div class="relative min-w-0 flex-1 sm:w-44">
          <AppIcon name="tabler:search" :size="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-agent-ink-muted" />
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            :aria-label="t('skills.search')"
            :placeholder="t('skills.searchPlaceholder')"
            class="h-11 w-full rounded-xl border border-agent-border-subtle bg-agent-surface/60 pl-9 pr-8 text-sm text-agent-ink placeholder:text-agent-ink-muted focus-visible:outline-2 focus-visible:outline-agent-focus"
          >
          <button
            v-if="query"
            :aria-label="t('skills.clearSearch')"
            class="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-lg text-agent-ink-muted hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
            @click="query = ''"
          >
            <AppIcon name="tabler:x" :size="13" />
          </button>
        </div>

        <!-- 下拉形式的创建技能按钮 -->
        <DropdownMenuRoot v-if="!props.manage">
          <DropdownMenuTrigger
            :disabled="skills.busy.value"
            :aria-label="t('skills.create')"
            class="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-agent-ink px-4 text-agent-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus disabled:opacity-50"
          >
            <AppIcon name="tabler:plus" :size="19" />
            <span class="text-sm font-medium">{{ t('skills.create') }}</span>
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

    <!-- 设置保持紧凑列表，技能页按可用宽度排列卡片。 -->
    <ul v-else :class="props.manage ? 'space-y-2.5' : 'skills-grid'">
      <li
        v-for="item in filtered"
        :key="item.id"
        class="group rounded-xl border border-agent-border-subtle transition-colors hover:border-agent-border"
        :class="[props.manage ? 'bg-agent-surface-raised px-3.5 py-3' : 'skill-card relative flex min-w-0 flex-col bg-agent-surface/70 p-5 hover:bg-agent-surface', { 'ring-1 ring-agent-ink/60': detailsOpen && detailItem?.id === item.id }]"
      >
        <template v-if="props.manage">
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
                    :disabled="skills.busy.value"
                    :aria-label="t('skills.manualEdit')"
                    class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                    @click="skills.openEditor(item)"
                  >
                    <AppIcon name="tabler:edit" :size="16" />
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
        </template>
        <template v-else>
          <div class="mb-4 flex items-start justify-between gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-agent-surface-sunken/40 text-agent-ink-soft" aria-hidden="true">
              <AppIcon name="tabler:file-text" :size="22" />
            </div>
            <span class="rounded-full bg-agent-surface-sunken/35 px-2.5 py-1 text-xs leading-4 text-agent-ink-muted">
              {{ item.builtin ? t('skills.builtin') : t('skills.personal') }}{{ !item.enabled ? t('skills.disabledSuffix') : '' }}
            </span>
          </div>
          <button
            :disabled="skills.busy.value"
            :aria-label="t('skills.drawer.view')"
            :aria-describedby="`skill-title-${item.id}`"
            :aria-expanded="detailsOpen && detailItem?.id === item.id"
            aria-haspopup="dialog"
            class="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait"
            @click="showDetails(item, $event)"
          />
          <h3 :id="`skill-title-${item.id}`" class="skill-name line-clamp-2 text-lg leading-snug text-agent-ink" :title="item.name">
            {{ item.name }}
          </h3>
          <p class="mt-2 line-clamp-2 text-[13px] leading-5 text-agent-ink-muted" :title="item.description || t('skills.noDescription')">
            {{ item.description || t('skills.noDescription') }}
          </p>
        </template>
      </li>
    </ul>
    <SkillDetailsDrawer v-model:open="detailsOpen" :skill="detailItem" @close-auto-focus="restoreDetailFocus" />
  </div>
</template>

<style scoped>
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 16px;
}

.skill-card {
  min-height: 176px;
}

.skill-name {
  font-family: "Libre Baskerville", Georgia, "Songti SC", "Noto Serif SC", ui-serif, serif;
  overflow-wrap: anywhere;
}

.skills-list--manage input {
  height: 2rem;
  font-size: 0.75rem;
}
</style>
