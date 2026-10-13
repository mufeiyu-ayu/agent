<script setup lang="ts">
import type { McpPlugin } from '@agent/contracts'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ref, watch } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  plugin: McpPlugin | null
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  close: []
  connect: [headers?: Record<string, string>]
  toggle: []
  disconnect: []
  edit: []
  remove: []
}>()
const headers = ref<Record<string, string>>({})
const deleting = ref(false)
watch(
  () => props.plugin?.id,
  () => {
    headers.value = {}
    deleting.value = false
  },
)
</script>

<template>
  <DialogRoot :open="!!plugin" @update:open="!$event && !busy && emit('close')">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm" />
      <DialogContent
        v-if="plugin"
        class="fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[min(530px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-agent-border bg-agent-surface p-7 text-agent-ink shadow-xl"
        @escape-key-down="busy && $event.preventDefault()"
        @interact-outside="busy && $event.preventDefault()"
      >
        <div class="mb-5 flex items-center justify-between">
          <div class="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-agent-border">
            <img v-if="plugin.icon" :src="plugin.icon" alt="" class="size-full object-contain"><AppIcon
              v-else
              name="tabler:plug"
              :size="28"
            />
          </div>
          <button
            aria-label="关闭插件详情"
            :disabled="busy"
            class="rounded-full p-2 hover:bg-agent-surface-raised disabled:opacity-40"
            @click="emit('close')"
          >
            <AppIcon name="tabler:x" :size="18" />
          </button>
        </div>
        <DialogTitle class="text-xl font-semibold">
          {{ plugin.name }}
        </DialogTitle>
        <DialogDescription class="mt-2 text-sm leading-6 text-agent-ink-muted">
          {{ plugin.description || "连接此插件，使用它提供的工具。" }}
        </DialogDescription>
        <p class="mt-3 break-all text-xs text-agent-ink-muted">
          {{ plugin.url }}
        </p>
        <p v-if="!plugin.available" class="mt-4 text-sm text-amber-700">
          此插件已被平台停用。
        </p>
        <p v-else-if="plugin.needsAuth" class="mt-4 text-sm text-amber-700">
          连接需要重新认证，请核对凭据后连接。
        </p>
        <form
          v-if="!plugin.connected || plugin.needsAuth"
          class="mt-6 space-y-4"
          @submit.prevent="emit('connect', Object.values(headers).some(Boolean) ? headers : undefined)"
        >
          <label
            v-for="name in plugin.authType === 'headers' ? plugin.headerNames : []"
            :key="name"
            class="block text-sm"
          >{{ name
          }}<input
            v-model="headers[name]"
            type="password"
            :disabled="busy"
            autocomplete="new-password"
            class="mt-2 w-full rounded-lg border border-agent-border bg-transparent px-3 py-2"
            placeholder="填写密钥；已导入的凭据可直接连接"
          ></label>
          <p class="text-xs leading-5 text-agent-ink-muted">
            启用后，Kuro 可自动调用此插件的工具，包括它提供的修改、删除或发送操作。
          </p>
          <button
            :disabled="busy || !plugin.available"
            class="w-full rounded-full bg-agent-ink px-4 py-2.5 text-sm text-agent-surface disabled:opacity-40"
          >
            {{ busy ? "连接中…" : plugin.authType === "oauth" ? "连接账号并启用" : "连接并启用" }}
          </button>
        </form>
        <div v-else class="mt-6 flex gap-3">
          <button
            :disabled="busy || !plugin.available"
            class="flex-1 rounded-full bg-agent-ink px-4 py-2.5 text-sm text-agent-surface disabled:opacity-40"
            @click="emit('toggle')"
          >
            {{ plugin.enabled ? "停用插件" : "启用插件" }}
          </button><button
            :disabled="busy"
            class="rounded-full border border-agent-border px-4 py-2.5 text-sm disabled:opacity-40"
            @click="emit('disconnect')"
          >
            断开连接
          </button>
        </div>
        <button
          v-if="plugin.needsAuth"
          :disabled="busy"
          class="mt-3 text-sm text-agent-ink-muted underline"
          @click="emit('disconnect')"
        >
          断开连接并清除凭据
        </button>
        <p v-if="plugin.connected" class="mt-2 text-xs text-agent-ink-muted">
          停用保留授权；断开会删除本站凭据，不代表已撤销服务商侧授权。
        </p>
        <p v-if="error" role="alert" class="mt-4 text-sm leading-6 text-red-600">
          {{ error }}
        </p>
        <div class="mt-7 border-t border-agent-border pt-5">
          <h3 class="text-sm font-medium">
            可用工具
            <span class="ml-1 text-agent-ink-muted">{{ plugin.tools.length }}</span>
          </h3>
          <p v-if="!plugin.tools.length" class="mt-3 text-sm text-agent-ink-muted">
            连接后显示服务实际提供的工具。
          </p>
          <div v-for="tool in plugin.tools" :key="tool.name" class="mt-4">
            <p class="break-all text-sm">
              {{ tool.name }}
            </p>
            <p class="mt-1 whitespace-pre-wrap text-xs leading-5 text-agent-ink-muted">
              {{ tool.description }}
            </p>
          </div>
        </div>
        <div v-if="!plugin.system" class="mt-6 flex justify-end gap-4 border-t border-agent-border pt-4">
          <button :disabled="busy" class="text-sm disabled:opacity-40" @click="emit('edit')">
            编辑配置
          </button><button
            :disabled="busy"
            class="text-sm text-red-600 disabled:opacity-40"
            @click="deleting ? emit('remove') : (deleting = true)"
          >
            删除插件
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
