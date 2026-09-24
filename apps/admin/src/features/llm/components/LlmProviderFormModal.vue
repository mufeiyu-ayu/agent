<script setup lang="ts">
import type {
  AdminLlmModelTestResult,
  AdminLlmProvider,
  AdminLlmProviderInput,
  AdminLlmProxyStatus,
  LlmProviderFamily,
} from '@agent/contracts'
import type { FormInstance, Rule } from 'ant-design-vue/es/form'
import { LLM_PROVIDER_FAMILIES } from '@agent/contracts'
import { CheckCircleFilled, CloseCircleFilled, SyncOutlined } from '@ant-design/icons-vue'
import {
  Button,
  Checkbox,
  Form,
  FormItem,
  Input,
  Modal,
  Switch,
  Tooltip,
} from 'ant-design-vue'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { LLM_FAMILY_BRAND } from '../llm-families'
import { normalizeBaseUrl } from '../llm-models.state'
import LlmFamilyLogo from './LlmFamilyLogo.vue'
import LlmModelCandidateList from './LlmModelCandidateList.vue'

/**
 * 新增 / 编辑服务商。密钥填完可以直接「拉取模型」验证配置，拉回来的清单在弹窗里勾选，
 * 点确定时服务商与勾中的模型一起提交；拉取本身由页面调用接口，本组件只 emit。
 */
const props = defineProps<{
  open: boolean
  /** null 为新增。 */
  provider: AdminLlmProvider | null
  /** 本机 `.env` 的出站代理；null 按未配置处理。 */
  proxyStatus: AdminLlmProxyStatus | null
  submitting: boolean
  /** 拉取回来的模型名与加载态，由页面持有。 */
  candidates: string[]
  fetchingCandidates: boolean
  /** 编辑时该服务商已有的 wireName，清单里置灰。 */
  existing: string[]
  /** 自动测试的逐个结果与进行中的名字，由页面持有。 */
  testResults: Record<string, AdminLlmModelTestResult>
  testingNames: Set<string>
}>()

const emit = defineEmits<{
  /** 用表单当前的地址、密钥与「使用代理」勾选拉取模型；编辑时密钥留空表示用库里那把。 */
  fetchModels: [input: { baseUrl: string, apiKey: string, useProxy: boolean }]
  /** 勾中模型后自动对它们各发一条最短对话；密钥留空时页面用库里那把。 */
  testModels: [input: { baseUrl: string, apiKey: string, useProxy: boolean }, wireNames: string[]]
  submit: [input: AdminLlmProviderInput, wireNames: string[]]
  /** 家族、地址、密钥或「使用代理」变了：按旧配置拉到的名单与测出的结论作废，由页面清掉。 */
  credentialsChange: [credentials: { family: LlmProviderFamily, baseUrl: string, apiKey: string, useProxy: boolean }]
  cancel: []
}>()

const { t } = useI18n()
const formRef = ref<FormInstance>()
const selectedWireNames = ref<string[]>([])

interface FormState {
  family: LlmProviderFamily
  note: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  useProxy: boolean
}

const formState = reactive<FormState>({
  family: 'deepseek',
  note: '',
  baseUrl: '',
  apiKey: '',
  enabled: true,
  useProxy: false,
})

const proxyConfigured = computed(() => props.proxyStatus?.configured === true)
/** 本机没配代理时不能勾上；已勾上的（库从别的机器搬来）仍可取消。 */
const useProxyDisabled = computed(() => !proxyConfigured.value && !formState.useProxy)
const proxyTooltip = computed(() => (
  proxyConfigured.value
    ? t('llmModels.providers.form.proxyAddress', { address: props.proxyStatus?.address })
    : t('llmModels.providers.form.proxyNotConfigured')
))

const isEdit = computed(() => props.provider !== null)

/** 编辑时地址改了（末尾斜杠不算）：库里的密钥不跟着新地址走，后端要求同时重填密钥。 */
const baseUrlChanged = computed(() => (
  props.provider !== null
  && normalizeBaseUrl(formState.baseUrl) !== normalizeBaseUrl(props.provider.baseUrl)
))

/** 地址改回原值后密钥不再必填：清掉之前按「改了地址」报的错。 */
watch(baseUrlChanged, (changed) => {
  if (!changed)
    formRef.value?.clearValidate(['apiKey'])
})

/** 新增或改了地址必须先填密钥；编辑且地址没变可以只用库里那把。 */
const canFetch = computed(() => (
  formState.baseUrl.trim().length > 0
  && (formState.apiKey.trim().length > 0 || (isEdit.value && !baseUrlChanged.value))
))

const apiKeyPlaceholder = computed(() => {
  if (!props.provider)
    return t('llmModels.providers.form.apiKeyPlaceholderNew')

  return baseUrlChanged.value
    ? t('llmModels.providers.form.apiKeyRequiredForBaseUrl')
    : t('llmModels.providers.form.apiKeyPlaceholderEdit', { last4: props.provider.apiKeyLast4 })
})

const rules = computed<Record<string, Rule[]>>(() => ({
  note: [{ required: true, message: t('llmModels.providers.form.noteRequired'), trigger: 'blur' }],
  baseUrl: [
    { required: true, message: t('llmModels.providers.form.baseUrlRequired'), trigger: 'blur' },
    {
      validator: async (_rule: unknown, value: string) => {
        if (!/^https?:\/\//i.test(value?.trim() ?? ''))
          throw new Error(t('llmModels.providers.form.baseUrlInvalid'))
      },
      trigger: 'blur',
    },
  ],
  apiKey: !isEdit.value
    ? [{ required: true, message: t('llmModels.providers.form.apiKeyRequired'), trigger: 'blur' }]
    : baseUrlChanged.value
      ? [{ required: true, message: t('llmModels.providers.form.apiKeyRequiredForBaseUrl'), trigger: 'blur' }]
      : [],
}))

watch(
  () => [formState.family, formState.baseUrl, formState.apiKey, formState.useProxy] as const,
  ([family, baseUrl, apiKey, useProxy]) => {
    emit('credentialsChange', { family, baseUrl, apiKey, useProxy })
  },
)

/** 名单被清空（凭据真的变了、重新拉取）时勾选跟着作废；只差末尾斜杠时页面不清，勾选也保留。 */
watch(() => props.candidates, (names) => {
  if (names.length === 0)
    selectedWireNames.value = []
})

/** 选服务商：Base URL 只在还没被人改过时跟着预设走。 */
function selectFamily(family: LlmProviderFamily) {
  const previousSuggestion = LLM_FAMILY_BRAND[formState.family].suggestedBaseUrl

  formState.family = family
  if (!formState.baseUrl || formState.baseUrl === previousSuggestion)
    formState.baseUrl = LLM_FAMILY_BRAND[family].suggestedBaseUrl
}

watch(() => props.open, (isOpen) => {
  if (!isOpen)
    return

  formRef.value?.clearValidate()
  selectedWireNames.value = []

  if (props.provider) {
    formState.family = props.provider.family
    formState.note = props.provider.note
    formState.baseUrl = props.provider.baseUrl
    formState.apiKey = ''
    formState.enabled = props.provider.enabled
    formState.useProxy = props.provider.useProxy
  }
  else {
    formState.family = 'deepseek'
    formState.note = ''
    formState.baseUrl = LLM_FAMILY_BRAND.deepseek.suggestedBaseUrl
    formState.apiKey = ''
    formState.enabled = true
    formState.useProxy = false
  }
}, { immediate: true })

/** 拉取 / 测试用表单当前的勾选，没保存也生效。 */
function formCredentials() {
  return { baseUrl: formState.baseUrl.trim(), apiKey: formState.apiKey.trim(), useProxy: formState.useProxy }
}

function handleFetch() {
  // 勾选由 candidates 的 watch 清：拉取开始时页面先清空名单。
  emit('fetchModels', formCredentials())
}

/** 勾选变化时只测新勾上的：已有结果或正在测的不重发。 */
watch(selectedWireNames, (names) => {
  const fresh = names.filter(name => !props.testResults[name] && !props.testingNames.has(name))

  if (fresh.length > 0)
    emit('testModels', formCredentials(), fresh)
})

async function handleOk() {
  try {
    await formRef.value?.validate()
  }
  catch {
    return
  }

  const input: AdminLlmProviderInput = {
    family: formState.family,
    note: formState.note.trim(),
    baseUrl: formState.baseUrl.trim(),
    enabled: formState.enabled,
    useProxy: formState.useProxy,
  }

  if (formState.apiKey.trim())
    input.apiKey = formState.apiKey.trim()

  emit('submit', input, selectedWireNames.value)
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit ? t('llmModels.providers.edit') : t('llmModels.providers.add')"
    :confirm-loading="submitting"
    :ok-text="t('llmModels.actions.confirm')"
    :cancel-text="t('llmModels.actions.cancel')"
    :width="660"
    destroy-on-close
    class="provider-form-modal"
    @ok="handleOk"
    @cancel="emit('cancel')"
  >
    <div class="provider-modal-scroll">
      <Form
        ref="formRef"
        :model="formState"
        :rules="rules"
        layout="vertical"
        class="provider-form"
      >
        <!-- 1. 服务商预设 -->
        <FormItem :label="t('llmModels.providers.form.family')" class="form-item-family">
          <div class="family-grid">
            <button
              v-for="family in LLM_PROVIDER_FAMILIES"
              :key="family"
              type="button"
              class="family-option"
              :class="{ 'is-active': formState.family === family }"
              @click="selectFamily(family)"
            >
              <LlmFamilyLogo :family="family" :size="20" />
              <span class="family-option__label">{{ t(`llmModels.families.${family}`) }}</span>
            </button>
          </div>
        </FormItem>

        <!-- 2. 备注与服务商状态（并排对称） -->
        <div class="form-row-balanced">
          <FormItem
            :label="t('llmModels.providers.form.note')"
            name="note"
            class="form-col-note"
          >
            <Input
              v-model:value="formState.note"
              :placeholder="t('llmModels.providers.form.notePlaceholder')"
            />
          </FormItem>

          <FormItem
            :label="t('llmModels.providers.form.status')"
            class="form-col-status"
          >
            <div
              class="status-toggle-card"
              :class="{ 'is-enabled': formState.enabled }"
              :title="t('llmModels.providers.form.enabledDesc')"
              @click="formState.enabled = !formState.enabled"
            >
              <div class="status-indicator">
                <CheckCircleFilled v-if="formState.enabled" class="status-icon is-active" />
                <CloseCircleFilled v-else class="status-icon is-inactive" />
                <span class="status-label">
                  {{ formState.enabled ? t('llmModels.statusEnabled') : t('llmModels.statusDisabled') }}
                </span>
              </div>
              <Switch
                v-model:checked="formState.enabled"
                size="small"
                @click.stop
              />
            </div>
          </FormItem>
        </div>

        <!-- 3. Base URL -->
        <FormItem
          :label="t('llmModels.providers.form.baseUrl')"
          name="baseUrl"
          class="form-item-tight"
        >
          <Input
            v-model:value="formState.baseUrl"
            :placeholder="t('llmModels.providers.form.baseUrlPlaceholder')"
          >
            <!-- 是否经本机 .env 的代理访问：跟地址放在一起，地址或未配置的原因悬停可见 -->
            <template #addonAfter>
              <Tooltip :title="proxyTooltip">
                <span class="proxy-toggle">
                  <Checkbox v-model:checked="formState.useProxy" :disabled="useProxyDisabled">
                    {{ t('llmModels.providers.form.useProxy') }}
                  </Checkbox>
                </span>
              </Tooltip>
            </template>
          </Input>
        </FormItem>

        <!-- 4. API 密钥 -->
        <FormItem
          :label="t('llmModels.providers.form.apiKey')"
          name="apiKey"
          class="form-item-tight"
        >
          <Input.Password
            v-model:value="formState.apiKey"
            :placeholder="apiKeyPlaceholder"
          />
        </FormItem>

        <!-- 5. 模型验证与导入卡片 -->
        <section class="connectivity-card">
          <header class="connectivity-header">
            <span class="connectivity-title">{{ t('llmModels.providers.form.candidatesTitle') }}</span>

            <Button
              class="fetch-btn"
              :disabled="!canFetch"
              :loading="fetchingCandidates"
              @click="handleFetch"
            >
              <template #icon>
                <SyncOutlined :spin="fetchingCandidates" />
              </template>
              {{ t('llmModels.providers.form.fetchModels') }}
            </Button>
          </header>

          <div v-if="fetchingCandidates || candidates.length > 0" class="connectivity-body">
            <div v-if="fetchingCandidates" class="fetching-loading-state">
              <SyncOutlined spin class="loading-icon" />
              <span class="loading-text">{{ t('llmModels.providers.form.fetchingModels') }}</span>
            </div>

            <LlmModelCandidateList
              v-else
              v-model="selectedWireNames"
              :candidates="candidates"
              :existing="existing"
              :loading="false"
              :test-results="testResults"
              :testing-names="testingNames"
            />
          </div>
        </section>
      </Form>
    </div>
  </Modal>
</template>

<style scoped>
.proxy-toggle {
  display: inline-flex;
  align-items: center;
  height: 30px;
}

.provider-modal-scroll {
  max-height: calc(82vh - 110px);
  overflow-y: auto;
  padding-right: 4px;
}

/* 滚动条美化 */
.provider-modal-scroll::-webkit-scrollbar {
  width: 6px;
}

.provider-modal-scroll::-webkit-scrollbar-thumb {
  background: var(--admin-border-strong);
  border-radius: 3px;
}

.provider-modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.provider-form {
  display: flex;
  flex-direction: column;
}

.provider-form :deep(.ant-form-item) {
  margin-bottom: 16px;
}

.form-item-tight {
  margin-bottom: 14px !important;
}

/* 1. 服务商单选网格 */
.family-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.family-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 8px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text);
  background: var(--admin-surface);
  cursor: pointer;
  font-size: var(--admin-font-xs);
  font-weight: 500;
  transition: all 120ms ease;
  user-select: none;
}

.family-option:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
}

.family-option.is-active {
  border-color: var(--admin-primary);
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  box-shadow: 0 0 0 1px var(--admin-primary);
  font-weight: 600;
}

.family-option__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2. 备注与状态排版 */
.form-row-balanced {
  display: grid;
  grid-template-columns: 1fr 180px;
  gap: 16px;
}

.form-col-note,
.form-col-status {
  min-width: 0;
}

.status-toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
  user-select: none;
}

.status-toggle-card:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-icon {
  font-size: 14px;
}

.status-icon.is-active {
  color: var(--admin-success);
}

.status-icon.is-inactive {
  color: var(--admin-text-subtle);
}

.status-label {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 500;
}

/* 5. 验证与模型导入卡片 */
.connectivity-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface-muted);
}

.connectivity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.connectivity-title {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  line-height: 1.3;
}

.fetch-btn {
  flex-shrink: 0;
  font-size: var(--admin-font-xs);
}

.connectivity-body {
  min-width: 0;
}

.fetching-loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.loading-icon {
  color: var(--admin-primary);
}
</style>
