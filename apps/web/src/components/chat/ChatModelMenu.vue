<script setup lang="ts">
import type { ReasoningEffort } from '@agent/contracts'
import type { LlmModelOption } from '../../types/llm'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'

const props = defineProps<{
  models: LlmModelOption[]
  selectedModel: string | null
  selectedReasoningEffort: ReasoningEffort | null
  /** 对话中放在输入框下方的小号样式。 */
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:selectedModel': [value: string]
  'update:selectedReasoningEffort': [value: ReasoningEffort | null]
  'refreshModels': []
}>()

const { t } = useI18n()

/** 顶层只放前几个模型（后端已按 Admin 的 sortOrder 排好），其余收进「更多模型」。 */
const PRIMARY_MODEL_COUNT = 4
const primaryModels = computed(() => props.models.slice(0, PRIMARY_MODEL_COUNT))
const moreModels = computed(() => props.models.slice(PRIMARY_MODEL_COUNT))
const modelItemClass = 'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 outline-none transition data-[highlighted]:bg-agent-surface-sunken/50'

const selectedModelOption = computed(() => {
  return props.models.find(model => model.id === props.selectedModel)
})

const selectedModelLabel = computed(() => {
  return selectedModelOption.value?.displayName ?? t('composer.modelPlaceholder')
})

/** 该家族可选的强度；为空的模型不显示、请求也不带。null 项表示用模型行默认。 */
const effortOptions = computed(() => selectedModelOption.value?.reasoningEffortOptions ?? [])
const showReasoningEffort = computed(() => effortOptions.value.length > 0)
/** 没有显式选择时不发送强度，展示模型行当前的默认值。 */
const effectiveReasoningEffort = computed(() => props.selectedReasoningEffort ?? selectedModelOption.value?.reasoningEffort ?? null)

/** null 项标出模型行当前的默认值，与触发器上显示的实际强度对得上。 */
function effortLabel(effort: ReasoningEffort | null): string {
  if (effort)
    return t(`composer.reasoningEffort.${effort}`)

  const modelDefault = selectedModelOption.value?.reasoningEffort
  return modelDefault
    ? t('composer.reasoningEffortDefaultWith', { effort: t(`composer.reasoningEffort.${modelDefault}`) })
    : t('composer.reasoningEffortDefault')
}

/** 管理台可能刚隐藏 / 删除了模型或改了默认强度：每次打开下拉都重新拉取。 */
function handleModelMenuOpen(open: boolean) {
  if (open)
    emit('refreshModels')
}
</script>

<template>
  <DropdownMenuRoot @update:open="handleModelMenuOpen">
    <DropdownMenuTrigger
      type="button"
      :aria-label="t('composer.modelSelectAria')"
      class="inline-flex min-w-0 items-center gap-1.5 rounded-lg font-medium text-agent-ink-soft transition hover:bg-agent-surface-sunken/55 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/40 data-[state=open]:bg-agent-surface-sunken/55 data-[state=open]:text-agent-ink"
      :class="compact ? 'h-7 px-1.5 text-xs' : 'h-8 px-2 text-[13px]'"
    >
      <span class="truncate">{{ selectedModelLabel }}</span>
      <span v-if="showReasoningEffort" class="shrink-0 text-agent-ink-muted">{{ effortLabel(effectiveReasoningEffort) }}</span>
      <AppIcon name="tabler:chevron-down" :size="compact ? 12 : 14" class="shrink-0 text-agent-ink-muted" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="8"
        class="w-[270px]" :class="[dropdownMenuPanelClass]"
      >
        <DropdownMenuItem
          v-for="model in primaryModels"
          :key="model.id"
          :class="modelItemClass"
          @select="emit('update:selectedModel', model.id)"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-agent-ink">{{ model.displayName }}</span>
          <AppIcon
            v-if="model.id === selectedModel"
            name="tabler:check"
            :size="16"
            class="shrink-0 text-agent-accent"
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator v-if="showReasoningEffort" class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

        <DropdownMenuSub v-if="showReasoningEffort">
          <DropdownMenuSubTrigger
            class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-agent-ink outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
          >
            <span>{{ t('composer.reasoningEffortLabel') }}</span>
            <span class="flex shrink-0 items-center gap-1 text-agent-ink-muted">
              {{ effortLabel(effectiveReasoningEffort) }}
              <AppIcon name="tabler:chevron-right" :size="14" />
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              :side-offset="6"
              class="min-w-[132px]" :class="[dropdownMenuPanelClass]"
            >
              <DropdownMenuItem
                v-for="effort in [null, ...effortOptions]"
                :key="effort ?? 'default'"
                class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                :class="dropdownMenuOptionClass(effort === selectedReasoningEffort)"
                @select="emit('update:selectedReasoningEffort', effort)"
              >
                <span>{{ effortLabel(effort) }}</span>
                <AppIcon
                  v-if="effort === selectedReasoningEffort"
                  name="tabler:check"
                  :size="15"
                  class="shrink-0"
                />
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator v-if="moreModels.length > 0" class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

        <DropdownMenuSub v-if="moreModels.length > 0">
          <DropdownMenuSubTrigger
            class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-agent-ink outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
          >
            <span>{{ t('composer.moreModels') }}</span>
            <AppIcon name="tabler:chevron-right" :size="14" class="shrink-0 text-agent-ink-muted" />
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              :side-offset="6"
              class="max-h-[min(360px,var(--reka-dropdown-menu-content-available-height))] w-[240px] overflow-y-auto" :class="[dropdownMenuPanelClass]"
            >
              <DropdownMenuItem
                v-for="model in moreModels"
                :key="model.id"
                :class="modelItemClass"
                @select="emit('update:selectedModel', model.id)"
              >
                <span class="min-w-0 flex-1 truncate text-sm text-agent-ink">{{ model.displayName }}</span>
                <AppIcon
                  v-if="model.id === selectedModel"
                  name="tabler:check"
                  :size="16"
                  class="shrink-0 text-agent-accent"
                />
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
