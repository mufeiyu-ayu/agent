<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'

defineProps<{
  /** 菜单往哪边开：空态输入框在页面中部，往上会盖住标题。 */
  side: 'top' | 'bottom'
}>()

const emit = defineEmits<{
  pickFiles: []
}>()

const { t } = useI18n()

/** 占位：这几个入口还没有功能，先把菜单的样子定下来；做一个就从这里挪走一个。 */
const UPCOMING = [
  { key: 'link', icon: 'tabler:link', tile: 'bg-agent-accent-soft text-agent-accent' },
  { key: 'skill', icon: 'tabler:script', tile: 'bg-agent-moss-soft text-agent-moss' },
  { key: 'connector', icon: 'tabler:plug-connected', tile: 'bg-agent-copper-soft text-agent-copper' },
] as const

const itemClass = 'flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] leading-5 outline-none transition'
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        :aria-label="t('composer.attachMenu.label')"
        class="size-9 rounded-lg bg-transparent text-agent-ink-soft shadow-none hover:bg-agent-surface-sunken/55 hover:text-agent-ink data-[state=open]:bg-agent-surface-sunken/55 data-[state=open]:text-agent-ink"
      >
        <AppIcon name="tabler:plus" :size="18" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        align="start"
        :side-offset="8"
        class="w-48"
        :class="dropdownMenuPanelClass"
      >
        <DropdownMenuItem
          class="cursor-pointer"
          :class="[itemClass, dropdownMenuOptionClass(false)]"
          @select="emit('pickFiles')"
        >
          <span class="grid size-6 shrink-0 place-items-center">
            <AppIcon name="tabler:paperclip" :size="16" />
          </span>
          <span class="text-agent-ink">{{ t('composer.attachMenu.files') }}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator class="mx-1 my-1 h-px bg-agent-border-subtle" />

        <DropdownMenuItem
          v-for="item in UPCOMING"
          :key="item.key"
          disabled
          class="cursor-default"
          :class="itemClass"
        >
          <span class="grid size-6 shrink-0 place-items-center rounded-md" :class="item.tile">
            <AppIcon :name="item.icon" :size="14" />
          </span>
          <span class="min-w-0 flex-1 truncate text-agent-ink-muted">{{ t(`composer.attachMenu.${item.key}`) }}</span>
          <span class="shrink-0 text-[10.5px] text-agent-ink-faint">{{ t('composer.attachMenu.soon') }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
