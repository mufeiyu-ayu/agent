<script setup lang="ts">
import SkillsList from '@/components/skills/SkillsList.vue'
</script>

<template>
  <section class="relative min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-20 min-[960px]:pt-8 sm:px-10">
    <div class="mx-auto max-w-4xl">
      <h1 class="text-2xl font-semibold">
        技能
      </h1>
      <p class="mb-8 mt-2 text-sm text-agent-ink-muted">
        将常用方法保存为技能，在聊天中随时使用。
      </p>
      <SkillsList />
    </div>
  </section>
</template>
