<script setup lang="ts">
import SkillsList from '@/components/skills/SkillsList.vue'
import { useSkills } from '@/hooks/useSkills'

const skills = useSkills()
</script>

<template>
  <section class="skills-page relative min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-16 pt-20 sm:px-12 min-[960px]:pt-12">
    <div class="mx-auto max-w-[1000px]">
      <SkillsList @manual-create="skills.createManual()" />
    </div>
  </section>
</template>
