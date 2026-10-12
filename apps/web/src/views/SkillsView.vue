<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SkillsList from '@/components/skills/SkillsList.vue'
import { useSkills } from '@/hooks/useSkills'

const { t } = useI18n()

const skills = useSkills()
</script>

<template>
  <section class="skills-page relative min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-16 pt-20 sm:px-9 min-[960px]:px-12 min-[960px]:pt-16">
    <div class="mx-auto w-full max-w-[1120px]">
      <header class="mb-10 flex flex-col justify-between gap-6 sm:mb-12 xl:flex-row xl:items-end xl:gap-10">
        <div>
          <p class="mb-4 text-xs font-medium tracking-[0.12em] text-agent-ink-muted">
            {{ t('skills.title') }}
          </p>
          <h1 class="skills-heading text-[clamp(2rem,3.4vw,3rem)] leading-tight tracking-tight text-agent-ink">
            {{ t('skills.pageHeading') }}
          </h1>
        </div>
        <p class="max-w-64 text-sm leading-7 text-agent-ink-muted xl:border-l xl:border-agent-border xl:pl-6">
          {{ t('skills.pageNote') }}
        </p>
      </header>

      <SkillsList @manual-create="skills.createManual()" />
    </div>
  </section>
</template>

<style scoped>
.skills-heading {
  font-family: "Libre Baskerville", Georgia, "Songti SC", "Noto Serif SC", ui-serif, serif;
  text-wrap: balance;
}
</style>
