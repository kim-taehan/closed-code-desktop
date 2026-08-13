// 입력창이 지금 무엇을 받고 있는지.
//
// 첫 글자로 정한다 (desktop2·CLI REPL 과 같은 규칙):
//   !  셸 — LLM 을 거치지 않고 프로젝트 폴더에서 바로 실행한다
//   @  파일 참조
//   /  명령·스킬
//
// 색으로 알려주는 이유는 **되돌릴 수 없는 것과 아닌 것이 갈리기 때문**이다.
// `!rm -rf` 를 평범한 질문으로 착각해 보내면 늦다.

export type ComposerMode = 'shell' | 'file' | 'skill' | null

export function detectComposerMode(text: string): ComposerMode {
  switch (text.replace(/^\s+/, '').charAt(0)) {
    case '!':
      return 'shell'
    case '@':
      return 'file'
    case '/':
      return 'skill'
    default:
      return null
  }
}

export const MODE_HINT: Record<Exclude<ComposerMode, null>, string> = {
  shell: '셸 — 프로젝트 폴더에서 바로 실행합니다',
  file: '파일 참조',
  skill: '명령·스킬',
}

/**
 * 커서 자리에서 이어 치고 있는 `/` 이름.
 *
 * `@` 와 달리 **줄 맨 앞에서만** 본다 — 경로나 날짜의 `/` 를 명령으로 잡으면 안 된다.
 * 공백을 만나면 닫힌다: 거기서부터는 그 명령의 인자 구간이다.
 */
export function skillAtCaret(text: string, caret: number): string | null {
  const match = text.slice(0, caret).match(/^\s*\/(\S*)$/)
  return match ? (match[1] ?? '') : null
}

/**
 * 커서 자리에서 `/open ` 뒤에 이어 치고 있는 파일 이름 토막.
 *
 * skillAtCaret 은 공백을 만나면 닫힌다 — `/open` 의 인자 구간에서는 스킬 팝업 대신
 * 파일 리스트를 띄워야 하므로 이 구간만 따로 본다. null 이면 인자 구간이 아니다.
 */
export function openArgAtCaret(text: string, caret: number): string | null {
  const match = text.slice(0, caret).match(/^\s*\/open\s+(\S*)$/)
  return match ? (match[1] ?? '') : null
}

/**
 * 커서 앞의 `/` 맥락 전체를 넣을 텍스트로 통째 바꾼다.
 *
 * `/` 맥락은 줄 앞에 붙어 있으므로 거기서부터 커서까지를 갈아끼운다.
 */
export function replaceSlashContext(
  text: string,
  caret: number,
  insert: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret)
  const match = before.match(/^(\s*)\//)
  if (!match) return { text, caret }

  const head = text.slice(0, match[1]!.length) + insert
  return { text: head + text.slice(caret), caret: head.length }
}

/** `!` 를 뗀 실제 명령. 앞뒤 공백도 정리한다. */
export function shellCommandOf(text: string): string {
  return text.trim().replace(/^!/, '').trim()
}
