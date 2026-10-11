<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSkills } from '@/hooks/useSkills'

const props = defineProps<{ manage?: boolean, select?: boolean, drafts?: boolean, conversationId?: string | null }>()
const skills = useSkills()
const query = ref('')
const filtered = computed(() => skills.items.value.filter((item) => {
  if (props.manage && item.builtin)
    return false
  if (props.drafts && (!item.hasDraft || (props.conversationId && item.conversationId !== props.conversationId)))
    return false
  if (!props.manage && !props.drafts && (!item.published || !item.enabled))
    return false
  return `${item.name} ${item.description}`.toLowerCase().includes(query.value.toLowerCase())
}))
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <input v-model="query" aria-label="搜索技能" placeholder="搜索名称或描述" class="min-w-0 flex-1 rounded-lg border border-agent-border bg-agent-canvas px-3 py-2 outline-none focus:ring-2 focus:ring-agent-focus/45">
      <button class="rounded-lg bg-agent-ink px-3 py-2 text-agent-canvas" @click="skills.start()">
        <span>创建技能</span>
      </button>
    </div>
    <p v-if="skills.error.value" role="alert" class="text-red-600">
      {{ skills.error.value }}
    </p>
    <button v-if="skills.error.value" :disabled="skills.loading.value" @click="skills.reload()">
      重试
    </button>
    <p v-if="skills.loading.value" role="status">
      正在加载技能…
    </p>
    <p v-else-if="!filtered.length" class="py-8 text-center text-agent-ink-muted">
      {{ query ? '没有匹配的技能' : '暂无技能，创建后可在聊天中复用。' }}
    </p>
    <ul class="space-y-3">
      <li v-for="item in filtered" :key="item.id" class="rounded-xl border border-agent-border-soft bg-agent-surface-raised p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="break-all font-medium">
            {{ item.name }}
          </h3>
          <span class="text-xs text-agent-ink-muted">{{ item.builtin ? '内置' : '个人' }}{{ !item.enabled ? ' · 已停用' : '' }}{{ item.hasDraft ? ' · 待确认草稿' : '' }}</span>
        </div>
        <p class="mt-2 break-words text-sm text-agent-ink-muted">
          {{ item.description }}
        </p>
        <div class="mt-4 flex flex-wrap gap-4 text-sm">
          <button v-if="item.published" :disabled="skills.busy.value" class="underline underline-offset-4" @click="skills.showPreview(item)">
            查看技能
          </button>
          <button v-if="item.hasDraft && (manage || drafts)" :disabled="skills.busy.value" class="underline underline-offset-4" @click="skills.showPreview(item, true)">
            预览草稿
          </button>
          <button v-if="select" @click="skills.select(item)">
            选择使用
          </button>
          <template v-if="manage">
            <button @click="skills.start(item)">
              聊天编辑
            </button>
            <button :disabled="skills.busy.value" @click="skills.manage(item, 'toggle')">
              {{ item.enabled ? '停用' : '启用' }}
            </button>
            <button :disabled="skills.busy.value" @click="skills.manage(item, 'delete')">
              删除
            </button>
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>
