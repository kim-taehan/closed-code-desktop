import type { AllowedImageType } from '../protocol/chatImage'

// 첨부 선택 결과.
//
// **이미지와 파일을 나누지 않는다** — 사용자는 "이걸 붙인다" 고만 생각한다.
// 나누는 것은 runtime 사정이라 main 이 판별해 알맞은 쪽으로 보낸다.

export type PickedAttachment =
  | { kind: 'image'; name: string; bytes: number; data: string; mediaType: AllowedImageType }
  | { kind: 'file'; name: string; filePath: string; type: 'file' | 'dir' }
  | { kind: 'error'; name: string; error: string }
