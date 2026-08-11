// 도구 칩 라벨 (설계 §6.6). vscode buildToolDesc.ts:13-91 과 문자열이 같아야 한다.

const CHIP_CMD_MAX = 50
const GENERIC_MAX = 80

/** 인자에서 값을 뽑는 정규식. vscode 와 같은 패턴을 쓴다. */
const FILE_PATH = /file_path["\s:]*"?([^"}\n,]+)/i
const PATTERN = /pattern["\s:]*"?([^"}\n,]+)/i
const COMMAND = /command["\s:]*"?([^"}\n]+)/i

function argsToString(args: unknown): string {
  if (args === undefined || args === null) return ''
  return typeof args === 'string' ? args : JSON.stringify(args)
}

/** 도구 인자에서 설명 문자열을 만든다 */
export function buildToolDesc(toolName: string, args: unknown): string {
  const name = toolName.toLowerCase()
  const text = argsToString(args)

  if (name === 'read' || name === 'read_file') return FILE_PATH.exec(text)?.[1]?.trim() ?? ''
  if (name === 'edit' || name === 'edit_file' || name === 'create_file') {
    return FILE_PATH.exec(text)?.[1]?.trim() ?? ''
  }
  if (name === 'glob' || name === 'glob_search' || name === 'grep' || name === 'grep_search') {
    const matched = PATTERN.exec(text)?.[1]?.trim()
    return matched ? `pattern: "${matched}"` : ''
  }
  if (name === 'bash' || name === 'run_command') return ''

  // 기본: 80자 넘으면 77자 + 마침표 셋 (칩과 달리 ASCII 점 세 개다)
  return text.length > GENERIC_MAX ? `${text.substring(0, 77)}...` : text
}

/** 도구 행에 붙는 칩 라벨 */
export function buildToolChipLabel(toolName: string, args: unknown): string {
  const name = toolName.toLowerCase()
  const desc = buildToolDesc(toolName, args)

  if (name === 'bash' || name === 'run_command') {
    const command = COMMAND.exec(argsToString(args))?.[1]?.trim() ?? ''
    if (!command) return ''
    // 칩은 50자 상한, 넘으면 47자 + 말줄임표 한 글자(U+2026)
    const short = command.length > CHIP_CMD_MAX ? `${command.slice(0, 47)}…` : command
    return `실행 "${short}"`
  }

  if (name === 'read' || name === 'read_file') return `읽기 ${desc}`
  if (name === 'edit' || name === 'edit_file' || name === 'create_file') return `수정 ${desc}`
  return desc
}

/**
 * IN 행에 보여줄 내용.
 * **bash / run_command 에만 있다** — 다른 도구는 IN 행 자체가 없다 (설계 §6.6).
 */
export function buildToolInContent(toolName: string, args: unknown): string | null {
  const name = toolName.toLowerCase()
  if (name !== 'bash' && name !== 'run_command') return null

  const text = argsToString(args)
  const command = COMMAND.exec(text)?.[1]?.trim()
  return command ?? text
}
