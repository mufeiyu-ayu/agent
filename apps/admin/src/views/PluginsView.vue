<script setup lang="ts">
import type { McpPlugin } from '@agent/contracts'
import { Alert, Button, Input, Modal, Popconfirm, Space, Table, Tag } from 'ant-design-vue'
import { computed, ref } from 'vue'
import PluginForm from '@/features/mcp/PluginForm.vue'
import { useSystemPlugins } from '@/features/mcp/useSystemPlugins'

const p = useSystemPlugins()
const search = ref('')
const headers = ref<Record<string, string>>({})
const rows = computed(() =>
  p.rows.value.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(search.value.toLowerCase())),
)
const columns = [
  { title: '插件', key: 'name' },
  { title: '认证', key: 'authType' },
  { title: '状态', key: 'state' },
  { title: '操作', key: 'actions', width: 290 },
]
function test(plugin: McpPlugin) {
  headers.value = {}
  p.testMessage.value = ''
  p.testPlugin.value = plugin
  p.error.value = ''
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">
          系统插件
        </h1>
        <p class="mt-2 text-sm text-slate-500">
          维护用户可选择的 MCP 服务。每位用户自行授权和启用。
        </p>
      </div>
      <Space>
        <Button :disabled="p.busy.value" :loading="p.loading.value" @click="p.reload">
          刷新
        </Button><Button type="primary" :disabled="p.busy.value" @click="p.edit(null)">
          新增插件
        </Button>
      </Space>
    </div>
    <Alert
      v-if="p.error.value && !p.editorOpen.value && !p.testPlugin.value"
      type="error"
      :message="p.error.value"
      show-icon
    />
    <Input v-model:value="search" placeholder="搜索名称或介绍" allow-clear class="max-w-sm" />
    <Table
      :columns="columns"
      :data-source="rows"
      row-key="id"
      :loading="p.loading.value"
      :pagination="false"
      :scroll="{ x: 750 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div class="flex items-center gap-3">
            <img v-if="record.icon" :src="record.icon" alt="" class="h-9 w-9 rounded-lg object-contain">
            <div>
              <div class="font-medium">
                {{ record.name }}
              </div>
              <div class="mt-1 max-w-md truncate text-xs text-slate-500">
                {{ record.description }}
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="column.key === 'authType'">
          {{ record.authType === "oauth" ? "OAuth" : record.authType === "headers" ? "个人密钥" : "无需认证" }}
        </template>
        <Tag v-else-if="column.key === 'state'" :color="record.available ? 'green' : 'default'">
          {{ record.available ? "已上架" : "已停用" }}
        </Tag>
        <Space v-else-if="column.key === 'actions'">
          <Button size="small" :disabled="p.busy.value" @click="p.edit(record as McpPlugin)">
            编辑
          </Button><Button size="small" :disabled="p.busy.value" @click="test(record as McpPlugin)">
            测试
          </Button><Button size="small" :disabled="p.busy.value" @click="p.toggle(record as McpPlugin)">
            {{ record.available ? "停用" : "上架" }}
          </Button><Popconfirm
            title="删除后，用户将无法继续调用此插件。确认删除？"
            ok-text="删除"
            cancel-text="取消"
            :disabled="p.busy.value"
            @confirm="p.remove(record as McpPlugin)"
          >
            <Button danger size="small" :disabled="p.busy.value">
              删除
            </Button>
          </Popconfirm>
        </Space>
      </template>
    </Table>
    <PluginForm
      v-model:open="p.editorOpen.value"
      :plugin="p.selected.value"
      :busy="p.busy.value"
      :error="p.error.value"
      @save="p.save"
    />
    <Modal
      :open="!!p.testPlugin.value"
      title="测试插件连接"
      ok-text="测试连接"
      cancel-text="关闭"
      :confirm-loading="p.busy.value"
      :closable="!p.busy.value"
      :mask-closable="!p.busy.value"
      :keyboard="!p.busy.value"
      :cancel-button-props="{ disabled: p.busy.value }"
      @ok="p.test(headers)"
      @cancel="p.testPlugin.value = null"
    >
      <p class="my-4 text-sm text-slate-500">
        测试凭据仅属于当前管理员，不会提供给其他用户。OAuth 服务会跳转授权页面。
      </p>
      <label v-for="name in p.testPlugin.value?.headerNames ?? []" :key="name" class="mb-4 block">{{ name }}<Input v-model:value="headers[name]" type="password" :disabled="p.busy.value" class="mt-2" /></label>
      <Alert v-if="p.testMessage.value" type="success" :message="p.testMessage.value" />
      <ul v-if="p.testMessage.value" class="my-3 space-y-2 text-sm">
        <li v-for="tool in p.rows.value.find((row) => row.id === p.testPlugin.value?.id)?.tools ?? []" :key="tool.name">
          {{ tool.name }} — {{ tool.description }}
        </li>
      </ul>
      <Alert v-if="p.error.value" type="error" :message="p.error.value" />
    </Modal>
  </div>
</template>
