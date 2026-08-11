import type { ReadFileResultPayload } from '../../shared/ipc/channels'
import type { OpenFile } from './useOpenFiles'

// 파일을 못 열거나 못 쓴 사유를 사람 말로. main 이 주는 것은 기계용 코드(`not_allowed` 등)라
// 그대로 띄우면 무슨 일인지 알 수 없다. 모르는 코드면 부르는 쪽이 기본 문구로 받는다.

export const REASON_TEXT: Record<string, string> = {
  not_allowed: '이 파일은 열 수 없습니다',
  unreadable: '읽지 못했습니다',
  too_large: '너무 커서 열 수 없습니다 (512KB 초과)',
  binary: '텍스트 파일이 아닙니다',
}

export const WRITE_REASON: Record<string, string> = {
  not_allowed: '이 파일은 저장할 수 없습니다',
  unwritable: '저장하지 못했습니다',
  stale: '파일이 그 사이 바뀌었습니다 — 다시 열어 확인하세요',
}

/** 읽기 결과를 탭 하나로. 실패면 내용 대신 사유가 실린다. */
export function toFile(
  path: string,
  result: ReadFileResultPayload,
  revealLine?: number,
): OpenFile {
  if (result.ok) return { path, text: result.text, mtimeMs: result.mtimeMs, revealLine }
  return { path, text: '', error: REASON_TEXT[result.reason ?? ''] ?? '열지 못했습니다' }
}
