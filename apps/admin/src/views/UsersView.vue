<script setup lang="ts">
import type { AdminUser, UserRole, UserStatus } from '@agent/contracts'
import type { FormInstance, TableColumnsType } from 'ant-design-vue'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_ROLES, USER_STATUSES, userDisplayName } from '@agent/contracts'
import { PlusOutlined } from '@ant-design/icons-vue'
import {
  Alert,
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
  Table,
  Tag,
} from 'ant-design-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuth } from '@/features/auth/auth.state'
import { formatDateTime } from '@/features/runs/run.utils'
import { formatAdminRunError } from '@/features/shared/admin-api'
import { createUsersState } from '@/features/users/users.state'

const { t, locale } = useI18n()
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
  { key: 'actions', title: t('users.columns.actions'), width: 280 },
])
const roleOptions = computed(() => USER_ROLES.map(role => ({ value: role, label: t(`users.roles.${role}`) })))
const passwordRules = computed(() => [{ required: true, min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH, message: t('users.passwordLength', { min: PASSWORD_MIN_LENGTH }) }])

/** Table 的 bodyCell record 未带类型，这里收窄。 */
function asUser(record: unknown): AdminUser {
  return record as AdminUser
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
  const successKey = user.status === 'PENDING'
    ? status === 'ACTIVE' ? 'users.approved' : 'users.rejected'
    : status === 'ACTIVE' ? 'users.enabled' : 'users.disabled'
  void run(() => state.update(user.id, { status }), successKey)
}

function changeRole(user: AdminUser, role: UserRole) {
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

async function submitCreate() {
  if (!await isValid(createFormRef.value))
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

async function submitReset() {
  const target = resetTarget.value

  if (!target)
    return

  if (!await isValid(resetFormRef.value))
    return

  await run(async () => {
    await state.resetPassword(target.id, resetForm.password)
    resetTarget.value = null
  }, 'users.passwordReset')
}
</script>

<template>
  <PageContainer>
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

    <Alert v-if="state.error.value" type="error" :message="state.error.value" show-icon class="users-error" />

    <Table
      row-key="id"
      :columns="columns"
      :data-source="state.users.value"
      :loading="state.loading.value"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'user'">
          <span class="users-identity">
            <UserAvatar :user="asUser(record)" />
            <span>
              <strong>{{ userDisplayName(asUser(record)) }}</strong>
              <small>{{ asUser(record).email }}</small>
            </span>
          </span>
        </template>
        <template v-else-if="column.key === 'role'">
          <Tag :color="asUser(record).role === 'ADMIN' ? 'blue' : undefined">
            {{ t(`users.roles.${asUser(record).role}`) }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <Tag v-if="asUser(record).status === 'PENDING'" color="gold">
            {{ t('users.statuses.PENDING') }}
          </Tag>
          <Tag v-else-if="asUser(record).status === 'DISABLED'" color="red">
            {{ t('users.statuses.DISABLED') }}
          </Tag>
          <Tag v-else-if="asUser(record).mustChangePassword" color="orange">
            {{ t('users.mustChangePassword') }}
          </Tag>
          <Tag v-else color="green">
            {{ t('users.statuses.ACTIVE') }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'lastLoginAt'">
          {{ formatDateTime(asUser(record).lastLoginAt, locale) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <!-- 待审核只给通过 / 拒绝；拒绝后该邮箱不能再申请，管理员之后可手动启用。 -->
          <Space v-if="asUser(record).status === 'PENDING'">
            <Button size="small" type="primary" :disabled="state.submitting.value" @click="setStatus(asUser(record), 'ACTIVE')">
              {{ t('users.approve') }}
            </Button>
            <Popconfirm :title="t('users.confirmReject', { email: asUser(record).email })" @confirm="setStatus(asUser(record), 'DISABLED')">
              <Button size="small" danger :disabled="state.submitting.value">
                {{ t('users.reject') }}
              </Button>
            </Popconfirm>
          </Space>
          <!-- 自己那行不给操作：改角色、重置密码、停用都会删掉自己的 Session。 -->
          <Space v-else-if="asUser(record).id !== currentUser?.id">
            <Select
              size="small"
              :value="asUser(record).role"
              :options="roleOptions"
              :disabled="state.submitting.value"
              :aria-label="t('users.columns.role')"
              class="users-role"
              @change="changeRole(asUser(record), $event as UserRole)"
            />
            <Button size="small" :disabled="state.submitting.value" @click="openReset(asUser(record))">
              {{ t('users.resetPassword') }}
            </Button>
            <Popconfirm
              :title="t(asUser(record).status === 'DISABLED' ? 'users.confirmEnable' : 'users.confirmDisable', { email: asUser(record).email })"
              @confirm="setStatus(asUser(record), asUser(record).status === 'DISABLED' ? 'ACTIVE' : 'DISABLED')"
            >
              <Button size="small" :danger="asUser(record).status !== 'DISABLED'" :disabled="state.submitting.value">
                {{ t(asUser(record).status === 'DISABLED' ? 'users.enable' : 'users.disable') }}
              </Button>
            </Popconfirm>
          </Space>
        </template>
      </template>
    </Table>

    <Modal
      v-model:open="createOpen"
      :title="t('users.create')"
      :confirm-loading="state.submitting.value"
      :ok-text="t('users.create')"
      destroy-on-close
      @ok="submitCreate"
    >
      <Form ref="createFormRef" layout="vertical" :model="createForm">
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
      :confirm-loading="state.submitting.value"
      destroy-on-close
      @ok="submitReset"
      @cancel="resetTarget = null"
    >
      <Form ref="resetFormRef" layout="vertical" :model="resetForm">
        <FormItem :label="t('users.temporaryPassword')" name="password" :rules="passwordRules" :extra="t('users.initialPasswordHint')">
          <InputPassword v-model:value="resetForm.password" autocomplete="new-password" />
        </FormItem>
      </Form>
    </Modal>
  </PageContainer>
</template>

<style scoped>
.users-error {
  margin-bottom: 16px;
}

.users-role {
  width: 96px;
}

.users-identity {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.users-identity small {
  display: block;
  color: var(--admin-text-muted);
}
</style>
