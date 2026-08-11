import verbsKo from './verbs.ko.json'

// 진행 표시 문구 사전과 문구 조립 규칙.
// vscode 원본(webview/lib/davis-progress/progress.ts)의 동작을 그대로 옮긴 것이므로
// 사전 내용도 조립 규칙도 임의로 "개선"하면 두 IDE 의 화면 문구가 어긋난다.

export interface VerbsKoJson {
  suffix?: string
  thinking: string[]
  crafting: string[]
  searching: string[]
  cooking: string[]
  nature: string[]
  playful: string[]
}

export const DEFAULT_VERBS: VerbsKoJson = verbsKo

/** 사전에 suffix 가 없을 때의 값. 원본과 동일하게 말줄임표가 아닌 마침표 3개다. */
export const FALLBACK_SUFFIX = ' 중...'

export function resolveSuffix(verbs: VerbsKoJson): string {
  return verbs.suffix ?? FALLBACK_SUFFIX
}

/**
 * 6개 범주를 하나로 합쳐 돌려준다.
 *
 * 범주는 사전을 사람이 관리하기 쉬우라고 나눠둔 것일 뿐 선택에는 쓰이지 않는다.
 * 즉 "범주를 고르고 그 안에서 고르기"가 아니라 전체에서 균등 추첨이다 —
 * 범주별 개수가 다르므로(30/25/15/10/10/10) 두 방식의 확률 분포가 서로 다르고,
 * 원본이 후자이므로 여기서도 후자를 유지한다.
 */
export function getAllVerbs(verbs: VerbsKoJson): string[] {
  const all: string[] = []
  // suffix·version·locale 같은 비배열 필드는 건너뛴다. 사전에 새 범주가 추가되면
  // 코드 수정 없이 자동으로 추첨 대상에 들어간다.
  Object.entries(verbs).forEach(([key, list]) => {
    if (key !== 'suffix' && Array.isArray(list)) {
      all.push(...list)
    }
  })
  return all
}

export function pickRandomVerb(verbs: VerbsKoJson): string {
  const all = getAllVerbs(verbs)
  return all[Math.floor(Math.random() * all.length)] ?? ''
}

/** "… 중…" / "… 중..." 꼬리. 접미사 중복을 막기 위한 것으로 원본 정규식 그대로다. */
const PROGRESS_TAIL_RE = /\s*중\s*(?:\.{2,3}|…)?\s*$/

/**
 * 접미사를 붙이되, 이미 진행형 꼬리로 끝나면 그대로 둔다.
 * 힌트 문구("파일 읽는 중…")를 런타임이 이미 완성해서 보내는 경우가 있어
 * 무조건 붙이면 "중… 중…" 이 된다.
 */
export function applySuffix(text: string, suffix: string): string {
  if (PROGRESS_TAIL_RE.test(text)) {
    return text
  }
  return text + suffix
}
