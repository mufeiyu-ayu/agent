<script setup lang="ts">
import type { AdminLlmModel, AdminLlmModelInput } from '@agent/contracts'
import type { FormInstance, Rule } from 'ant-design-vue/es/form'
import {
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Switch,
} from 'ant-design-vue'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  model: AdminLlmModel | null
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: [input: AdminLlmModelInput]
  cancel: []
}>()

const { t } = useI18n()
const formRef = ref<FormInstance>()

interface FormState {
  wireName: string
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoning: boolean
  visible: boolean
  isDefault: boolean
  sortOrder: number
}

const formState = reactive<FormState>({
  wireName: '',
  displayName: '',
  contextWindowTokens: 128000,
  maxOutputTokens: 8192,
  reasoning: false,
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
  contextWindowTokens: [
    {
      required: true,
      message: t('llmModels.models.form.contextWindowTokensRequired'),
      trigger: 'blur',
    },
    {
      validator: async (_rule: unknown, value: number) => {
        if (!value || value <= 0 || !Number.isInteger(value)) {
          return Promise.reject(new Error(t('llmModels.models.form.contextWindowTokensInvalid')))
        }
        return Promise.resolve()
      },
      trigger: 'blur',
    },
  ],
  maxOutputTokens: [
    {
      required: true,
      message: t('llmModels.models.form.maxOutputTokensRequired'),
      trigger: 'blur',
    },
    {
      validator: async (_rule: unknown, value: number) => {
        if (!value || value <= 0 || !Number.isInteger(value)) {
          return Promise.reject(new Error(t('llmModels.models.form.maxOutputTokensInvalid')))
        }
        return Promise.resolve()
      },
      trigger: 'blur',
    },
  ],
}))

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen)
      return
    formRef.value?.clearValidate()
    if (props.model) {
      formState.wireName = props.model.wireName
      formState.displayName = props.model.displayName
      formState.contextWindowTokens = props.model.contextWindowTokens
      formState.maxOutputTokens = props.model.maxOutputTokens
      formState.reasoning = props.model.reasoning
      formState.visible = props.model.visible
      formState.isDefault = props.model.isDefault
      formState.sortOrder = props.model.sortOrder
    }
    else {
      formState.wireName = ''
      formState.displayName = ''
      formState.contextWindowTokens = 128000
      formState.maxOutputTokens = 8192
      formState.reasoning = false
      formState.visible = true
      formState.isDefault = false
      formState.sortOrder = 0
    }
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
    reasoning: formState.reasoning,
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
    :width="560"
    destroy-on-close
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

      <FormItem
        :label="t('llmModels.models.form.sortOrder')"
        name="sortOrder"
        :extra="t('llmModels.models.form.sortOrderHelp')"
      >
        <InputNumber
          v-model:value="formState.sortOrder"
          :step="1"
          class="full-width"
        />
      </FormItem>

      <div class="toggles-group">
        <div class="toggle-row">
          <div class="toggle-text">
            <strong class="toggle-title">{{ t('llmModels.models.form.reasoning') }}</strong>
            <span class="toggle-desc">{{ t('llmModels.models.form.reasoningDesc') }}</span>
          </div>
          <Switch v-model:checked="formState.reasoning" />
        </div>

        <div class="toggle-row">
          <div class="toggle-text">
            <strong class="toggle-title">{{ t('llmModels.models.form.visible') }}</strong>
            <span class="toggle-desc">{{ t('llmModels.models.form.visibleDesc') }}</span>
          </div>
          <Switch v-model:checked="formState.visible" />
        </div>

        <div class="toggle-row">
          <div class="toggle-text">
            <strong class="toggle-title">{{ t('llmModels.models.form.isDefault') }}</strong>
            <span class="toggle-desc">{{ t('llmModels.models.form.isDefaultDesc') }}</span>
          </div>
          <Switch v-model:checked="formState.isDefault" />
        </div>
      </div>
    </Form>
  </Modal>
</template>

<style scoped>
.model-form {
  margin-top: 18px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-col {
  flex: 1;
}

.full-width {
  width: 100%;
}

.toggles-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-title {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.toggle-desc {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}
</style>
