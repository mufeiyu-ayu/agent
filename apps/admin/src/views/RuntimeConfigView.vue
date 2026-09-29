<script setup lang="ts">
import type { FormInstance, Rule } from 'ant-design-vue/es/form'
import type { RuntimeConfigForm } from '@/features/runtime-config/runtime-config.state'
import { RUNTIME_CONFIG_LIMITS } from '@agent/contracts'
import { QuestionCircleOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Form,
  FormItem,
  InputNumber,
  InputPassword,
  Skeleton,
  Switch,
  Tag,
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
  <PageContainer wide>
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

    <Form
      v-else
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="state.saving.value"
      layout="vertical"
      class="settings"
    >
      <!-- 宽屏两栏：左边运行限制，右边联网搜索与调试；每组是一块面板，一项一行 -->
      <section class="settings-group">
        <h2 class="settings-group__title">
          {{ t('runtimeConfig.groups.limits') }}
        </h2>
        <div class="settings-panel">
          <div v-for="field in limitFields" :key="field" class="settings-row">
            <label :for="`runtime-config-${field}`" class="settings-row__label">
              {{ t(`runtimeConfig.fields.${field}`) }}
              <Tooltip :title="t(`runtimeConfig.tips.${field}`)">
                <QuestionCircleOutlined class="settings-row__tip" />
              </Tooltip>
            </label>
            <FormItem :name="field" class="settings-row__control">
              <!-- 不设 min / max：失焦时自动夹到边界会让超范围的输入悄悄变值，交给校验提示。 -->
              <InputNumber
                :id="`runtime-config-${field}`"
                v-model:value="form[field]"
                :addon-after="t(`runtimeConfig.units.${field}`)"
                class="settings-number"
              />
            </FormItem>
          </div>
        </div>
      </section>

      <div class="settings-column">
        <section class="settings-group">
          <h2 class="settings-group__title">
            {{ t('runtimeConfig.groups.webSearch') }}
          </h2>
          <div class="settings-panel">
            <div class="settings-row">
              <!-- 状态标签放在 label 外面：不算进输入框的名字 -->
              <div class="settings-row__name">
                <label for="runtime-config-serperApiKey" class="settings-row__label">
                  {{ t('runtimeConfig.fields.serperApiKey') }}
                  <Tooltip :title="t('runtimeConfig.tips.serperApiKey')">
                    <QuestionCircleOutlined class="settings-row__tip" />
                  </Tooltip>
                </label>
                <Tag
                  :color="state.config.value.serperApiKeyLast4 ? 'success' : 'default'"
                  :bordered="false"
                >
                  {{ state.config.value.serperApiKeyLast4 ? t('runtimeConfig.configured') : t('runtimeConfig.notConfigured') }}
                </Tag>
              </div>
              <FormItem name="serperApiKey" class="settings-row__control">
                <InputPassword
                  id="runtime-config-serperApiKey"
                  v-model:value="form.serperApiKey"
                  :placeholder="serperPlaceholder"
                  autocomplete="new-password"
                  class="settings-secret"
                />
              </FormItem>
            </div>
          </div>
        </section>

        <section class="settings-group">
          <h2 class="settings-group__title">
            {{ t('runtimeConfig.groups.debug') }}
          </h2>
          <div class="settings-panel">
            <div class="settings-row">
              <label for="runtime-config-debug" class="settings-row__label">
                {{ t('runtimeConfig.fields.debugCaptureModelIo') }}
                <Tooltip :title="t('runtimeConfig.tips.debugCaptureModelIo')">
                  <QuestionCircleOutlined class="settings-row__tip" />
                </Tooltip>
              </label>
              <div class="settings-row__switch">
                <Switch id="runtime-config-debug" v-model:checked="form.debugCaptureModelIo" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </Form>
  </PageContainer>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 28px;
}

.settings-column {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.settings-group__title {
  margin: 0 0 10px 4px;
  color: var(--admin-text);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.settings-panel {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-surface);
}

/* 顶部对齐、名称与开关按输入框高度（32px）居中：校验提示出现时只是这一行变高，不压住控件 */
.settings-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 20px;
}

.settings-row + .settings-row {
  border-top: 1px solid var(--admin-border);
}

.settings-row__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
  height: 32px;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 500;
  white-space: nowrap;
}

.settings-row__tip {
  color: var(--admin-text-subtle);
  font-size: 13px;
  cursor: help;
}

.settings-row__name {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.settings-row__switch {
  display: flex;
  align-items: center;
  height: 32px;
}

.settings-row__control {
  flex: 0 1 auto;
  min-width: 0;
  margin-bottom: 0;
}

.settings-number {
  width: 180px;
}

.settings-secret {
  width: 300px;
  max-width: 100%;
}

@media (max-width: 1200px) {
  .settings {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .settings-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .settings-number,
  .settings-secret {
    width: 100%;
  }
}
</style>
