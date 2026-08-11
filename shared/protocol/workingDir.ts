// 현재 세션 작업 경로 (ADR-036 / DC-1146).
//
// runtime app/websocket/domains/workspace.py 의 WorkingDirStateMessage 를 미러한다.
// set_working_directory 로 작업 경로가 워크스페이스 밖으로 나가면 runtime 이 push 한다.
// worktree 상태는 별도 worktree_state 가 담당하므로 여기에는 directory/external 만 온다.

export interface WorkingDirPayload {
  /** 워크스페이스 기본과 다른 작업경로 override 가 걸려 있는지. */
  active: boolean
  /** 'directory' | 'external'. active 일 때만 의미가 있다. */
  kind?: string
  /** 현재 작업 경로 절대경로. active 일 때만 온다. */
  path?: string
  /** 합성 프로젝트명. external 은 'external:{basename}'. */
  projectName?: string
}

/** override 가 없는 상태 — 워크스페이스 기본 경로에서 돌고 있다. */
export const WORKING_DIR_INACTIVE: WorkingDirPayload = { active: false }
