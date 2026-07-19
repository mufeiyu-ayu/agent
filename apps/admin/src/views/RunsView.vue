<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
</script>

<template>
  <PageContainer>
    <PageHeader
      eyebrow="Observability"
      title="Runs"
      description="这里将承载 AgentRun 列表与运行状态。Task 0 不请求后台数据，也不提前定义查询协议。"
    >
      <template #actions>
        <StatusBadge>Static placeholder</StatusBadge>
      </template>
    </PageHeader>

    <EmptyState
      title="Run 数据尚未接入"
      description="当前页面只验证后台壳、路由与主题能力。Run List、Run Detail 和查询 API 将在后续独立任务中实现。"
    />
  </PageContainer>
</template>
