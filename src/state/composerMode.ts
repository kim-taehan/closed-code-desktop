import { SLASH_CATEGORIES } from './slashNamespace'

// 입력창이 지금 무엇을 받고 있는지.
//
// 첫 글자로 정한다 (desktop2·CLI REPL 과 같은 규칙):
//   !  셸 — LLM 을 거치지 않고 프로젝트 폴더에서 바로 실행한다
//   @  파일 참조
//   /  스킬
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
  skill: '스킬',
}

/**
 * 커서 자리에서 이어 치고 있는 스킬 이름.
 *
 * `@` 와 달리 **줄 맨 앞에서만** 본다 — 경로나 날짜의 `/` 를 스킬로 잡으면 안 된다.
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
  // 2단계(`/command open `)와 예전 한 단계(`/open `) 둘 다 받는다 — 어느 쪽으로 도달해도
  // 인자 구간은 같아야 한다 (DC-980).
  const match = text.slice(0, caret).match(/^\s*\/(?:command\s+)?open\s+(\S*)$/)
  return match ? (match[1] ?? '') : null
}

/**
 * 커서 자리의 `/` 맥락. **2단계(DC-980)까지 본다.**
 *
 * skillAtCaret 은 공백에서 닫히지만, `/command cl` 처럼 카테고리 뒤 항목을 치는 동안에도
 * 팝업이 떠 있어야 한다. 그래서 **앞 토막이 아는 카테고리일 때만** 공백을 하나 넘어간다 —
 * 아무 때나 넘어가면 `/open 경로` 의 인자 구간까지 삼켜 파일 리스트를 가린다.
 *
 * 돌려주는 값은 `/` 를 뗀 것이다: `''`, `'com'`, `'command cl'`.
 */
export function slashContextAtCaret(text: string, caret: number): string | null {
  const before = text.slice(0, caret)

  const twoStage = before.match(/^\s*\/(\S+)\s(\S*)$/)
  if (twoStage && SLASH_CATEGORIES.some((c) => c.namespace === twoStage[1])) {
    return `${twoStage[1]} ${twoStage[2] ?? ''}`
  }

  return skillAtCaret(text, caret)
}

/**
 * 커서 앞의 `/` 맥락 전체를 넣을 텍스트로 통째 바꾼다.
 *
  * 예전 replaceSkill 은 `/토막` 하나만 바꿔서 `/command cl` 같은 2단계 입력을 못 다룬다.
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
