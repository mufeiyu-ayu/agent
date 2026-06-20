<script setup lang="ts">
import { computed } from 'vue'

import AppIcon from '@/components/common/AppIcon.vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLocale } from '@/hooks/useLocale'

type LanguageSwitcherVariant = 'default' | 'home'

const props = withDefaults(defineProps<{
  variant?: LanguageSwitcherVariant
}>(), {
  variant: 'default',
})

const {
  t,
  localeOptions,
  currentLocale,
  currentLocaleLabel,
  currentLocaleShortLabel,
  updateLocale,
} = useLocale()

const triggerClass = computed(() => {
  if (props.variant === 'home') {
    // 幽灵胶囊：默认透明，hover / 展开时浮现暖金 hairline + 极淡底色，贴合首页暖金奶白调
    // [&>svg] 仅命中触发器内置 chevron（地球图标已包在 span 内，不会跟着旋转）
    return 'group h-9 w-auto min-w-0 items-center justify-start gap-1.5 rounded-full border border-transparent bg-transparent px-2.5 py-0 text-sm font-semibold tracking-normal text-[#ece2d5]/82 shadow-none transition-colors duration-200 hover:border-[#d7b18a]/30 hover:bg-white/[0.045] hover:text-[#fff7ed] focus-visible:border-[#d7b18a]/40 focus-visible:ring-2 focus-visible:ring-[#d7c5aa]/30 data-[size=default]:h-9 data-[state=open]:border-[#d7b18a]/35 data-[state=open]:bg-white/[0.06] data-[state=open]:text-[#fff7ed] data-[state=open]:[&>svg]:rotate-180 sm:h-9 [&>svg]:text-[#cfc6b8] [&>svg]:transition-transform [&>svg]:duration-200 hover:[&>svg]:text-[#f1d2ae] data-[state=open]:[&>svg]:text-[#f1d2ae]'
  }

  return 'h-9 w-[78px] overflow-hidden rounded-full border-agent-border bg-agent-surface-raised px-2 text-xs font-bold tracking-normal text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface focus:ring-agent-focus/35 sm:h-10 sm:w-[126px] sm:px-3 sm:text-sm'
})

const iconClass = computed(() => {
  return props.variant === 'home'
    ? 'text-[#f1d2ae]/80 transition-colors duration-200 group-hover:text-[#f1d2ae] group-data-[state=open]:text-[#f1d2ae]'
    : 'text-agent-ink-muted'
})

const contentClass = computed(() => {
  if (props.variant === 'home') {
    // Claude 官网风浅色象牙卡片：暖米白底 + 深暖灰文字，从深色 header 弹出一张漂浮浅卡
    return 'min-w-[208px] overflow-hidden rounded-2xl border border-black/8 bg-[#f7f4ec] p-1.5 text-[#2b2a27] shadow-[0_22px_50px_rgba(18,14,9,0.42)] ring-1 ring-black/[0.04] [&_[data-slot=select-scroll-down-button]]:bg-[#f7f4ec] [&_[data-slot=select-scroll-down-button]]:text-[#8a8273] [&_[data-slot=select-scroll-up-button]]:bg-[#f7f4ec] [&_[data-slot=select-scroll-up-button]]:text-[#8a8273]'
  }

  return 'min-w-[148px] rounded-xl'
})

const itemClass = computed(() => {
  // group + [&>span:last-child]:w-full/justify-between：让「语言名 | 语言代码」两端对齐
  // 内置 check 指示器是 first-child span（绝对定位），移到 right-3；item pr-9 给代码留位避免重叠
  return props.variant === 'home'
    ? 'group h-9 rounded-[10px] py-0 pl-3 pr-9 text-[15px] font-semibold leading-none text-[#3a382f] transition-colors duration-150 focus:bg-black/[0.05] focus:text-[#1f1d18] data-[highlighted]:bg-black/[0.05] data-[highlighted]:text-[#1f1d18] data-[state=checked]:bg-black/[0.045] data-[state=checked]:text-[#1f1d18] data-[state=checked]:data-[highlighted]:bg-black/[0.07] [&>span:first-child]:right-3 [&>span:first-child]:size-4 [&>span:last-child]:w-full [&>span:last-child]:justify-between [&_svg]:size-4 [&_svg]:text-[#d97757]'
    : undefined
})

/**
 * 把 locale 值转成简短语言代码用于下拉项右侧展示。
 * @param value locale 值，例如 `zh-CN`、`en-US`
 * @returns 大写语言代码，例如 `ZH`、`EN`
 */
function localeCode(value: string): string {
  return value.split('-')[0]?.toUpperCase() ?? value.toUpperCase()
}

const contentPosition = computed(() => {
  return props.variant === 'home' ? 'popper' : undefined
})

const contentAlign = computed(() => {
  return props.variant === 'home' ? 'end' : undefined
})
</script>

<template>
  <Select
    :model-value="currentLocale"
    @update:model-value="updateLocale"
  >
    <SelectTrigger
      :aria-label="t('common.languageSwitcher.ariaLabel')"
      :class="triggerClass"
    >
      <span v-if="props.variant === 'home'" class="flex shrink-0 items-center">
        <AppIcon name="tabler:world" :size="17" :class="iconClass" />
      </span>
      <AppIcon v-else name="tabler:language" :size="17" :class="iconClass" />
      <SelectValue :placeholder="t('common.languageSwitcher.placeholder')">
        <span v-if="props.variant === 'home'">{{ currentLocaleLabel }}</span>
        <template v-else>
          <span class="hidden sm:inline">{{ currentLocaleLabel }}</span>
          <span class="sm:hidden">{{ currentLocaleShortLabel }}</span>
        </template>
      </SelectValue>
    </SelectTrigger>

    <SelectContent
      :align="contentAlign"
      :class="contentClass"
      :position="contentPosition"
    >
      <SelectItem
        v-for="option in localeOptions"
        :key="option.value"
        :value="option.value"
        :class="itemClass"
      >
        <template v-if="props.variant === 'home'">
          <span>{{ t(option.labelKey) }}</span>
          <span class="text-[12px] font-semibold tracking-wider text-[#6f6658] transition-colors duration-150 group-data-[highlighted]:text-[#514b40] group-data-[state=checked]:text-[#a84f36]">
            {{ localeCode(option.value) }}
          </span>
        </template>
        <template v-else>
          {{ t(option.labelKey) }}
        </template>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
