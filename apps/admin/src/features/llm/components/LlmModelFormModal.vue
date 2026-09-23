<script setup lang="ts">
import type { AdminLlmModel, AdminLlmModelInput, LlmProviderFamily, ReasoningEffort } from '@agent/contracts'
import type { FormInstance, Rule } from 'ant-design-vue/es/form'
import { reasoningEffortsOf } from '@agent/contracts'
import {
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
} from 'ant-design-vue'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  /** 弹窗只用于编辑，页面在有 model 时才挂载它。 */
  model: AdminLlmModel
  /** 所属服务商的家族，决定 reasoning_effort 可选值。 */
  family: LlmProviderFamily | null
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: [input: AdminLlmModelInput]
  cancel: []
}>()

const { t } = useI18n()
const formRef = ref<FormInstance>()

/** 直接用参数值做选项文案，不做映射。 */
const reasoningEffortOptions = computed(() => (
  reasoningEffortsOf(props.family ?? 'other').map(value => ({ value, label: value }))
))

interface FormState {
  wireName: string
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  /** 空串表示不发，提交时转成 null。 */
  reasoningEffort: ReasoningEffort | ''
  visible: boolean
  isDefault: boolean
  sortOrder: number
}

const formState = reactive<FormState>({
  wireName: '',
  displayName: '',
  contextWindowTokens: 128000,
  maxOutputTokens: 8192,
  reasoningEffort: '',
  visible: true,
  isDefault: false,
  sortOrder: 0,
})

const rules = computed<Record<string, Rule[]>>(() => ({
  wireName: [
    {
      required: true,
      message: t('llmModels.models.form.wireNameRequired'),
      trigger: 'blur',
    },
  ],
  displayName: [
    {
      required: true,
      message: t('llmModels.models.form.displayNameRequired'),
      trigger: 'blur',
    },
  ],
  contextWindowTokens: positiveIntRules('contextWindowTokens'),
  maxOutputTokens: positiveIntRules('maxOutputTokens'),
}))

function positiveIntRules(field: 'contextWindowTokens' | 'maxOutputTokens'): Rule[] {
  return [
    { required: true, message: t(`llmModels.models.form.${field}Required`), trigger: 'blur' },
    {
      validator: async (_rule: unknown, value: number) => {
        if (!value || value <= 0 || !Number.isInteger(value))
          throw new Error(t(`llmModels.models.form.${field}Invalid`))
      },
      trigger: 'blur',
    },
  ]
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen)
      return
    formRef.value?.clearValidate()
    formState.wireName = props.model.wireName
    formState.displayName = props.model.displayName
    formState.contextWindowTokens = props.model.contextWindowTokens
    formState.maxOutputTokens = props.model.maxOutputTokens
    // 行上的强度可能落后于刚改过的家族：新家族不认就置空，免得整行提交被服务端按家族校验打回。
    // 家族未知（服务商列表还没回来）时不动，交给服务端校验。
    formState.reasoningEffort = props.model.reasoningEffort
      && (props.family === null || reasoningEffortsOf(props.family).includes(props.model.reasoningEffort))
      ? props.model.reasoningEffort
      : ''
    formState.visible = props.model.visible
    formState.isDefault = props.model.isDefault
    formState.sortOrder = props.model.sortOrder
  },
  { immediate: true },
)

async function handleOk() {
  try {
    await formRef.value?.validate()
  }
  catch {
    return
  }

  const input: AdminLlmModelInput = {
    wireName: formState.wireName.trim(),
    displayName: formState.displayName.trim(),
    contextWindowTokens: Math.floor(formState.contextWindowTokens),
    maxOutputTokens: Math.floor(formState.maxOutputTokens),
    reasoningEffort: formState.reasoningEffort || null,
    visible: formState.visible,
    isDefault: formState.isDefault,
    sortOrder: Math.floor(formState.sortOrder || 0),
  }

  emit('submit', input)
}
</script>

<template>
  <Modal
    :open="open"
    :title="t('llmModels.models.edit')"
    :confirm-loading="submitting"
    :ok-text="t('llmModels.actions.confirm')"
    :cancel-text="t('llmModels.actions.cancel')"
    :width="520"
    destroy-on-close
    class="model-form-modal"
    @ok="handleOk"
    @cancel="emit('cancel')"
  >
    <Form
      ref="formRef"
      :model="formState"
      :rules="rules"
      layout="vertical"
      class="model-form"
    >
      <div class="form-row">
        <FormItem
          :label="t('llmModels.models.form.wireName')"
          name="wireName"
          class="form-col"
        >
          <Input
            v-model:value="formState.wireName"
            :placeholder="t('llmModels.models.form.wireNamePlaceholder')"
          />
        </FormItem>

        <FormItem
          :label="t('llmModels.models.form.displayName')"
          name="displayName"
          class="form-col"
        >
          <Input
            v-model:value="formState.displayName"
            :placeholder="t('llmModels.models.form.displayNamePlaceholder')"
          />
        </FormItem>
      </div>

      <div class="form-row">
        <FormItem
          :label="t('llmModels.models.form.contextWindowTokens')"
          name="contextWindowTokens"
          class="form-col"
        >
          <InputNumber
            v-model:value="formState.contextWindowTokens"
            :min="1"
            :step="1024"
            class="full-width"
          />
        </FormItem>

        <FormItem
          :label="t('llmModels.models.form.maxOutputTokens')"
          name="maxOutputTokens"
          class="form-col"
        >
          <InputNumber
            v-model:value="formState.maxOutputTokens"
            :min="1"
            :step="1024"
            class="full-width"
          />
        </FormItem>
      </div>

      <div class="form-row">
        <FormItem
          :label="t('llmModels.models.form.reasoningEffort')"
          name="reasoningEffort"
          class="form-col"
        >
          <Select
            v-model:value="formState.reasoningEffort"
            :options="reasoningEffortOptions"
            :disabled="reasoningEffortOptions.length === 0"
            :placeholder="t('llmModels.models.form.reasoningEffortNone')"
            allow-clear
            class="full-width"
            @change="(value) => { formState.reasoningEffort = (value ?? '') as ReasoningEffort | '' }"
          />
        </FormItem>

        <FormItem
          :label="t('llmModels.models.form.sortOrder')"
          name="sortOrder"
          class="form-col"
        >
          <InputNumber
            v-model:value="formState.sortOrder"
            :step="1"
            class="full-width"
          />
        </FormItem>
      </div>

      <!-- 优雅并排的双列轻量开关，彻底去除冗余长文案 -->
      <div class="toggles-grid">
        <div
          class="toggle-card"
          :class="{ 'is-active': formState.visible }"
          @click="formState.visible = !formState.visible"
        >
          <span class="toggle-label">{{ t('llmModels.models.form.visible') }}</span>
          <Switch v-model:checked="formState.visible" size="small" @click.stop />
        </div>

        <div
          class="toggle-card"
          :class="{ 'is-active': formState.isDefault }"
          @click="formState.isDefault = !formState.isDefault"
        >
          <span class="toggle-label">{{ t('llmModels.models.form.isDefault') }}</span>
          <Switch v-model:checked="formState.isDefault" size="small" @click.stop />
        </div>
      </div>
    </Form>
  </Modal>
</template>

<style scoped>
.model-form {
  margin-top: 14px;
}

.form-row {
  display: flex;
  gap: 14px;
}

.form-col {
  flex: 1;
  margin-bottom: 14px;
}

.full-width {
  width: 100%;
}

.toggles-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 4px;
  margin-bottom: 4px;
}

.toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  cursor: pointer;
  user-select: none;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.toggle-card:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
}

.toggle-card.is-active {
  border-color: color-mix(in srgb, var(--admin-primary) 35%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-primary) 4%, var(--admin-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--admin-primary) 15%, transparent), var(--admin-shadow-sm);
}

.toggle-label {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 550;
  letter-spacing: -0.01em;
}
</style>
