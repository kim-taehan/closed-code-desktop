import { describe, expect, it } from 'vitest'
import { mentionAtCaret, parseMentions, replaceMention } from './atMentions'

// `@경로` 참조. 규칙은 runtime 의 input_expander 와 같다.
// 잘못 잡으면 이메일이나 데코레이터가 파일 참조로 나간다.

describe('참조 뽑기', () => {
  it('@ 로 시작하는 경로를 뽑는다', () => {
    expect(parseMentions('@src/App.tsx 를 봐줘')).toEqual(['src/App.tsx'])
  })

  it('여러 개도 뽑는다', () => {
    expect(parseMentions('@a.ts 와 @b.ts')).toEqual(['a.ts', 'b.ts'])
  })

  it('같은 경로는 한 번만', () => {
    expect(parseMentions('@a.ts 랑 @a.ts')).toEqual(['a.ts'])
  })

  // 이메일을 파일로 보내면 안 된다
  it('낱말 가운데의 @ 는 참조가 아니다', () => {
    expect(parseMentions('me@example.com 으로 보내')).toEqual([])
  })

  it('경로 가운데의 @ 도 아니다', () => {
    expect(parseMentions('node_modules/@types/node')).toEqual([])
  })

  // 문장 부호가 붙어 오는 일이 흔하다
  it('뒤에 붙은 문장 부호는 뗀다', () => {
    expect(parseMentions('@src/App.tsx, 그리고')).toEqual(['src/App.tsx'])
  })

  it('참조가 없으면 빈 배열', () => {
    expect(parseMentions('그냥 질문')).toEqual([])
  })
})

describe('커서 자리의 참조', () => {
  it('@ 뒤에서 치고 있으면 그 토막을 준다', () => {
    expect(mentionAtCaret('@src/Ap', 7)).toBe('src/Ap')
  })

  it('@ 만 쳤으면 빈 문자열 — 목록 전체를 보여줘야 한다', () => {
    expect(mentionAtCaret('보여줘 @', 5)).toBe('')
  })

  // 이미 지나간 참조까지 잡으면 엉뚱한 자리에 목록이 뜬다
  it('공백을 지나면 더는 참조가 아니다', () => {
    expect(mentionAtCaret('@a.ts 다음', 8)).toBeNull()
  })

  it('참조가 아니면 null', () => {
    expect(mentionAtCaret('그냥 글', 4)).toBeNull()
  })
})

describe('참조 채우기', () => {
  it('치던 토막을 고른 경로로 바꾸고 뒤에 공백을 붙인다', () => {
    const result = replaceMention('@src/Ap', 7, 'src/App.tsx')

    expect(result.text).toBe('@src/App.tsx ')
    expect(result.caret).toBe(result.text.length)
  })

  it('문장 가운데서도 그 토막만 바꾼다', () => {
    // 커서는 치던 토막 바로 뒤에 있다 (공백을 지나면 더는 참조가 아니다)
    const result = replaceMention('이거 @App 봐줘', 7, 'src/App.tsx')
    expect(result.text).toBe('이거 @src/App.tsx  봐줘')
  })

  it('참조가 아니면 그대로 둔다', () => {
    expect(replaceMention('그냥 글', 4, 'a.ts')).toEqual({ text: '그냥 글', caret: 4 })
  })
})
