// `@경로` 파일 참조.
//
// 규칙은 runtime 의 input_expander 와 같다: `(?<![\w/])@(\S+)` —
// 낱말이나 경로 가운데의 @ 는 참조가 아니다 (이메일·데코레이터를 잡으면 안 된다).
//
// **내용을 붙이지 않는다.** 경로만 contextFiles 로 보내면 에이전트가 직접 읽는다.
// 그래서 프로젝트 안의 경로여야 한다.

const MENTION = /(?<![\w/])@(\S+)/g

/** 문장에서 참조된 경로들. 중복은 하나로 친다. */
export function parseMentions(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(MENTION)) {
    const path = match[1]?.replace(/[.,)\]}]+$/, '') // 문장 부호가 붙어 오는 일이 흔하다
    if (path) found.add(path)
  }
  return [...found]
}

/**
 * 지금 커서 자리에서 이어 치고 있는 참조.
 *
 * 자동완성을 띄울지 정한다. 커서가 `@` 로 시작하는 토막 **끝**에 있을 때만이다 —
 * 이미 지나간 참조까지 잡으면 엉뚱한 자리에 목록이 뜬다.
 */
export function mentionAtCaret(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const match = before.match(/(?<![\w/])@(\S*)$/)
  return match ? (match[1] ?? '') : null
}

/** 커서 앞의 `@토막` 을 고른 경로로 바꾼다. 뒤에 공백을 붙여 다음 낱말과 붙지 않게 한다. */
export function replaceMention(text: string, caret: number, path: string): {
  text: string
  caret: number
} {
  const before = text.slice(0, caret)
  const start = before.search(/(?<![\w/])@\S*$/)
  if (start === -1) return { text, caret }

  const head = `${text.slice(0, start)}@${path} `
  return { text: head + text.slice(caret), caret: head.length }
}
