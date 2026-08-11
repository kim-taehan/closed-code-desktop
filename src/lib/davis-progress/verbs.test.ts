import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySuffix, DEFAULT_VERBS, getAllVerbs, pickRandomVerb } from './verbs'

// 동사 사전과 문구 조립 규칙. vscode 원본과 문자열이 정확히 같아야 한다.

const verbs = {
  suffix: ' 중...',
  thinking: ['생각하는', '따져보는'],
  crafting: ['엮는'],
  searching: ['뒤지는'],
  cooking: ['졸이는'],
  nature: ['자아내는'],
  playful: ['흥얼거리는'],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('동사 사전', () => {
  it('6개 범주를 하나로 합친다 — suffix 나 비배열 필드는 빼고', () => {
    expect(getAllVerbs(verbs)).toEqual([
      '생각하는', '따져보는', '엮는', '뒤지는', '졸이는', '자아내는', '흥얼거리는',
    ])
  })

  it('실제 사전은 100개다', () => {
    expect(getAllVerbs(DEFAULT_VERBS)).toHaveLength(100)
  })

  it('실제 사전의 접미사는 말줄임표 문자다', () => {
    expect(DEFAULT_VERBS.suffix).toBe(' 중…')
  })

  it('범주별이 아니라 전체에서 균등 추첨한다', () => {
    // 전체 7개 중 인덱스 2(=crafting 첫 항목)를 고르는 난수
    vi.spyOn(Math, 'random').mockReturnValue(2 / 7)
    expect(pickRandomVerb(verbs)).toBe('엮는')
  })

  it('경계값 난수에서도 사전 밖으로 나가지 않는다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(pickRandomVerb(verbs)).toBe('흥얼거리는')
  })

  it('사전이 비면 빈 문자열이다', () => {
    const empty = { thinking: [], crafting: [], searching: [], cooking: [], nature: [], playful: [] }
    expect(pickRandomVerb(empty)).toBe('')
  })
})

describe('접미사', () => {
  it('평범한 문구에는 붙인다', () => {
    expect(applySuffix('엮는', ' 중…')).toBe('엮는 중…')
  })

  it('이미 "중…" 으로 끝나면 붙이지 않는다', () => {
    expect(applySuffix('파일 읽는 중…', ' 중…')).toBe('파일 읽는 중…')
  })

  it('마침표 세 개로 끝나도 붙이지 않는다', () => {
    expect(applySuffix('파일 읽는 중...', ' 중...')).toBe('파일 읽는 중...')
  })

  it('꼬리 없는 "중" 하나로 끝나도 붙이지 않는다', () => {
    expect(applySuffix('읽는 중', ' 중…')).toBe('읽는 중')
  })

  it('문장 가운데 "중" 은 꼬리로 보지 않는다', () => {
    expect(applySuffix('중간 결과 엮는', ' 중…')).toBe('중간 결과 엮는 중…')
  })
})
