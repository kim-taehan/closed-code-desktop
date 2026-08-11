// 파일·디렉토리 IPC 페이로드.
//
// channels.ts 가 300줄 상한에 닿아 갈라냈다 — projectPayloads.ts · searchPayloads.ts 가
// 같은 이유로 먼저 갈라져 나갔다. 다른 타입을 참조하지 않아 순환 참조가 생기지 않는다.

export interface ReadFilePayload {
  projectId: string
  path: string
}

/** 실패 사유를 화면이 그대로 보여준다 — 왜 안 열리는지 알아야 한다 */
export interface ReadFileResultPayload {
  ok: boolean
  text: string
  /** 연 시점의 수정 시각. 저장할 때 그 사이 바뀌었는지 판단하는 근거다. */
  mtimeMs?: number
  reason?: 'not_allowed' | 'unreadable' | 'too_large' | 'binary'
}

export interface WriteFilePayload {
  projectId: string
  path: string
  text: string
  /** 연 시점의 mtime. 지금과 다르면 남이 고친 것이라 거절한다. */
  expectedMtimeMs: number
}

export interface WriteFileResultPayload {
  ok: boolean
  mtimeMs?: number
  reason?: 'not_allowed' | 'unwritable' | 'stale'
}

/** OS 로 열기 — external=기본 앱, reveal=Finder 에서 위치 보기 */
export interface OpenInOsPayload {
  projectId: string
  path: string
  mode: 'external' | 'reveal'
}

export interface OpenInOsResultPayload {
  ok: boolean
  /** 실패 사유(경로 밖·열기 실패). reveal 은 실패를 알리지 않는다. */
  reason?: string
}

export interface ReadDirPayload {
  projectId: string
  /** 프로젝트 루트 기준 상대경로. 비우면 루트. */
  path?: string
}

export interface DirEntryPayload {
  name: string
  path: string
  isDirectory: boolean
}

/** 실패해도 사유만 준다 — 화면이 경로를 추측해 다시 시도하지 않게 */
export interface ReadDirResultPayload {
  ok: boolean
  entries: DirEntryPayload[]
}
