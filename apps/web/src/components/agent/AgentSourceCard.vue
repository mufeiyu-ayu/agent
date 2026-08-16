<script setup lang="ts">
import type { GroundingSourceView } from '@/utils/grounding-presenter'

import { useI18n } from 'vue-i18n'

defineProps<{
  source: GroundingSourceView
}>()

const { t } = useI18n()
</script>

<template>
  <!--
    v1 的 href 恒为 null（公共 parser 对任何非 null 值 fail closed），因此这里刻意
    使用非交互元素：不伪装成链接或按钮，也不用 slug 自行拼内部路由。
  -->
  <li class="flex min-w-0 gap-2.5 rounded-xl border border-agent-border-soft bg-agent-surface px-3 py-2.5">
    <span
      class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-agent-surface-sunken text-[11px] font-bold text-agent-ink-muted"
      aria-hidden="true"
    >
      {{ source.index }}
    </span>
    <div class="min-w-0 flex-1">
      <p class="break-words text-[13px] font-bold leading-5 text-agent-ink">
        {{ source.title }}
      </p>
      <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-agent-ink-muted">
        <span>{{ t(`conversation.grounding.granularity.${source.granularity}`) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ source.languageCode }}</span>
      </p>
      <p
        v-if="source.sectionPath"
        class="mt-1 break-words text-[11px] font-semibold leading-4 text-agent-ink-muted"
      >
        {{ source.sectionPath }}
      </p>
      <p
        v-if="source.excerpt"
        class="mt-1.5 break-words border-l-2 border-agent-border-soft pl-2 text-[12px] font-medium leading-5 text-agent-ink-soft"
      >
        {{ source.excerpt }}
      </p>
    </div>
  </li>
</template>
