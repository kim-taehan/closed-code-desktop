// 도구 아이콘 (설계 §6.6). 이름으로 5분기하고, 해당 없으면 상태 점을 쓴다.

export type ToolIconKind = 'read' | 'edit' | 'search' | 'run'
export type ToolStatus = 'running' | 'success' | 'error'

/**
 * 도구 이름 → 아이콘 종류.
 * `_search` 로 끝나는 이름은 전부 search 로 본다 — 새 검색 도구가 추가돼도 아이콘이 붙는다.
 */
export function getToolIconKind(toolName: string): ToolIconKind | null {
  const name = toolName.toLowerCase()

  if (name === 'read' || name === 'read_file') return 'read'
  if (name === 'edit' || name === 'edit_file' || name === 'create_file' || name === 'write') return 'edit'
  if (name === 'grep' || name === 'glob' || name === 'grep_search' || name === 'glob_search') return 'search'
  if (name.endsWith('_search')) return 'search'
  if (name === 'bash' || name === 'run_command') return 'run'
  return null
}

const PATHS: Record<ToolIconKind, string> = {
  read: 'M3 2h7l3 3v9H3z M10 2v3h3',
  edit: 'M11 2l3 3-7 7-3 1 1-3z M3 14h10',
  search: 'M7 12A5 5 0 107 2a5 5 0 000 10z M11 11l3 3',
  run: 'M4 3l6 5-6 5z',
}

export interface ToolIconProps {
  toolName: string
  status: ToolStatus
}

export function ToolIcon({ toolName, status }: ToolIconProps) {
  const kind = getToolIconKind(toolName)

  // 아이콘이 없는 도구는 상태 점으로 표시한다
  if (!kind) return <span className={`taz-dot taz-dot-${status}`} />

  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`taz-tool-icon taz-tool-icon--${status}`}
      aria-hidden="true"
    >
      <path d={PATHS[kind]} />
    </svg>
  )
}

/** 결과 유무와 에러 여부로 상태를 정한다 */
export function toolStatusOf(result: { error?: string } | undefined): ToolStatus {
  if (!result) return 'running'
  return result.error ? 'error' : 'success'
}
