import { describe, expect, it } from 'vitest'
import {
  detectComposerMode,
  openArgAtCaret,
  replaceSlashContext,
  shellCommandOf,
  skillAtCaret,
} from './composerMode'

// 첫 글자가 무엇을 받을지 정한다.
// 잘못 알아보면 `!rm -rf` 가 평범한 질문으로 나간다 — 그때는 늦다.

describe('입력 모드', () => {
  it('! 로 시작하면 셸이다', () => {
    expect(detectComposerMode('!ls -la')).toBe('shell')
  })

  it('@ 로 시작하면 파일 참조다', () => {
    expect(detectComposerMode('@src/App.tsx 를 봐줘')).toBe('file')
  })

  it('평범한 질문은 모드가 없다', () => {
    expect(detectComposerMode('안녕하세요')).toBeNull()
  })

  it('앞의 공백은 무시한다', () => {
    expect(detectComposerMode('   !pwd')).toBe('shell')
  })

  // 문장 가운데의 ! 는 셸이 아니다
  it('가운데 나온 ! 는 셸로 보지 않는다', () => {
    expect(detectComposerMode('안녕! 반가워')).toBeNull()
  })

  it('빈 입력은 모드가 없다', () => {
    expect(detectComposerMode('')).toBeNull()
    expect(detectComposerMode('   ')).toBeNull()
  })
})

describe('스킬 모드', () => {
  it('/ 로 시작하면 스킬이다', () => {
    expect(detectComposerMode('/pptx')).toBe('skill')
  })

  it('/ 뒤에 치고 있으면 그 토막을 준다', () => {
    expect(skillAtCaret('/ppt', 4)).toBe('ppt')
  })

  it('/ 만 쳤으면 빈 문자열 — 목록 전체를 보여줘야 한다', () => {
    expect(skillAtCaret('/', 1)).toBe('')
  })

  // 경로나 날짜의 / 를 스킬로 잡으면 안 된다
  it('줄 맨 앞이 아니면 스킬이 아니다', () => {
    expect(skillAtCaret('src/App', 7)).toBeNull()
    expect(skillAtCaret('2026/07/21', 10)).toBeNull()
  })

  it('공백을 지나면 더는 스킬이 아니다', () => {
    expect(skillAtCaret('/pptx 로', 8)).toBeNull()
  })

  it('고른 이름으로 바꾸고 뒤에 공백을 붙인다', () => {
    const result = replaceSlashContext('/ppt', 4, '/pptx ')
    expect(result.text).toBe('/pptx ')
    expect(result.caret).toBe(result.text.length)
  })

  // 평면 한 단계다 — 공백이 나오면 그 뒤는 그 명령의 인자 구간이고 팝업은 닫힌다.
  // (예전에는 `/command cl` 처럼 카테고리 뒤 항목을 치는 동안 맥락을 이어 갔다.)
  it('이름 뒤 공백부터는 맥락이 아니다', () => {
    expect(skillAtCaret('/init 인자', 8)).toBeNull()
  })
})

describe('/open 인자 구간', () => {
  it('`/open ` 뒤에 치고 있는 토막을 준다 — 공백 직후는 빈 문자열', () => {
    expect(openArgAtCaret('/open ', 6)).toBe('')
    expect(openArgAtCaret('/open src/a', 11)).toBe('src/a')
  })

  it('공백 전(`/open` 까지)은 인자 구간이 아니다 — 스킬 팝업 몫이다', () => {
    expect(openArgAtCaret('/open', 5)).toBeNull()
  })

  it('다른 명령이나 평문은 아니다', () => {
    expect(openArgAtCaret('/rename 제목', 10)).toBeNull()
    expect(openArgAtCaret('open src/a', 10)).toBeNull()
  })

  it('커서가 토막을 지나쳐 뒤 낱말에 있으면 닫는다', () => {
    expect(openArgAtCaret('/open a.ts 그리고', 14)).toBeNull()
  })
})

describe('명령 추출', () => {
  it('! 를 떼고 앞뒤 공백을 정리한다', () => {
    expect(shellCommandOf('  ! git status  ')).toBe('git status')
  })

  it('! 만 있으면 빈 명령이다', () => {
    expect(shellCommandOf('!')).toBe('')
  })
})
