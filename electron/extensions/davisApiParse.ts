import { METHOD_EXPORT_SAVE, METHOD_UI_ASK_TEXT } from './davisApi'

// 부모가 돌려준 값의 **모양 확인**. `davisApi.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에
// 닿았고, 두고 보니 자리도 여기가 맞다: 저쪽은 **무엇을 부를 수 있나**(계약)이고
// 이쪽은 **돌아온 것을 믿어도 되나**다.
//
// 부모가 우리 코드라도 확인한다 — 여기서 거짓말을 하면 확장 **안**의 엉뚱한 자리에서
// 터지고, 확장 개발자는 자기 코드를 들여다보게 된다.
//
// 관통하는 규칙 하나: **`null` 을 눙치지 않는다.** 취소·없음은 사실이라 빈 값으로 바꾸면
// 확장이 그것을 "사람이 다 지웠다"·"못 찾았다" 로 읽고 저장된 것을 날린다.

/**
 * 저장 결과. **`null` 을 문자열로 눙치지 않는다** — 취소와 "빈 경로에 저장됨" 이 같은 값이 되면
 * 확장이 사용자에게 거짓말을 하게 된다.
 */
/**
 * 물음의 답. **`null`(취소)을 빈 문자열로 눙치지 않는다** — 확장이 그것을
 * "사람이 다 지웠다" 로 읽고 저장된 것을 날린다.
 */
export function asTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${METHOD_UI_ASK_TEXT} 응답이 문자열이 아닙니다`)
  return value
}

export function asPathOrNull(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new Error(`${METHOD_EXPORT_SAVE} 응답이 경로나 null 이 아닙니다`)
}

export function asString(value: unknown, method: string): string {
  if (typeof value !== 'string') throw new Error(`${method} 응답이 문자열이 아닙니다`)
  return value
}

export function asStrings(value: unknown, method: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${method} 응답이 문자열 배열이 아닙니다`)
  }
  return value as string[]
}

/** 지금 보고 있는 것. 커서 줄은 **1-based** 다 (`src/state/editorContext.ts` 와 같은 규약). */
export interface ActiveFile {
  /** 프로젝트 루트 상대 경로. */
  path: string
  line?: number
}

/**
 * 모양이 아니면 `null`. **빈 객체를 만들지 않는다** — 「경로 없는 파일」은
 * 「아무것도 안 보고 있다」와 구분되지 않는다.
 */
export function asActiveFile(value: unknown): ActiveFile | null {
  if (value === null || value === undefined) return null
  const record = value as Record<string, unknown>
  const path = record['path']
  if (typeof path !== 'string' || path.trim() === '') return null
  const line = record['line']
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? { path, line } : { path }
}
