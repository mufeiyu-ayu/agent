<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SkillsList from '@/components/skills/SkillsList.vue'
import { useSkills } from '@/hooks/useSkills'

const { t } = useI18n()

const skills = useSkills()
</script>

<template>
  <section class="relative min-h-0 flex-1 overflow-y-auto px-6 pb-16 pt-16 min-[960px]:pt-10 sm:px-10 lg:px-14">
    <div class="mx-auto max-w-4xl">
      <!-- 页面极简头部 -->
      <header class="mb-8 border-b border-agent-border-subtle pb-5">
        <h1 class="text-2xl font-semibold tracking-tight text-agent-ink sm:text-3xl">
          {{ t('skills.title') }}
        </h1>
      </header>

      <!-- 技能列表 -->
      <SkillsList @manual-create="skills.createManual()" />
    </div>
  </section>
</template>
