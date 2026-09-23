<script setup lang="ts">
import type {
  AdminLlmModel,
  AdminLlmModelInput,
  AdminLlmProvider,
  AdminLlmProviderInput,
  ReasoningEffort,
} from '@agent/contracts'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Skeleton,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import LlmModelFormModal from '@/features/llm/components/LlmModelFormModal.vue'
import LlmModelTable from '@/features/llm/components/LlmModelTable.vue'
import LlmProviderFormModal from '@/features/llm/components/LlmProviderFormModal.vue'
import LlmProviderTable from '@/features/llm/components/LlmProviderTable.vue'
import { createLlmModelsState } from '@/features/llm/llm-models.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const { message } = AntApp.useApp()

const state = createLlmModelsState()

onMounted(() => {
  void state.loadProviders()
  void state.loadModels()
})

/** 右侧默认列全部模型；勾上只看当前选中服务商的。 */
const onlySelectedProvider = ref(false)
const visibleModels = computed(() => (
  onlySelectedProvider.value && state.selectedProviderId.value
    ? state.models.value.filter(model => model.providerId === state.selectedProviderId.value)
    : state.models.value
))

onBeforeUnmount(() => {
  state.cancel()
})

watch(
  () => state.providers.value,
  (providers) => {
    if (!providers.length) {
      if (state.selectedProviderId.value !== null) {
        state.selectProvider(null)
      }
      return
    }
    const currentStillExists = providers.some(p => p.id === state.selectedProviderId.value)
    if (!currentStillExists) {
      state.selectProvider(providers[0].id)
    }
  },
  { immediate: true },
)

// Provider modal state
const providerModalOpen = ref(false)
const editingProvider = ref<AdminLlmProvider | null>(null)

/** 编辑服务商时置灰它已导入的 wireName。 */
const providerModalExisting = computed(() => state.models.value
  .filter(model => model.providerId === editingProvider.value?.id)
  .map(model => model.wireName))

function openCreateProviderModal() {
  editingProvider.value = null
  state.clearFetchedModelNames()
  providerModalOpen.value = true
}

function handleEditProvider(provider: AdminLlmProvider) {
  editingProvider.value = provider
  state.clearFetchedModelNames()
  providerModalOpen.value = true
}

/** 弹窗里的拉取 / 测试都带上正在编辑的服务商 id：密钥留空时服务端用库里那把。 */
function handleFetchInProviderForm(input: { baseUrl: string, apiKey: string }) {
  void runWrite(() => state.fetchModelNames({ providerId: editingProvider.value?.id, ...input }))
}

function handleTestInProviderForm(input: { baseUrl: string, apiKey: string }, wireNames: string[]) {
  void runWrite(() => state.testModels({ providerId: editingProvider.value?.id, ...input }, wireNames))
}

/** 写操作失败统一弹提示；state 只负责请求与刷新，不碰 UI。 */
async function runWrite(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation()
    return true
  }
  catch (error) {
    message.error(formatAdminRunError(error))
    return false
  }
}

async function handleSubmitProvider(input: AdminLlmProviderInput, wireNames: string[]) {
  const provider = editingProvider.value
  const ok = await runWrite(async () => {
    if (!provider) {
      await state.createProvider({ ...input, importWireNames: wireNames })
      return
    }

    await state.updateProvider(provider.id, input)
    if (wireNames.length > 0) {
      const result = await state.importModels(wireNames, provider.id, input)

      message.success(t('llmModels.fetch.importSuccess', { ...result }))
    }
  })

  if (ok)
    providerModalOpen.value = false
}

function handleDeleteProvider(id: string) {
  void runWrite(() => state.deleteProvider(id))
}

function handleToggleProviderEnabled(id: string, enabled: boolean) {
  void runWrite(() => state.updateProvider(id, { enabled }))
}

// Model modal state
const modelModalOpen = ref(false)
const editingModel = ref<AdminLlmModel | null>(null)
const editingModelFamily = computed(() => (
  state.providers.value.find(provider => provider.id === editingModel.value?.providerId)?.family ?? null
))

function handleEditModel(model: AdminLlmModel) {
  editingModel.value = model
  modelModalOpen.value = true
}

async function handleSubmitModel(input: AdminLlmModelInput) {
  const model = editingModel.value

  if (!model)
    return

  if (await runWrite(() => state.updateModel(model.id, input)))
    modelModalOpen.value = false
}

function handleDeleteModel(id: string) {
  void runWrite(() => state.deleteModel(id))
}

function handleUpdateModelReasoningEffort(id: string, reasoningEffort: ReasoningEffort | null) {
  void runWrite(() => state.updateModel(id, { reasoningEffort }))
}

function handleToggleModelVisible(id: string, visible: boolean) {
  void runWrite(() => state.updateModel(id, { visible }))
}

function handleSetDefaultModel(id: string) {
  void runWrite(() => state.setDefaultModel(id))
}

function handleProbeModel(id: string) {
  void runWrite(() => state.probeModels([id]))
}

/** 重测当前列表里的全部模型。 */
function handleProbeVisibleModels() {
  void runWrite(() => state.probeModels(visibleModels.value.map(model => model.id)))
}
</script>

<template>
  <PageContainer wide class="llm-workspace-page">
    <h1 class="sr-only">
      {{ t('llmModels.title') }}
    </h1>

    <div class="llm-workspace">
      <!-- Left: Providers Master Column -->
      <aside class="providers-pane">
        <header class="pane-header">
          <div class="pane-title">
            <span>{{ t('llmModels.providers.title') }}</span>
            <span class="count-tag">{{ state.providers.value.length }}</span>
          </div>

          <Button
            type="primary"
            size="small"
            class="add-provider-btn"
            @click="openCreateProviderModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            {{ t('llmModels.providers.add') }}
          </Button>
        </header>

        <div class="providers-pane__body">
          <Alert
            v-if="state.providersError.value"
            class="pane-alert"
            type="error"
            show-icon
            :message="t('llmModels.providers.loadFailed')"
            :description="state.providersError.value"
          >
            <template #action>
              <Button
                size="small"
                :loading="state.providersLoading.value"
                @click="state.loadProviders"
              >
                {{ t('common.actions.retry') }}
              </Button>
            </template>
          </Alert>

          <LlmProviderTable
            v-else
            :providers="state.providers.value"
            :selected-id="state.selectedProviderId.value"
            :loading="state.providersLoading.value"
            @select="state.selectProvider"
            @edit="handleEditProvider"
            @delete="handleDeleteProvider"
            @toggle-enabled="handleToggleProviderEnabled"
          />
        </div>
      </aside>

      <!-- Right: Selected Provider Workspace & Models Catalog -->
      <main class="models-pane">
        <div class="provider-workspace">
          <header class="models-header">
            <div class="models-header__left">
              <span class="models-title">
                {{ onlySelectedProvider && state.selectedProvider.value
                  ? t('llmModels.models.title', { name: `${t(`llmModels.families.${state.selectedProvider.value.family}`)} · ${state.selectedProvider.value.note}` })
                  : t('llmModels.models.allTitle', { count: state.models.value.length }) }}
              </span>
            </div>

            <div class="models-actions">
              <Checkbox
                v-model:checked="onlySelectedProvider"
                :disabled="!state.selectedProvider.value"
                class="filter-checkbox"
              >
                {{ t('llmModels.models.onlySelectedProvider') }}
              </Checkbox>

              <Tooltip :title="t('llmModels.models.probeAll')">
                <Button
                  size="small"
                  class="probe-all-btn"
                  :disabled="visibleModels.length === 0"
                  :loading="state.probingModelIds.value.size > 0"
                  @click="handleProbeVisibleModels"
                >
                  <template #icon>
                    <ReloadOutlined />
                  </template>
                </Button>
              </Tooltip>
            </div>
          </header>

          <!-- Models Catalog Area -->
          <div class="models-content">
            <Alert
              v-if="state.modelsError.value"
              class="models-alert"
              type="error"
              show-icon
              :message="t('llmModels.models.loadFailed')"
              :description="state.modelsError.value"
            >
              <template #action>
                <Button
                  size="small"
                  :loading="state.modelsLoading.value"
                  @click="state.loadModels"
                >
                  {{ t('common.actions.retry') }}
                </Button>
              </template>
            </Alert>

            <Skeleton
              v-else-if="state.modelsLoading.value && !state.models.value.length"
              active
              class="models-skeleton"
              :paragraph="{ rows: 8 }"
            />

            <LlmModelTable
              v-else
              :models="visibleModels"
              :providers="state.providers.value"
              :loading="state.modelsLoading.value"
              :probing-ids="state.probingModelIds.value"
              @edit="handleEditModel"
              @delete="handleDeleteModel"
              @toggle-visible="handleToggleModelVisible"
              @update-reasoning-effort="handleUpdateModelReasoningEffort"
              @set-default="handleSetDefaultModel"
              @probe="handleProbeModel"
            />
          </div>
        </div>
      </main>
    </div>

    <!-- Modals -->
    <LlmProviderFormModal
      :open="providerModalOpen"
      :provider="editingProvider"
      :submitting="state.submitting.value"
      :candidates="state.fetchedModelNames.value"
      :fetching-candidates="state.fetchingModels.value"
      :existing="providerModalExisting"
      :test-results="state.modelTestResults.value"
      :testing-names="state.testingWireNames.value"
      @fetch-models="handleFetchInProviderForm"
      @test-models="handleTestInProviderForm"
      @credentials-change="state.setFormCredentials"
      @submit="handleSubmitProvider"
      @cancel="providerModalOpen = false"
    />

    <LlmModelFormModal
      v-if="editingModel"
      :open="modelModalOpen"
      :model="editingModel"
      :family="editingModelFamily"
      :submitting="state.submitting.value"
      @submit="handleSubmitModel"
      @cancel="modelModalOpen = false"
    />
  </PageContainer>
</template>

<style scoped>
.llm-workspace-page {
  display: flex;
  flex-direction: column;
}

.llm-workspace {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  /* 填满内容区：AdminLayout 的 .admin-content 是视口减头部与 tabs，上下各 20px 内边距。 */
  height: calc(100vh - var(--admin-header-height) - var(--admin-tabs-height) - 40px);
  min-height: 560px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  overflow: hidden;
}

@media (max-width: 1024px) {
  .llm-workspace {
    grid-template-columns: 1fr;
    height: auto;
  }
}

.providers-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 1px solid var(--admin-border);
  background: var(--admin-surface);
  overflow: hidden;
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 48px;
  flex: 0 0 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.pane-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.count-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  color: var(--admin-text-muted);
  background: var(--admin-surface-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
}

.add-provider-btn {
  font-size: var(--admin-font-xs);
}

.providers-pane__body {
  flex: 1;
  overflow-y: auto;
}

.pane-alert {
  margin: 12px 14px;
}

.models-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--admin-surface);
  overflow: hidden;
}

.provider-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.models-header__left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.models-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  flex: 0 0 auto;
  padding: 8px 18px;
  border-bottom: 1px solid var(--admin-border);
}

.models-title {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.models-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-checkbox {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  user-select: none;
}

.probe-all-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-muted);
  transition: all 120ms ease;
}

.probe-all-btn:hover:not(:disabled) {
  color: var(--admin-primary);
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
}

.models-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.models-alert {
  margin: 12px 18px;
}

.models-skeleton {
  padding: 20px 18px;
}
</style>
