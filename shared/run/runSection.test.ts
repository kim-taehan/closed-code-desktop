import { describe, expect, it } from 'vitest'
import { parseRunSection, writeRunSection, type RunSection } from './runSection'

// 이 시험이 겨누는 것은 **읽기와 쓰기가 같은 형식을 쓰는가** 하나다 (`runSection.ts` 머리말).
// 둘이 갈리면 타입도 초록이고 각자의 단위 시험도 초록인 채로, 화면에서는 목록이 늘 빈다.

const SECTION: RunSection = {
  entries: [
    { name: 'dev 서버', command: 'npm run dev', note: '개발 서버' },
    { name: '테스트', command: 'npm test' },
  ],
  manifest: '3f9a1c2b',
}

describe('parseRunSection', () => {
  it('절이 없으면 null — 「비어 있는 절」과 다른 사실이다', () => {
    expect(parseRunSection('# 프로젝트\n\n아무 말.\n')).toBeNull()
    expect(parseRunSection('## 실행\n\n아직 없습니다.\n')).toEqual({ entries: [], manifest: null })
  })

  it('머리줄과 구분줄은 항목이 아니다 — 둘째 칸의 백틱 하나로 갈린다', () => {
    const parsed = parseRunSection(
      ['## 실행', '', '| 이름 | 명령 | 설명 |', '| --- | --- | --- |', '| dev | `npm run dev` | |'].join('\n'),
    )
    expect(parsed?.entries).toEqual([{ name: 'dev', command: 'npm run dev' }])
  })

  it('다음 제목에서 절이 끝난다 — 뒤 절의 표를 실행 목록으로 읽지 않는다', () => {
    const parsed = parseRunSection(
      ['## 실행', '| dev | `npm run dev` |', '', '## 규칙', '| 금지 | `rm -rf /` |'].join('\n'),
    )
    expect(parsed?.entries).toEqual([{ name: 'dev', command: 'npm run dev' }])
  })

  it('더 깊은 제목은 절 안이다 — 사람이 아래에 설명을 덧붙여도 목록이 안 잘린다', () => {
    const parsed = parseRunSection(
      ['## 실행', '| dev | `npm run dev` |', '', '### 주의', '| test | `npm test` |'].join('\n'),
    )
    expect(parsed?.entries).toHaveLength(2)
  })
})

describe('writeRunSection', () => {
  it('쓴 것을 그대로 읽는다 — 지문까지', () => {
    expect(parseRunSection(writeRunSection('', SECTION))).toEqual(SECTION)
  })

  it('명령 안의 파이프가 표를 쪼개지 않는다', () => {
    const piped: RunSection = {
      entries: [{ name: 'log', command: 'npm run dev | tail -n 20', note: 'a | b' }],
      manifest: null,
    }
    expect(parseRunSection(writeRunSection('', piped))).toEqual(piped)
  })

  it('절 밖은 한 글자도 안 건드린다', () => {
    const before = ['# 프로젝트', '', '사람이 쓴 글.', '', '## 실행', '', '| 낡음 | `old` |', '', '## 규칙', '', '지켜라.', ''].join('\n')
    const after = writeRunSection(before, SECTION)

    expect(after.startsWith('# 프로젝트\n\n사람이 쓴 글.\n')).toBe(true)
    expect(after).toContain('## 규칙\n\n지켜라.')
    expect(after).not.toContain('`old`')
    expect(parseRunSection(after)?.entries).toEqual(SECTION.entries)
  })

  it('절이 없으면 끝에 덧붙인다 — 사람이 쓴 첫 문단보다 위로 가지 않는다', () => {
    const after = writeRunSection('# 프로젝트\n\n소개.\n', SECTION)
    expect(after.indexOf('소개.')).toBeLessThan(after.indexOf('## 실행'))
  })

  it('절의 깊이를 그대로 쓴다 — `# 실행` 로 적힌 문서를 `##` 로 바꾸지 않는다', () => {
    const after = writeRunSection('# 실행\n\n| 낡음 | `old` |\n', SECTION)
    expect(after.startsWith('# 실행\n')).toBe(true)
    expect(after).not.toContain('## 실행')
  })
})
