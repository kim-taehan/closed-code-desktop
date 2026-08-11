import { useCallback, useState } from 'react'
import type { PickedAttachment } from '../../shared/ipc/channels'
import type { AttachmentSummary } from '../../shared/ipc/messageTypes'
import { MAX_IMAGE_COUNT, type ChatImage, type ContextFile } from '../../shared/protocol/chatImage'

// 보내기 전에 붙여 둔 것들.
//
// **이미지와 파일을 나누지 않는다** — 사용자는 "이걸 붙인다" 고만 생각한다.
// 보낼 때만 runtime 계약에 맞춰 갈라 싣는다.
//
// 못 읽은 것도 목록에 남긴다 — 조용히 빼면 "분명 골랐는데 안 붙었다" 가 된다.

export interface AttachmentsApi {
  items: PickedAttachment[]
  /** 한도를 넘겨 붙이지 못했을 때의 사유 */
  error: string | null
  pick: () => void
  /** 드래그드롭한 경로들을 붙인다 (+버튼과 같은 목록·한도로 들어간다) */
  addPaths: (paths: string[]) => void
  remove: (index: number) => void
  clear: () => void
  /** 내용을 실어 보낼 것 */
  images: ChatImage[]
  /** 경로만 보낼 것 */
  files: ContextFile[]
  /** 대화에 남길 요약. 내용은 담지 않는다 */
  summaries: AttachmentSummary[]
}

export function useAttachments(): AttachmentsApi {
  const [items, setItems] = useState<PickedAttachment[]>([])
  const [error, setError] = useState<string | null>(null)

  // 고른/드롭한 것을 목록에 합친다. 이미지 장수만 runtime 이 막는다 (파일은 경로라 제한 없다).
  const merge = useCallback((picked: PickedAttachment[]) => {
    if (picked.length === 0) return
    setItems((current) => {
      const next = [...current, ...picked]
      if (next.filter((item) => item.kind === 'image').length > MAX_IMAGE_COUNT) {
        setError(`이미지는 한 번에 ${MAX_IMAGE_COUNT}장까지 붙일 수 있습니다`)
        return current
      }
      setError(null)
      return next
    })
  }, [])

  const pick = useCallback(() => {
    void window.davis.pickAttachments().then(merge)
  }, [merge])

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      void window.davis.resolveAttachments(paths).then(merge)
    },
    [merge],
  )

  const remove = useCallback((index: number) => {
    setItems((current) => current.filter((_, position) => position !== index))
    setError(null)
  }, [])

  const clear = useCallback(() => {
    setItems([])
    setError(null)
  }, [])

  return {
    items,
    error,
    pick,
    addPaths,
    remove,
    clear,
    images: items
      .filter((item) => item.kind === 'image')
      .map((item) => ({ data: item.data, mediaType: item.mediaType })),
    files: items
      .filter((item) => item.kind === 'file')
      .map((item) => ({ filePath: item.filePath, type: item.type })),
    summaries: items
      .filter((item) => item.kind !== 'error')
      .map((item) =>
        item.kind === 'image'
          ? { name: item.name, kind: 'image' as const, bytes: item.bytes }
          : { name: item.name, kind: 'file' as const },
      ),
  }
}
