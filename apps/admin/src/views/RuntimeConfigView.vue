<script setup lang="ts">
import type { FormInstance, Rule } from 'ant-design-vue/es/form'
import type { RuntimeConfigForm } from '@/features/runtime-config/runtime-config.state'
import { RUNTIME_CONFIG_LIMITS } from '@agent/contracts'
import { QuestionCircleOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Divider,
  Form,
  FormItem,
  InputNumber,
  InputPassword,
  Skeleton,
  Switch,
  Tooltip,
} from 'ant-design-vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import {
  createRuntimeConfigState,
  isRuntimeConfigDirty,
  toRuntimeConfigForm,
} from '@/features/runtime-config/runtime-config.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const { message } = AntApp.useApp()
const state = createRuntimeConfigState()
const formRef = ref<FormInstance>()
const form = reactive<RuntimeConfigForm>({
  maxSamplingRounds: 0,
  maxToolCalls: 0,
  runDeadlineSeconds: 0,
  historyCandidateHardLimit: 0,
  debugCaptureModelIo: false,
  serperApiKey: '',
})

/** 时限在表单里按秒，上限由毫秒上限换算。 */
const LIMITS = {
  ...RUNTIME_CONFIG_LIMITS,
  runDeadlineSeconds: { min: 1, max: Math.floor(RUNTIME_CONFIG_LIMITS.runDeadlineMs.max / 1000) },
}

type LimitField = 'maxSamplingRounds' | 'maxToolCalls' | 'runDeadlineSeconds' | 'historyCandidateHardLimit'

const limitFields: LimitField[] = ['maxSamplingRounds', 'maxToolCalls', 'runDeadlineSeconds', 'historyCandidateHardLimit']

const rules = computed<Record<LimitField, Rule[]>>(() => ({
  maxSamplingRounds: rangeRules('maxSamplingRounds'),
  maxToolCalls: rangeRules('maxToolCalls'),
  runDeadlineSeconds: rangeRules('runDeadlineSeconds'),
  historyCandidateHardLimit: rangeRules('historyCandidateHardLimit'),
}))

function rangeRules(field: LimitField): Rule[] {
  const { min, max } = LIMITS[field]

  return [{
    validator: async (_rule: unknown, value: number | null) => {
      if (value === null || !Number.isInteger(value) || value < min || value > max)
        throw new Error(t('runtimeConfig.rangeInvalid', { min: min.toLocaleString('en-US'), max: max.toLocaleString('en-US') }))
    },
    trigger: 'change',
  }]
}

const dirty = computed(() => state.config.value !== null && isRuntimeConfigDirty(form, state.config.value))
const serperPlaceholder = computed(() => state.config.value?.serperApiKeyLast4
  ? t('runtimeConfig.serperApiKeyConfigured', { last4: state.config.value.serperApiKeyLast4 })
  : t('runtimeConfig.serperApiKeyEmpty'))

// 加载或保存成功后，表单回到库里的值（Key 输入框清空）。
watch(() => state.config.value, (config) => {
  if (config)
    Object.assign(form, toRuntimeConfigForm(config))
})

onMounted(() => {
  void state.load()
})

async function save() {
  if (!dirty.value || state.saving.value)
    return

  try {
    await formRef.value?.validate()
  }
  catch {
    return
  }

  try {
    await state.save(form)
    void message.success(t('runtimeConfig.saved'))
  }
  catch (caught) {
    void message.error(formatAdminRunError(caught))
  }
}
</script>

<template>
  <PageContainer>
    <PageHeader :title="t('runtimeConfig.title')">
      <template #actions>
        <Button
          type="primary"
          :loading="state.saving.value"
          :disabled="!dirty"
          @click="save"
        >
          {{ t('runtimeConfig.save') }}
        </Button>
      </template>
    </PageHeader>

    <Alert
      v-if="state.error.value"
      type="error"
      show-icon
      :message="t('runtimeConfig.loadFailed')"
      :description="state.error.value"
    >
      <template #action>
        <Button size="small" :loading="state.loading.value" @click="state.load">
          {{ t('common.actions.retry') }}
        </Button>
      </template>
    </Alert>

    <Skeleton v-else-if="!state.config.value" active :paragraph="{ rows: 8 }" />

    <section v-else class="config-card">
      <Form
        ref="formRef"
        :model="form"
        :rules="rules"
        layout="vertical"
        :disabled="state.saving.value"
        class="config-form"
      >
        <Divider orientation="left" orientation-margin="0" class="config-divider">
          {{ t('runtimeConfig.groups.limits') }}
        </Divider>
        <div class="config-grid">
          <FormItem v-for="field in limitFields" :key="field" :name="field">
            <template #label>
              <span class="config-label">
                {{ t(`runtimeConfig.fields.${field}`) }}
                <Tooltip :title="t(`runtimeConfig.tips.${field}`)">
                  <QuestionCircleOutlined class="config-label__tip" />
                </Tooltip>
              </span>
            </template>
            <!-- 不设 min / max：失焦时自动夹到边界会让超范围的输入悄悄变值，交给校验提示。 -->
            <InputNumber v-model:value="form[field]" class="full-width" />
          </FormItem>
        </div>

        <Divider orientation="left" orientation-margin="0" class="config-divider">
          {{ t('runtimeConfig.groups.webSearch') }}
        </Divider>
        <div class="config-grid">
          <FormItem name="serperApiKey">
            <template #label>
              <span class="config-label">
                {{ t('runtimeConfig.fields.serperApiKey') }}
                <Tooltip :title="t('runtimeConfig.tips.serperApiKey')">
                  <QuestionCircleOutlined class="config-label__tip" />
                </Tooltip>
              </span>
            </template>
            <InputPassword
              v-model:value="form.serperApiKey"
              :placeholder="serperPlaceholder"
              autocomplete="new-password"
            />
          </FormItem>
        </div>

        <Divider orientation="left" orientation-margin="0" class="config-divider">
          {{ t('runtimeConfig.groups.debug') }}
        </Divider>
        <div class="config-switch">
          <Switch id="runtime-config-debug" v-model:checked="form.debugCaptureModelIo" />
          <label for="runtime-config-debug" class="config-label">
            {{ t('runtimeConfig.fields.debugCaptureModelIo') }}
          </label>
          <Tooltip :title="t('runtimeConfig.tips.debugCaptureModelIo')">
            <QuestionCircleOutlined class="config-label__tip" />
          </Tooltip>
        </div>
      </Form>
    </section>
  </PageContainer>
</template>

<style scoped>
.config-card {
  padding: 8px 24px 24px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-surface);
}

.config-divider {
  margin: 18px 0 14px;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}

.config-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text);
}

.config-label__tip {
  color: var(--admin-text-muted);
  cursor: help;
}

.config-switch {
  display: flex;
  align-items: center;
  gap: 10px;
}

.full-width {
  width: 100%;
}

@media (max-width: 720px) {
  .config-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
