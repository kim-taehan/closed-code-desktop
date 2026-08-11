import type { ToolResult } from '../../shared/ipc/messageTypes'

// 도구 결과를 IN/OUT/ERR 행으로 나누고 잘라낸다 (설계 §6.6).
// 상수는 vscode 실측값 그대로다 — 바꾸면 화면이 달라진다.

export const MAX_RENDER_CHARS = 20_000
export const COLLAPSE_CHARS = 1_000
export const COLLAPSE_LINES = 20

export interface ResultRow {
  label: 'OUT' | 'ERR'
  content: string
  isError?: boolean
}

/** null/undefined 는 빈 문자열, 문자열은 그대로, 나머지는 보기 좋게 직렬화 */
export function stringifyResult(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

/**
 * 결과 행 구성 (우선순위대로):
 *  1. 에러면 ERR 한 줄
 *  2. stdout/stderr 가 있으면 OUT → ERR 순서
 *  3. 그 외에는 OUT 한 줄
 */
export function buildToolResultRows(result: ToolResult | undefined): ResultRow[] {
  if (!result) return []

  if (result.error) {
    return [{ label: 'ERR', content: result.error || '실행에 실패했습니다.', isError: true }]
  }

  const streams = readStreams(result.raw)
  if (streams) {
    const rows: ResultRow[] = []
    if (streams.stdout) rows.push({ label: 'OUT', content: streams.stdout })
    if (streams.stderr) rows.push({ label: 'ERR', content: streams.stderr, isError: true })
    if (rows.length > 0) return rows
  }

  const content = result.message ?? stringifyResult(result.raw)
  return [{ label: 'OUT', content: content || '완료' }]
}

function readStreams(raw: unknown): { stdout?: string; stderr?: string } | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const stdout = typeof record['stdout'] === 'string' ? record['stdout'] : undefined
  const stderr = typeof record['stderr'] === 'string' ? record['stderr'] : undefined
  if (stdout === undefined && stderr === undefined) return null
  return { ...(stdout !== undefined ? { stdout } : {}), ...(stderr !== undefined ? { stderr } : {}) }
}

/** 너무 긴 결과는 잘라내고 잘렸다고 알린다 */
export function clampForRender(content: string): string {
  if (content.length <= MAX_RENDER_CHARS) return content
  return `${content.slice(0, MAX_RENDER_CHARS)}\n\n… 결과가 너무 길어 ${MAX_RENDER_CHARS.toLocaleString()}자까지만 표시합니다.`
}

/** 접었다 펼 수 있는 길이인가 */
export function isExpandable(content: string): boolean {
  return content.length > COLLAPSE_CHARS || content.split('\n').length > COLLAPSE_LINES
}

/** 경로 구분자를 정리한다 (윈도우 역슬래시, 중복 슬래시) */
export function normalizeFilePaths(text: string): string {
  return text.replace(/\\/g, '/').replace(/([^:])\/\/+/g, '$1/')
}

/** 렌더 직전 처리: 잘라내고 경로를 정리한다. 순서가 중요하다. */
export function prepareForRender(content: string): string {
  return normalizeFilePaths(clampForRender(content))
}
