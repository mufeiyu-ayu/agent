<script setup lang="ts">
import type { AdminUser, UserRole, UserStatus } from '@agent/contracts'
import type { FormInstance, TableColumnsType } from 'ant-design-vue'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_ROLES, USER_STATUSES } from '@agent/contracts'
import { PlusOutlined } from '@ant-design/icons-vue'
import {
  App as AntApp,
  Button,
  Form,
  FormItem,
  Input,
  InputPassword,
  Modal,
  Popconfirm,
  Select,
  Space,
} from 'ant-design-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import UserIdentity from '@/components/common/UserIdentity.vue'
import { useAuth } from '@/features/auth/auth.state'
import { formatDateTime } from '@/features/runs/run.utils'
import { formatAdminRunError } from '@/features/shared/admin-api'
import { createUsersState } from '@/features/users/users.state'

const { t, locale } = useI18n()
const router = useRouter()
const { message } = AntApp.useApp()
const { currentUser } = useAuth()
const state = createUsersState()

onMounted(() => {
  void state.load()
})

const columns = computed<TableColumnsType<AdminUser>>(() => [
  { key: 'user', title: t('users.columns.user') },
  { key: 'role', title: t('users.columns.role'), width: 120 },
  {
    key: 'status',
    title: t('users.columns.status'),
    width: 160,
    // 按状态筛选：待审核的申请在这里找，不另做提醒。
    filters: USER_STATUSES.map(status => ({ text: t(`users.statuses.${status}`), value: status })),
    onFilter: (value, record) => record.status === value,
  },
  { key: 'lastLoginAt', title: t('users.columns.lastLoginAt'), width: 190 },
  { key: 'actions', title: t('users.columns.actions'), width: 380 },
])
const roleOptions = computed(() => USER_ROLES.map(role => ({ value: role, label: t(`users.roles.${role}`) })))
const passwordRules = computed(() => [{ required: true, min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH, message: t('users.passwordLength', { min: PASSWORD_MIN_LENGTH }) }])

function userTone(user: AdminUser): 'success' | 'warning' | 'danger' {
  if (user.status === 'DISABLED')
    return 'danger'
  if (user.status === 'PENDING' || user.mustChangePassword)
    return 'warning'
  return 'success'
}

async function run(action: () => Promise<void>, successKey: string) {
  try {
    await action()
    void message.success(t(successKey))
  }
  catch (caught) {
    void message.error(formatAdminRunError(caught))
  }
}

/** 通过待审核 / 启用 → ACTIVE；拒绝待审核 / 停用 → DISABLED。 */
function setStatus(user: AdminUser, status: Exclude<UserStatus, 'PENDING'>) {
  if (state.pendingUserIds.value.has(user.id))
    return
  const successKey = user.status === 'PENDING'
    ? status === 'ACTIVE' ? 'users.approved' : 'users.rejected'
    : status === 'ACTIVE' ? 'users.enabled' : 'users.disabled'
  void run(() => state.update(user.id, { status }), successKey)
}

function changeRole(user: AdminUser, role: UserRole) {
  if (state.pendingUserIds.value.has(user.id))
    return
  void run(() => state.update(user.id, { role }), 'users.roleChanged')
}

/** 校验不过时 FormItem 已显示原因，这里只决定是否提交。 */
function isValid(form: FormInstance | undefined): Promise<boolean> {
  return form ? form.validate().then(() => true, () => false) : Promise.resolve(true)
}

const createFormRef = ref<FormInstance>()
const resetFormRef = ref<FormInstance>()
const createOpen = ref(false)
const createForm = reactive<{ email: string, password: string, role: UserRole }>({ email: '', password: '', role: 'MEMBER' })

function openCreate() {
  Object.assign(createForm, { email: '', password: '', role: 'MEMBER' })
  createOpen.value = true
}

const validatingCreate = ref(false)
const creating = computed(() => validatingCreate.value || state.creating.value)

async function submitCreate() {
  if (creating.value)
    return
  validatingCreate.value = true
  const valid = await isValid(createFormRef.value)
  validatingCreate.value = false
  if (!valid)
    return

  await run(async () => {
    await state.create({ ...createForm })
    createOpen.value = false
  }, 'users.created')
}

const resetTarget = ref<AdminUser | null>(null)
const resetForm = reactive({ password: '' })

function openReset(user: AdminUser) {
  resetForm.password = ''
  resetTarget.value = user
}

const validatingReset = ref(false)
const resetting = computed(() => validatingReset.value || (resetTarget.value !== null && state.pendingUserIds.value.has(resetTarget.value.id)))

async function submitReset() {
  const target = resetTarget.value

  if (!target || resetting.value)
    return

  validatingReset.value = true
  const valid = await isValid(resetFormRef.value)
  validatingReset.value = false
  if (!valid)
    return

  await run(async () => {
    await state.resetPassword(target.id, resetForm.password)
    resetTarget.value = null
  }, 'users.passwordReset')
}
</script>

<template>
  <PageContainer wide>
    <PageHeader :title="t('users.title')" :description="t('users.description')">
      <template #actions>
        <Button type="primary" @click="openCreate">
          <template #icon>
            <PlusOutlined />
          </template>
          {{ t('users.create') }}
        </Button>
      </template>
    </PageHeader>

    <DataTable
      row-key="id"
      :columns="columns"
      :data-source="state.users.value"
      :loading="state.loading.value"
      :error="state.error.value"
      :error-title="t('users.loadFailed')"
      :summary="t('users.total', { count: state.users.value.length })"
      @retry="state.load"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'user'">
          <UserIdentity :user="record" />
        </template>
        <template v-else-if="column.key === 'role'">
          <span class="users-role-badge" :class="{ 'is-admin': record.role === 'ADMIN' }">
            {{ t(`users.roles.${record.role}`) }}
          </span>
        </template>
        <template v-else-if="column.key === 'status'">
          <span class="users-status" :class="`is-${userTone(record)}`">
            <i />
            {{ record.status === 'ACTIVE' && record.mustChangePassword ? t('users.mustChangePassword') : t(`users.statuses.${record.status}`) }}
          </span>
        </template>
        <template v-else-if="column.key === 'lastLoginAt'">
          <span class="users-muted">{{ formatDateTime(record.lastLoginAt, locale) }}</span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <Button size="small" class="users-conversations" @click="router.push({ name: 'conversations', query: { userId: record.id } })">
            {{ t('users.viewConversations') }}
          </Button>
          <!-- 待审核只给通过 / 拒绝；拒绝后该邮箱不能再申请，管理员之后可手动启用。 -->
          <Space v-if="record.status === 'PENDING'">
            <Button size="small" type="primary" :loading="state.pendingUserIds.value.has(record.id)" @click="setStatus(record, 'ACTIVE')">
              {{ t('users.approve') }}
            </Button>
            <Popconfirm :title="t('users.confirmReject', { email: record.email })" @confirm="setStatus(record, 'DISABLED')">
              <Button size="small" danger :loading="state.pendingUserIds.value.has(record.id)">
                {{ t('users.reject') }}
              </Button>
            </Popconfirm>
          </Space>
          <!-- 自己那行不给操作：改角色、重置密码、停用都会删掉自己的 Session。 -->
          <Space v-else-if="record.id !== currentUser?.id">
            <Select
              size="small"
              :value="record.role"
              :loading="state.pendingUserIds.value.has(record.id)"
              :options="roleOptions"
              :disabled="state.pendingUserIds.value.has(record.id)"
              :aria-label="t('users.columns.role')"
              class="users-role"
              @change="changeRole(record, $event as UserRole)"
            />
            <Button size="small" :disabled="state.pendingUserIds.value.has(record.id)" @click="openReset(record)">
              {{ t('users.resetPassword') }}
            </Button>
            <Popconfirm
              :title="t(record.status === 'DISABLED' ? 'users.confirmEnable' : 'users.confirmDisable', { email: record.email })"
              @confirm="setStatus(record, record.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED')"
            >
              <Button size="small" :danger="record.status !== 'DISABLED'" :loading="state.pendingUserIds.value.has(record.id)">
                {{ t(record.status === 'DISABLED' ? 'users.enable' : 'users.disable') }}
              </Button>
            </Popconfirm>
          </Space>
        </template>
      </template>
    </DataTable>

    <Modal
      v-model:open="createOpen"
      :title="t('users.create')"
      :confirm-loading="creating"
      :closable="!creating"
      :mask-closable="!creating"
      :keyboard="!creating"
      :cancel-button-props="{ disabled: creating }"
      :ok-text="t('users.create')"
      destroy-on-close
      @ok="submitCreate"
    >
      <Form ref="createFormRef" :disabled="creating" layout="vertical" :model="createForm">
        <FormItem :label="t('users.columns.email')" name="email" :rules="[{ required: true, type: 'email', message: t('users.emailInvalid') }]">
          <Input v-model:value="createForm.email" type="email" autocomplete="off" />
        </FormItem>
        <FormItem :label="t('users.initialPassword')" name="password" :rules="passwordRules" :extra="t('users.initialPasswordHint')">
          <InputPassword v-model:value="createForm.password" autocomplete="new-password" />
        </FormItem>
        <FormItem :label="t('users.columns.role')" name="role">
          <Select v-model:value="createForm.role" :options="roleOptions" />
        </FormItem>
      </Form>
    </Modal>

    <Modal
      :open="resetTarget !== null"
      :title="t('users.resetPasswordFor', { email: resetTarget?.email ?? '' })"
      :confirm-loading="resetting"
      :closable="!resetting"
      :mask-closable="!resetting"
      :keyboard="!resetting"
      :cancel-button-props="{ disabled: resetting }"
      destroy-on-close
      @ok="submitReset"
      @cancel="resetTarget = null"
    >
      <Form ref="resetFormRef" :disabled="resetting" layout="vertical" :model="resetForm">
        <FormItem :label="t('users.temporaryPassword')" name="password" :rules="passwordRules" :extra="t('users.initialPasswordHint')">
          <InputPassword v-model:value="resetForm.password" autocomplete="new-password" />
        </FormItem>
      </Form>
    </Modal>
  </PageContainer>
</template>

<style scoped>
.users-role {
  width: 96px;
}

.users-conversations {
  margin-right: 8px;
}

.users-role-badge {
  color: var(--admin-text-muted);
}

.users-role-badge.is-admin {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--admin-primary);
  font-weight: 500;
  background: var(--admin-primary-soft);
}

.users-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.users-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.users-status.is-success i {
  background: var(--admin-success);
}

.users-status.is-warning {
  color: var(--admin-warning);
}

.users-status.is-warning i {
  background: var(--admin-warning);
}

.users-status.is-danger {
  color: var(--admin-danger);
}

.users-status.is-danger i {
  background: var(--admin-danger);
}

.users-muted {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
