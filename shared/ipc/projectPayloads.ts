import type { ProjectRecord } from '../projects/projectRecord'

// 프로젝트 목록 IPC 페이로드.
// channels.ts 가 300줄을 넘어 갈라냈다 — 채널 정의와 함께 자랄 이유가 없다.

export interface ProjectStatePayload {
  /** 최근 목록까지 포함한 전체. 즐겨찾기 먼저, 그 안에서 최근순 */
  all: ProjectRecord[]
  /** 지금 열려 있는 것 */
  open: ProjectRecord[]
  activeId: string | null
}

/** 열기 실패는 화면에 사유를 보여줘야 하므로 결과를 돌려준다 */
export interface ProjectOpenResultPayload {
  ok: boolean
  /** 실패 사유. 5개 상한·폴더 아님 등 */
  message?: string
}

export interface ProjectIdPayload {
  id: string
}

export interface ProjectRenamePayload {
  id: string
  name: string
}

export interface ProjectFavoritePayload {
  id: string
  favorite: boolean
}

export interface ProjectOpenPayload {
  root: string
}
