import type { ApiErrorResponse } from '@agent/contracts'
import type { Ref } from 'vue'
import type { ComposerAttachment } from '../types/chat'

import { ATTACHMENT_MAX_COUNT } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { watch } from 'vue'

import { useI18n } from 'vue-i18n'
import { deleteAttachment, uploadAttachment } from '../api/attachments'
import {
  attachmentKind,
  attachmentMaxBytes,
  formatFileSize,
  validateAttachments,
} from '../utils/attachments'

/**
 * 输入框里待发送附件的添加、上传、重试与移除。
 * 列表本身归 useChatWorkspace（和输入文字一起随发送、切会话清空），这里只负责往里改。
 */
export function useComposerAttachments(attachments: Ref<ComposerAttachment[]>, notifyError: (text: string) => void) {
  const { t } = useI18n()
  // 原文件留着给重试用；上传中的请求按附件 id 记着，附件离开列表时取消。
  const files = new Map<string, File>()
  const uploads = new Map<string, AbortController>()
  let nextId = 0

  function patch(id: string, changes: Partial<ComposerAttachment>) {
    attachments.value = attachments.value.map(item => item.id === id ? { ...item, ...changes } : item)
  }

  async function upload(id: string) {
    const file = files.get(id)
    if (!file || uploads.has(id))
      return

    const controller = new AbortController()
    uploads.set(id, controller)
    patch(id, { status: 'uploading', progress: 0 })

    try {
      const uploaded = await uploadAttachment(file, { signal: controller.signal, onProgress: progress => patch(id, { progress }) })
      // 传完的那一刻附件已经被移除：服务端那份也删掉。
      if (controller.signal.aborted)
        deleteAttachment(uploaded.id)
      else
        patch(id, { status: 'ready', progress: 1, remoteId: uploaded.id })
    }
    catch (error) {
      if (controller.signal.aborted)
        return
      patch(id, { status: 'error' })
      // 服务端拒绝时带着原因（类型不对、读不出来、太大），直接告诉用户。
      const reason = isAxiosError<ApiErrorResponse>(error) ? error.response?.data?.message : undefined
      if (reason)
        notifyError(`${file.name}：${reason}`)
    }
    finally {
      uploads.delete(id)
    }
  }

  async function add(picked: File[]) {
    const { accepted, rejected } = validateAttachments(attachments.value, picked)
    const [firstRejected] = rejected

    if (firstRejected) {
      notifyError(t(`composer.attachments.errors.${firstRejected.reason}`, {
        name: firstRejected.name,
        limit: formatFileSize(attachmentMaxBytes(firstRejected.name)),
        count: ATTACHMENT_MAX_COUNT,
      }))
    }

    // 同步占住数量与文件身份；尺寸回填前不能发送，所以消息仍从第一帧按真实比例占位。
    const prepared = accepted.map((index) => {
      const file = picked[index]!
      const kind = attachmentKind(file.name)!
      const id = `attachment-${Date.now()}-${nextId++}`
      files.set(id, file)
      attachments.value = [...attachments.value, {
        id,
        kind,
        name: file.name,
        bytes: file.size,
        url: URL.createObjectURL(file),
        status: 'uploading',
        progress: 0,
      }]
      return { id, file, kind }
    })
    await Promise.all(prepared.map(async ({ id, file, kind }) => {
      const size = kind === 'image' ? await imageSize(file) : {}
      // 切会话/移除已同步放掉文件：迟到的尺寸和上传不能进入新视图。
      if (files.get(id) !== file)
        return
      patch(id, size)
      void upload(id)
    }))
  }

  /** 已提交的地址由消息继续持有；待发送附件在手动移除或切视图时统一回收。 */
  function remove(id: string) {
    const target = attachments.value.find(item => item.id === id)
    if (!target || target.locked)
      return

    attachments.value = attachments.value.filter(item => item.id !== id)
  }

  // 移除、发送、切会话都会让附件离开列表：取消还在传的，放掉原文件。
  watch(attachments, (list, previous) => {
    const alive = new Set(list.map(item => item.id))
    for (const item of previous) {
      if (alive.has(item.id) || item.locked)
        continue
      URL.revokeObjectURL(item.url)
      if (item.remoteId)
        deleteAttachment(item.remoteId)
    }

    for (const id of files.keys()) {
      if (alive.has(id))
        continue
      uploads.get(id)?.abort()
      files.delete(id)
    }
  }, { flush: 'sync' })

  return { add, remove, retry: upload }
}

async function imageSize(file: File): Promise<{ width?: number, height?: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  }
  catch {
    return {}
  }
}
