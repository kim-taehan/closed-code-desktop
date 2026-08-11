// 대화에 붙이는 이미지.
//
// **계약은 runtime 이 정한다** (davis-code-runtime websocket/domains/chat.py ImageData):
//   - chat_request.data.images: [{ data: base64, mediaType: 'image/...' }]
//   - mediaType 은 camelCase 별칭이다 (파이썬 필드명은 media_type)
//   - 최대 5장, base64 문자열 기준 각 10MB
//
// 한도를 넘기면 runtime 이 프레임 전체를 거절한다 — 보내기 전에 우리가 먼저 막는다.
// 안 그러면 "왜 안 보내지는지" 를 알 수 없는 실패가 된다.

/**
 * 대화에 붙이는 파일. **내용이 아니라 경로만** 보낸다 —
 * 에이전트가 read_file 로 직접 읽는다 (chat_request.data.contextFiles).
 * 그래서 runtime 이 접근할 수 있는 곳, 즉 워크스페이스 안이어야 한다.
 */
export interface ContextFile {
  filePath: string
  type: 'file' | 'dir'
}

export interface ChatImage {
  /** base64 인코딩된 원본 (data: URL 접두어 없이) */
  data: string
  mediaType: AllowedImageType
}

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export const MAX_IMAGE_COUNT = 5
/** base64 문자열 기준. 원본은 대략 3/4 크기다. */
export const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)
}

/** 확장자 → MIME. runtime 이 허용하지 않는 것은 null 이다. */
export function imageTypeOf(path: string): AllowedImageType | null {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return null
}

export type ImageRejection =
  | { ok: true }
  | { ok: false; reason: 'too_many' | 'too_large'; message: string }

/** 보내기 전에 한도를 확인한다. runtime 이 거절하면 이유를 알 수 없다. */
export function checkImages(images: readonly ChatImage[]): ImageRejection {
  if (images.length > MAX_IMAGE_COUNT) {
    return {
      ok: false,
      reason: 'too_many',
      message: `이미지는 한 번에 ${MAX_IMAGE_COUNT}장까지 붙일 수 있습니다`,
    }
  }
  for (const image of images) {
    if (image.data.length > MAX_IMAGE_BASE64_BYTES) {
      return { ok: false, reason: 'too_large', message: '이미지가 너무 큽니다 (약 7MB 이하)' }
    }
  }
  return { ok: true }
}
