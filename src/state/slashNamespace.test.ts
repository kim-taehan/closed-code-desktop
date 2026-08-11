import { describe, expect, it } from 'vitest'
import {
  SLASH_CATEGORIES,
  categoryInsertText,
  filterCategories,
  filterItems,
  itemInsertText,
  normalize,
  parseSlashInput,
  parseSlashSubmission,
} from './slashNamespace'

// `/` 2단계 네임스페이스 (DC-980).

describe('단계 판별', () => {
  it('`/` 만 치면 카테고리 단계다', () => {
    expect(parseSlashInput('/')).toEqual({ kind: 'category', query: '' })
  })

  it('공백 전까지는 카테고리를 좁히는 중이다', () => {
    expect(parseSlashInput('/com')).toEqual({ kind: 'category', query: 'com' })
  })

  it('카테고리 뒤 공백부터 항목 단계다', () => {
    expect(parseSlashInput('/command ')).toEqual({
      kind: 'item',
      namespace: 'command',
      type: 'command',
      query: '',
    })
    expect(parseSlashInput('/command cl')).toEqual({
      kind: 'item',
      namespace: 'command',
      type: 'command',
      query: 'cl',
    })
  })

  it('항목 뒤에 또 공백이 오면 프롬프트 단계 — 팝업을 닫는다', () => {
    expect(parseSlashInput('/command clear ')).toEqual({
      kind: 'prompt',
      namespace: 'command',
      type: 'command',
    })
    expect(parseSlashInput('/skill pptx 표지 만들어')).toEqual({
      kind: 'prompt',
      namespace: 'skill',
      type: 'skill',
    })
  })

  it('모르는 접두사 뒤의 공백은 평범한 글이다', () => {
    expect(parseSlashInput('/안녕 하세요')).toBeNull()
  })

  it('`/` 로 시작하지 않으면 대상이 아니다', () => {
    expect(parseSlashInput('안녕')).toBeNull()
    expect(parseSlashInput('')).toBeNull()
  })
})

describe('매칭 정규화', () => {
  it('대소문자·언더바·하이픈·연속공백을 한 가지로 접는다', () => {
    expect(normalize('Deep_Research')).toBe('deep research')
    expect(normalize('deep-research')).toBe('deep research')
    expect(normalize('  A   B  ')).toBe('a b')
  })
})

describe('필터', () => {
  it('빈 쿼리는 전부 통과한다', () => {
    expect(filterCategories('')).toHaveLength(SLASH_CATEGORIES.length)
  })

  it('카테고리는 이름이나 설명으로 걸린다', () => {
    expect(filterCategories('skill').map((c) => c.namespace)).toEqual(['skill'])
    expect(filterCategories('커맨드').map((c) => c.namespace)).toEqual(['command'])
  })

  it('항목도 이름·설명으로 걸리며 하이픈 차이를 무시한다', () => {
    const items = [
      { display: 'deep-research', description: '깊게 조사' },
      { display: 'clear', description: '새 대화' },
    ]
    expect(filterItems(items, 'deep research').map((i) => i.display)).toEqual(['deep-research'])
    expect(filterItems(items, '새 대화').map((i) => i.display)).toEqual(['clear'])
    expect(filterItems(items, '')).toHaveLength(2)
  })
})

describe('입력 텍스트 생성', () => {
  it('카테고리를 고르면 뒤에 공백을 붙여 항목 단계로 넘긴다', () => {
    expect(categoryInsertText('command')).toBe('/command ')
  })

  it('항목을 고르면 뒤 공백까지 넣어 바로 인자를 칠 수 있게 한다', () => {
    expect(itemInsertText('command', 'rename')).toBe('/command rename ')
  })
})

describe('전송 직전 재조립', () => {
  it('2단계 형식을 실행 대상으로 되돌린다', () => {
    expect(parseSlashSubmission('/command clear')).toEqual({
      type: 'command',
      name: 'clear',
      args: '',
    })
    expect(parseSlashSubmission('/command rename 새 제목')).toEqual({
      type: 'command',
      name: 'rename',
      args: '새 제목',
    })
    expect(parseSlashSubmission('/skill pptx 표지 만들어')).toEqual({
      type: 'skill',
      name: 'pptx',
      args: '표지 만들어',
    })
  })

  it('예전 한 단계 형식도 그대로 받는다 — 손에 익은 대로 쳐도 된다', () => {
    expect(parseSlashSubmission('/clear')).toEqual({ type: 'command', name: 'clear', args: '' })
    expect(parseSlashSubmission('/rename 새 제목')).toEqual({
      type: 'command',
      name: 'rename',
      args: '새 제목',
    })
  })

  it('카테고리만 친 것은 실행 대상이 아니다', () => {
    expect(parseSlashSubmission('/command')).toBeNull()
    expect(parseSlashSubmission('/skill')).toBeNull()
  })

  it('평범한 글은 건드리지 않는다', () => {
    expect(parseSlashSubmission('안녕하세요')).toBeNull()
  })
})
