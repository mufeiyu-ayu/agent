<script setup lang="ts">
import type { McpPlugin, McpPluginInput } from '@agent/contracts'
import { Alert, Button, Form, FormItem, Input, Modal, Select, Textarea } from 'ant-design-vue'
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  plugin: McpPlugin | null
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'save': [input: McpPluginInput]
}>()
const form = ref<McpPluginInput>({
  name: '',
  description: '',
  url: '',
  authType: 'none',
  headerNames: [],
})
const headerNames = ref('Authorization')
const imageError = ref('')
const imageLoading = ref(false)
let imageEpoch = 0
watch(
  () => props.open,
  (open) => {
    ++imageEpoch
    if (!open)
      return
    imageError.value = ''
    const p = props.plugin
    form.value = p
      ? {
          name: p.name,
          description: p.description,
          url: p.url,
          authType: p.authType,
          headerNames: [...p.headerNames],
          icon: p.icon,
          oauthClientId: p.oauthClientId,
          oauthScopes: p.oauthScopes,
        }
      : {
          name: '',
          description: '',
          url: '',
          authType: 'none',
          headerNames: [],
          oauthClientId: '',
          oauthScopes: '',
        }
    headerNames.value = p?.headerNames.join('\n') || 'Authorization'
  },
)
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  const epoch = ++imageEpoch
  imageLoading.value = true
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error('请选择 5 MB 以内的 PNG、JPEG 或 WebP')
    }
    const image = await createImageBitmap(file)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 128
      const scale = Math.min(128 / image.width, 128 / image.height)
      canvas
        .getContext('2d')!
        .drawImage(
          image,
          (128 - image.width * scale) / 2,
          (128 - image.height * scale) / 2,
          image.width * scale,
          image.height * scale,
        )
      if (epoch === imageEpoch && props.open) {
        form.value.icon = canvas.toDataURL('image/png')
        imageError.value = ''
      }
    }
    finally {
      image.close()
    }
  }
  catch (error) {
    if (epoch === imageEpoch)
      imageError.value = error instanceof Error ? error.message : '图片无效'
  }
  finally {
    if (epoch === imageEpoch)
      imageLoading.value = false
  }
}
function save() {
  emit('save', {
    ...form.value,
    headerNames:
      form.value.authType === 'headers'
        ? headerNames.value
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
  })
}
</script>

<template>
  <Modal
    :open="open"
    :title="plugin ? '编辑系统插件' : '新增系统插件'"
    :closable="!busy && !imageLoading"
    :mask-closable="!busy && !imageLoading"
    :keyboard="!busy && !imageLoading"
    :confirm-loading="busy"
    :ok-button-props="{ disabled: imageLoading }"
    :cancel-button-props="{ disabled: busy || imageLoading }"
    ok-text="保存"
    cancel-text="取消"
    @ok="save"
    @cancel="emit('update:open', false)"
  >
    <Form layout="vertical" :disabled="busy || imageLoading" class="mt-5">
      <FormItem label="图标">
        <div class="flex items-center gap-3">
          <img v-if="form.icon" :src="form.icon" alt="图标预览" class="h-12 w-12 rounded-lg object-contain"><input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :disabled="busy || imageLoading"
            aria-label="上传图标"
            @change="upload"
          ><Button v-if="form.icon" @click="form.icon = null">
            移除
          </Button>
        </div>
      </FormItem>
      <FormItem label="名称" required>
        <Input v-model:value="form.name" :maxlength="80" />
      </FormItem>
      <FormItem label="简介">
        <Textarea v-model:value="form.description" :rows="2" :maxlength="1000" />
      </FormItem>
      <FormItem label="MCP 服务地址" required>
        <Input v-model:value="form.url" placeholder="https://example.com/mcp" />
      </FormItem>
      <FormItem label="认证方式">
        <Select
          v-model:value="form.authType"
          :options="[
            { value: 'none', label: '无需认证' },
            { value: 'headers', label: '用户 API Key / Token' },
            { value: 'oauth', label: '用户 OAuth 授权' },
          ]"
        />
      </FormItem>
      <FormItem v-if="form.authType === 'headers'" label="用户需填写的认证请求头（每行一个）">
        <Textarea v-model:value="headerNames" :rows="2" placeholder="X-Goog-Api-Key" />
      </FormItem>
      <template v-if="form.authType === 'oauth'">
        <FormItem label="OAuth Client ID">
          <Input v-model:value="form.oauthClientId" />
        </FormItem>
        <FormItem label="OAuth Client Secret">
          <Input
            v-model:value="form.oauthClientSecret"
            type="password"
            autocomplete="new-password"
            :placeholder="plugin?.hasClientSecret ? '已配置，留空不修改' : '仅服务要求时填写'"
          />
        </FormItem>
        <FormItem label="Scopes（空格分隔）">
          <Input v-model:value="form.oauthScopes" />
        </FormItem>
        <p class="mb-4 text-xs text-slate-500">
          OAuth 回调使用前台站点的 /api/mcp/oauth/callback。用户令牌独立保存，不因系统上架自动授权。
        </p>
      </template>
      <Alert v-if="error || imageError" type="error" :message="error || imageError" show-icon />
    </Form>
  </Modal>
</template>
