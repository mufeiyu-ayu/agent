<script setup lang="ts">
import type { SkillSummary } from '@agent/contracts'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useSkills } from '@/hooks/useSkills'

const props = defineProps<{ skill: SkillSummary | null }>()
const emit = defineEmits<{ closeAutoFocus: [event: Event] }>()
const open = defineModel<boolean>('open', { required: true })
const { t, locale } = useI18n()
const skills = useSkills()
const skill = computed(() => skills.items.value.find(item => item.id === props.skill?.id) ?? props.skill)
const deleting = ref(false)
watch(open, () => {
  deleting.value = false
})

function openSurface(surface: 'edit' | 'preview') {
  if (!skill.value || skills.busy.value || !open.value || (surface === 'edit' && skill.value.builtin))
    return
  open.value = false
  if (surface === 'edit')
    void skills.openEditor(skill.value)
  else
    void skills.showPreview(skill.value)
}

function useInChat(prompt = '') {
  if (!skill.value?.enabled || skills.busy.value)
    return
  open.value = false
  void skills.start(skill.value.id, prompt)
}

async function confirmDelete() {
  if (!skill.value || skill.value.builtin || skills.busy.value)
    return
  if (await skills.remove(skill.value))
    open.value = false
}

function formatDate(value: string | undefined): string {
  if (!value || Number.isNaN(Date.parse(value)))
    return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value))
}

const metadata = computed(() => [
  { key: 'created', icon: 'tabler:clock', value: formatDate(skill.value?.createdAt) },
  { key: 'updated', icon: 'tabler:history', value: formatDate(skill.value?.updatedAt) },
  { key: 'usedIn', icon: 'tabler:circles-relation', value: new Intl.NumberFormat(locale.value).format(skill.value?.usageCount ?? 0) },
])
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      data-skill-details-drawer
      side="right"
      :show-close-button="false"
      class="gap-0 overflow-hidden rounded-2xl border border-agent-border-subtle bg-agent-surface-raised data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto data-[side=right]:w-[min(520px,calc(100vw-24px))] data-[side=right]:sm:max-w-none motion-reduce:animate-none"
      @close-auto-focus="emit('closeAutoFocus', $event)"
    >
      <template v-if="skill">
        <div class="relative flex h-48 shrink-0 items-end overflow-hidden bg-agent-surface p-7 sm:px-8">
          <svg class="pointer-events-none absolute inset-0 h-full w-full text-agent-surface-sunken" viewBox="0 0 520 192" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path d="M240 192C290 92 365 105 520 45V192Z" fill="currentColor" opacity=".35" />
            <path d="M306 192C345 112 433 107 520 165V192Z" fill="currentColor" opacity=".4" />
          </svg>
          <div class="relative flex h-24 w-24 items-center justify-center rounded-full bg-agent-surface-sunken/40 text-agent-ink">
            <AppIcon name="tabler:file-text" :size="44" />
          </div>
          <div class="absolute right-5 top-5 flex items-center gap-3">
            <DropdownMenuRoot v-if="!skill.builtin || skill.enabled">
              <DropdownMenuTrigger :disabled="skills.busy.value" :aria-label="t('skills.moreActions')" class="flex h-8 w-8 items-center justify-center rounded-lg text-agent-ink-muted hover:bg-agent-surface-sunken/50 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50">
                <AppIcon name="tabler:dots" :size="21" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent align="end" :side-offset="6" class="min-w-36" :class="dropdownMenuPanelClass">
                  <DropdownMenuItem v-if="skill.enabled" :disabled="skills.busy.value" class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[disabled]:opacity-50" :class="dropdownMenuOptionClass(false)" @select="useInChat()">
                    <AppIcon name="tabler:message-2" :size="16" />{{ t('skills.useInChat') }}
                  </DropdownMenuItem>
                  <template v-if="!skill.builtin">
                    <DropdownMenuSeparator class="mx-1 my-1 h-px bg-agent-border-subtle" />
                    <DropdownMenuItem :disabled="skills.busy.value" class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-red-500/10 dark:text-red-400" @select="deleting = true">
                      <AppIcon name="tabler:trash" :size="16" />{{ t('skills.delete') }}
                    </DropdownMenuItem>
                  </template>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
            <SheetClose :aria-label="t('skills.drawer.close')" class="flex h-8 w-8 items-center justify-center rounded-lg text-agent-ink-muted hover:bg-agent-surface-sunken/50 focus-visible:outline-2 focus-visible:outline-agent-focus">
              <AppIcon name="tabler:x" :size="21" />
            </SheetClose>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-7 sm:px-8">
          <SheetTitle class="skill-detail-heading text-[28px] font-normal leading-snug text-agent-ink [overflow-wrap:anywhere]">
            {{ skill.name }}
          </SheetTitle>
          <SheetDescription class="mt-2 text-base leading-6 text-agent-ink-muted">
            {{ skill.description || t('skills.noDescription') }}
          </SheetDescription>
          <span class="mt-4 inline-block rounded-full bg-agent-surface-sunken/40 px-3 py-1 text-xs text-agent-ink-muted">
            {{ skill.builtin ? t('skills.builtin') : t('skills.personal') }}{{ !skill.enabled ? t('skills.disabledSuffix') : '' }}
          </span>

          <div class="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            <button :disabled="skills.busy.value || skill.builtin" class="h-11 rounded-full bg-agent-ink px-3 text-sm font-medium text-agent-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus disabled:opacity-50" @click="openSurface('edit')">
              {{ t('skills.edit') }}
            </button>
            <button :disabled="skills.busy.value" class="h-11 rounded-full border border-agent-border-subtle px-3 text-sm font-medium text-agent-ink-soft hover:bg-agent-surface focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50" @click="openSurface('preview')">
              {{ t('skills.preview') }}
            </button>
            <button disabled class="h-11 rounded-full border border-agent-border-subtle px-3 text-sm font-medium text-agent-ink-soft">
              {{ t('skills.drawer.share') }}
            </button>
          </div>

          <div v-if="skills.error.value" role="alert" class="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {{ skills.error.value }}
          </div>
          <div v-if="deleting" class="mt-4 rounded-xl border border-agent-border-subtle p-4">
            <p class="text-sm text-agent-ink">
              {{ t('skills.drawer.deletePrompt', { name: skill.name }) }}
            </p>
            <div class="mt-3 flex gap-3">
              <button :disabled="skills.busy.value" class="rounded-lg px-3 py-2 text-sm text-red-600 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50 dark:text-red-400" @click="confirmDelete">
                {{ skills.busy.value ? t('skills.deleting') : t('skills.confirmDelete') }}
              </button>
              <button :disabled="skills.busy.value" class="rounded-lg px-3 py-2 text-sm text-agent-ink-muted focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50" @click="deleting = false">
                {{ t('skills.cancel') }}
              </button>
            </div>
          </div>

          <dl class="mt-8 space-y-4">
            <div v-for="row in metadata" :key="row.key" class="flex items-center justify-between gap-4 text-sm text-agent-ink-muted">
              <dt class="flex items-center gap-4">
                <AppIcon :name="row.icon" :size="20" class="text-agent-ink-soft" />
                {{ t(`skills.drawer.${row.key}`) }}
              </dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>

          <div class="my-7 h-px bg-agent-border-subtle" />
          <h3 class="text-sm font-semibold text-agent-ink">
            {{ t('skills.drawer.whatItDoes') }}
          </h3>
          <p class="mt-2 text-sm leading-6 text-agent-ink-muted [overflow-wrap:anywhere]">
            {{ skill.description || t('skills.noDescription') }}
          </p>

          <h3 class="mb-3 mt-6 text-sm font-semibold text-agent-ink">
            {{ t('skills.drawer.examples') }}
          </h3>
          <div v-if="skill.examples?.length" class="space-y-2" data-skill-examples>
            <button
              v-for="(example, index) in skill.examples"
              :key="example"
              :disabled="skills.busy.value || !skill.enabled"
              :aria-label="t('skills.drawer.useExample', { number: index + 1 })"
              class="flex w-full items-center gap-3 rounded-xl border border-agent-border-subtle bg-agent-surface/50 px-4 py-3 text-left text-[13px] leading-5 text-agent-ink-soft transition-colors hover:border-agent-border hover:bg-agent-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent-focus disabled:cursor-not-allowed disabled:opacity-50"
              @click="useInChat(example)"
            >
              <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ example }}</span>
              <AppIcon name="tabler:arrow-up-right" :size="15" class="shrink-0 text-agent-ink-muted" />
            </button>
          </div>
          <p v-else class="text-sm leading-6 text-agent-ink-muted">
            {{ t('skills.drawer.noExamples') }}
          </p>
        </div>
      </template>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
.skill-detail-heading {
  font-family: "Libre Baskerville", Georgia, "Songti SC", "Noto Serif SC", ui-serif, serif;
}
</style>
