<script setup lang="ts">
import { computed } from 'vue'

import { splitFileName } from '@/utils/attachments'

const props = defineProps<{
  name: string
}>()

/** 每种文件一个主色；表格类的纸面画网格，其余画文字行。不在表里的按普通文本。 */
const STYLES: Record<string, { color: string, grid?: boolean }> = {
  xlsx: { color: 'oklch(0.58 0.13 152)', grid: true },
  csv: { color: 'oklch(0.58 0.13 152)', grid: true },
  docx: { color: 'oklch(0.55 0.15 258)' },
  pdf: { color: 'oklch(0.58 0.18 27)' },
  json: { color: 'oklch(0.6 0.12 70)' },
}
const NEUTRAL = { color: 'oklch(0.5 0.025 65)', grid: false }

const extension = computed(() => splitFileName(props.name)[1].slice(1).toLowerCase())
const style = computed(() => STYLES[extension.value] ?? NEUTRAL)
const label = computed(() => extension.value.toUpperCase())
/** 角标随字数变宽：两个字母到四个字母都居中。 */
const badgeWidth = computed(() => label.value.length * 6.4 + 10)
</script>

<template>
  <div
    role="img"
    :aria-label="name"
    class="file-thumb size-full overflow-hidden rounded-xl border border-agent-border-soft bg-agent-surface"
    :style="{ '--file-color': style.color }"
  >
    <!-- 一张带折角的小纸片，下沿压着扩展名角标：不靠文字也能认出是什么文件。 -->
    <svg viewBox="0 0 64 64" class="size-full" aria-hidden="true">
      <g class="file-sheet">
        <path d="M20.5 8H38L48 18V44.5A4.5 4.5 0 0 1 43.5 49H20.5A4.5 4.5 0 0 1 16 44.5V12.5A4.5 4.5 0 0 1 20.5 8Z" class="file-paper" />
        <path d="M38 8V14.5A3.5 3.5 0 0 0 41.5 18H48Z" class="file-fold" />
      </g>

      <g v-if="style.grid" class="file-grid">
        <rect x="22" y="22" width="20" height="4.8" rx="1.2" class="file-grid-head" />
        <rect x="22" y="22" width="20" height="14.5" rx="1.6" />
        <path d="M22 26.8H42M22 31.6H42M28.7 26.8V36.5M35.3 26.8V36.5" />
      </g>
      <g v-else class="file-lines">
        <rect x="22" y="23" width="13" height="2.4" rx="1.2" />
        <rect x="22" y="28.5" width="20" height="2.4" rx="1.2" />
        <rect x="22" y="34" width="16" height="2.4" rx="1.2" />
      </g>

      <rect
        :x="32 - badgeWidth / 2"
        y="41"
        :width="badgeWidth"
        height="14.5"
        rx="4.6"
        class="file-badge"
      />
      <text x="32" y="51.4" text-anchor="middle" class="file-label">{{ label }}</text>
    </svg>
  </div>
</template>

<style scoped>
.file-sheet {
  filter: drop-shadow(0 1px 1.5px rgb(40 30 20 / 14%));
}

/* 浅色主题下纸片和方块底色接近，描一道极淡的边把轮廓托出来。 */
.file-paper {
  fill: oklch(0.99 0.003 80);
  stroke: rgb(60 45 30 / 12%);
  stroke-width: 0.6;
}

.file-fold {
  fill: color-mix(in oklch, var(--file-color) 26%, white);
}

.file-lines rect {
  fill: color-mix(in oklch, var(--file-color) 30%, white);
}

.file-grid rect,
.file-grid path {
  fill: none;
  stroke: color-mix(in oklch, var(--file-color) 42%, white);
  stroke-width: 1.1;
}

.file-grid .file-grid-head {
  fill: color-mix(in oklch, var(--file-color) 24%, white);
  stroke: none;
}

/* 角标描一圈方块底色，和纸片之间留出一道缝。 */
.file-badge {
  fill: var(--file-color);
  stroke: var(--agent-surface);
  stroke-width: 1.5;
}

.file-label {
  fill: white;
  font-size: 8.8px;
  font-weight: 700;
  letter-spacing: 0.35px;
}
</style>
