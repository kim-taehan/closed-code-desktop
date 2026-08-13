// 빠른 열기·검색 페이로드.
// channels.ts 가 300줄을 넘어 갈라냈다.

/** opencode 가 주는 `/` 항목 하나 (명령·MCP 프롬프트·스킬이 한 목록이다) */
export interface CommandSummaryPayload {
  name: string
  description: string
  source: 'command' | 'mcp' | 'skill'
  /** 실행할 프롬프트 원본. `$ARGUMENTS` 에 인자가 들어간다. */
  template: string
  agent?: string
  model?: string
  subtask?: boolean
}

export interface CommandListPayload {
  ok: boolean
  commands: CommandSummaryPayload[]
  error?: string
}

/** opencode 설정 파일 한 개. `content` 가 null 이면 아직 없는 파일이다 (오류가 아니다). */
export interface OpencodeConfigFilePayload {
  scope: 'global' | 'project'
  path: string
  content: string | null
  error?: string
}

export interface OpencodeConfigPayload {
  /** 전역 · (열린 프로젝트가 있으면) 프로젝트 순 */
  files: OpencodeConfigFilePayload[]
  /** 서버가 합쳐서 지금 실제로 쓰는 설정 */
  effective?: unknown
  effectiveError?: string
  /** 지금 붙어 있는 MCP 서버와 상태. 설정에 적힌 것과 다를 수 있다. */
  mcp?: Record<string, { status?: string; error?: string }>
}

export interface OpencodeConfigWritePayload {
  ok: boolean
  error?: string
  backupPath?: string
  /** 서버가 이미 읽은 설정은 안 바뀐다 — 다시 띄워야 반영된다 */
  needsReload: boolean
}

export interface SearchPayload {
  query: string
}

export interface SearchMatchPayload {
  file: string
  line: number
  preview: string
}

/** 상한에 걸려 잘렸는지 함께 준다 — 없는 줄 알면 다시 찾지 않는다 */
export interface SearchResultPayload {
  matches: SearchMatchPayload[]
  truncated: boolean
}

export interface FileListPayload {
  files: string[]
  /** 디렉토리 경로 — `@` 자동완성에서 폴더도 고를 수 있게 함께 준다 */
  dirs: string[]
  truncated: boolean
}


/** 확장이 채팅으로 물은 것. 렌더러가 이걸 받아 사용자 입력과 같은 큐에 넣는다. */
export interface ExtensionChatAskPayload {
  requestId: string
  query: string
}
