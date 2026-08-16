import { describe, expect, it } from 'vitest'
import { paneKey } from './paneQueue'

describe('paneKey', () => {
  // 경계는 U+0000 이다. 소스에 **날 NUL 바이트**로 박혀 있던 것을 `'\0'` 이스케이프로 바꿨고
  // 값은 그대로여야 한다 — 갈리면 같은 칸이 다른 키로 잡혀 순번 조작이 조용히 풀린다.
  // 이름·프로젝트 id 에 나올 수 없는 글자여야 하므로 `:` 나 공백으로 갈지 않는다.
  it('프로젝트와 이름을 U+0000 으로 가른다', () => {
    expect([...paneKey('proj', 'shell')].map((ch) => ch.charCodeAt(0))).toEqual([
      112, 114, 111, 106, 0, 115, 104, 101, 108, 108,
    ])
  })

  // 경계가 없거나 흔한 글자면 이 둘이 같은 키가 된다.
  it('경계가 있다 — 이어 붙여 같은 값이 되지 않는다', () => {
    expect(paneKey('ab', 'c')).not.toBe(paneKey('a', 'bc'))
  })
})
