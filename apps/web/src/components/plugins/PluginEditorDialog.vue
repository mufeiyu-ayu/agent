<script setup lang="ts">
import type { McpPlugin, McpPluginInput } from '@agent/contracts'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ref, watch } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { readPluginIcon } from '@/utils/plugin-icon'

const props = defineProps<{
  open: boolean
  busy: boolean
  plugin: McpPlugin | null
  importing: boolean
  callbackUrl: string
  error: string
  imported: Array<{
    config: McpPluginInput
    headers: Record<string, string>
    selected: boolean
  }>
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'save': [input: McpPluginInput]
  'parse': [json: string]
  'import': []
  'selectImport': [index: number, selected: boolean]
}>()
const form = ref<McpPluginInput>({
  name: '',
  description: '',
  url: '',
  authType: 'none',
  headerNames: [],
})
const headersText = ref('Authorization')
const json = ref('')
const iconError = ref('')
const iconLoading = ref(false)
let imageEpoch = 0
watch(
  () => props.open,
  (open) => {
    ++imageEpoch
    iconLoading.value = false
    if (!open)
      return
    const p = props.plugin
    form.value = p
      ? {
          name: p.name,
          description: p.description,
          url: p.url,
          icon: p.icon,
          authType: p.authType,
          headerNames: [...p.headerNames],
          oauthClientId: p.oauthClientId,
          oauthScopes: p.oauthScopes,
        }
      : {
          name: '',
          description: '',
          url: '',
          authType: 'none',
          headerNames: [],
          icon: null,
          oauthClientId: '',
          oauthScopes: '',
        }
    headersText.value = p?.headerNames.join('\n') || 'Authorization'
    json.value = ''
    iconError.value = ''
  },
)
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  const epoch = ++imageEpoch
  iconLoading.value = true
  try {
    const icon = await readPluginIcon(file)
    if (epoch === imageEpoch && props.open) {
      form.value.icon = icon
      iconError.value = ''
    }
  }
  catch (error) {
    if (epoch === imageEpoch)
      iconError.value = error instanceof Error ? error.message : '图片读取失败'
  }
  finally {
    if (epoch === imageEpoch)
      iconLoading.value = false
  }
}
function save() {
  emit('save', {
    ...form.value,
    name: form.value.name.trim(),
    url: form.value.url.trim(),
    headerNames:
      form.value.authType === 'headers'
        ? headersText.value
            .split(/\n/)
            .map(s => s.trim())
            .filter(Boolean)
        : [],
  })
}
</script>

<template>
  <DialogRoot :open="open" @update:open="!busy && !iconLoading && emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm" />
      <DialogContent
        class="plugin-editor fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-agent-border bg-agent-surface p-6 text-agent-ink shadow-xl"
        @escape-key-down="busy && $event.preventDefault()"
        @interact-outside="busy && $event.preventDefault()"
      >
        <DialogTitle class="text-lg font-semibold">
          {{ importing ? "从 JSON 导入" : plugin ? "编辑插件" : "添加插件" }}
        </DialogTitle>
        <DialogDescription class="mt-2 text-sm text-agent-ink-muted">
          {{ importing ? "解析远端 MCP 配置，核对后保存到个人插件。" : "连接远端 MCP 服务，为 Kuro 添加可用工具。" }}
        </DialogDescription>
        <form class="mt-6 space-y-5" @submit.prevent="importing ? emit('parse', json) : save()">
          <fieldset :disabled="busy || iconLoading" class="space-y-5 disabled:opacity-60">
            <template v-if="importing">
              <label class="block text-sm">MCP 配置 JSON<textarea
                v-model="json"
                required
                aria-label="MCP 配置 JSON"
                rows="8"
                maxlength="32000"
                class="plugin-field mt-2 font-mono text-xs"
                placeholder="{&quot;mcpServers&quot;:{&quot;服务名称&quot;:{&quot;url&quot;:&quot;https://example.com/mcp&quot;}}}"
              />
              </label>
              <div v-if="imported.length" class="space-y-3 rounded-xl border border-agent-border p-4">
                <label v-for="(entry, index) in imported" :key="index" class="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    :checked="entry.selected"
                    class="mt-1"
                    @change="emit('selectImport', index, ($event.target as HTMLInputElement).checked)"
                  >
                  <span class="min-w-0"><span class="block">{{ entry.config.name }}</span><span class="mt-1 block break-all text-xs text-agent-ink-muted">{{ entry.config.url }}</span><span class="text-xs text-agent-ink-muted">{{
                    entry.config.authType === "oauth"
                      ? "OAuth 授权"
                      : entry.config.authType === "headers"
                        ? "密钥认证（已导入的值不会回显）"
                        : "无需认证"
                  }}</span></span>
                </label>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-4">
                <div
                  class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-agent-border bg-agent-surface-raised"
                >
                  <img v-if="form.icon" :src="form.icon" alt="插件图标预览" class="size-full object-contain"><AppIcon
                    v-else
                    name="tabler:plug"
                    :size="25"
                  />
                </div>
                <div>
                  <label class="cursor-pointer text-sm underline underline-offset-4">{{ iconLoading ? "正在处理…" : "上传图标"
                  }}<input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    class="sr-only"
                    aria-label="上传图标"
                    @change="upload"
                  ></label>
                  <p class="mt-1 text-xs text-agent-ink-muted">
                    PNG、JPEG 或 WebP，最多 5 MB
                  </p>
                  <button
                    v-if="form.icon"
                    type="button"
                    class="mt-1 text-xs text-agent-ink-muted"
                    @click="form.icon = null"
                  >
                    移除图标
                  </button>
                </div>
              </div>
              <label class="block text-sm">名称<input
                v-model="form.name"
                required
                maxlength="80"
                class="plugin-field mt-2"
                placeholder="例如：Google 开发文档"
              ></label>
              <label class="block text-sm">简介<textarea
                v-model="form.description"
                maxlength="1000"
                rows="2"
                class="plugin-field mt-2"
                placeholder="这个插件能帮你做什么？"
              />
              </label>
              <label class="block text-sm">服务地址<input
                v-model="form.url"
                type="url"
                required
                maxlength="2048"
                class="plugin-field mt-2"
                placeholder="https://example.com/mcp"
              ></label>
              <label class="block text-sm">认证方式<select v-model="form.authType" class="plugin-field mt-2">
                <option value="none">无需认证</option>
                <option value="headers">API Key / Token</option>
                <option value="oauth">OAuth 账号授权</option>
              </select></label>
              <label v-if="form.authType === 'headers'" class="block text-sm">认证请求头名称<textarea
                v-model="headersText"
                rows="2"
                required
                class="plugin-field mt-2"
                placeholder="Authorization"
              /><span class="mt-1 block text-xs text-agent-ink-muted">每行一个，例如 Authorization 或 X-Goog-Api-Key。密钥在连接时填写。</span></label>
              <details v-if="form.authType === 'oauth'" class="rounded-xl border border-agent-border p-4 text-sm">
                <summary class="cursor-pointer">
                  OAuth 高级配置
                </summary>
                <div class="mt-4 space-y-4">
                  <p class="text-xs leading-5 text-agent-ink-muted">
                    服务不支持自动注册时，填写你在服务商后台申请的应用配置。
                  </p>
                  <label class="block">Client ID<input v-model="form.oauthClientId" class="plugin-field mt-2" maxlength="1000"></label><label class="block">Client Secret<input
                    v-model="form.oauthClientSecret"
                    type="password"
                    autocomplete="new-password"
                    class="plugin-field mt-2"
                    maxlength="4000"
                    :placeholder="plugin?.hasClientSecret ? '已配置，留空不修改' : '仅在服务要求时填写'"
                  ></label><label class="block">Scopes<input
                    v-model="form.oauthScopes"
                    class="plugin-field mt-2"
                    maxlength="2000"
                    placeholder="按服务要求填写，空格分隔"
                  ></label>
                  <p class="break-all text-xs text-agent-ink-muted">
                    回调地址：{{ callbackUrl || "正在读取…" }}
                  </p>
                </div>
              </details>
            </template>
          </fieldset>
          <p v-if="error || iconError" role="alert" class="text-sm leading-6 text-red-600">
            {{ error || iconError }}
          </p>
          <div class="flex justify-end gap-3 border-t border-agent-border pt-4">
            <button
              type="button"
              :disabled="busy || iconLoading"
              class="rounded-full px-4 py-2 text-sm disabled:opacity-40"
              @click="emit('update:open', false)"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="busy || iconLoading"
              class="rounded-full bg-agent-ink px-5 py-2 text-sm text-agent-surface disabled:opacity-40"
            >
              {{ busy ? "处理中…" : importing ? "解析配置" : "保存插件" }}
            </button>
            <button
              v-if="importing && imported.length"
              type="button"
              :disabled="busy || !imported.some((item) => item.selected)"
              class="rounded-full bg-agent-ink px-5 py-2 text-sm text-agent-surface disabled:opacity-40"
              @click="emit('import')"
            >
              导入所选
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.plugin-field {
  display: block;
  width: 100%;
  border: 1px solid var(--agent-border, #e5e5e5);
  border-radius: 9px;
  padding: 9px 12px;
  background: transparent;
  outline: none;
}
.plugin-field:focus {
  border-color: currentColor;
}
</style>
