// 빠른 열기·검색 페이로드.
// channels.ts 가 300줄을 넘어 갈라냈다.

export interface SkillSummaryPayload {
  name: string
  description: string
  context: string
  /** runtime 에 박혀 있는 스킬. 어느 프로젝트에서나 쓸 수 있다. */
  builtin?: boolean
}

export interface SkillListPayload {
  ok: boolean
  skills: SkillSummaryPayload[]
  error?: string
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

