import { describe, expect, it } from 'vitest'
import { tabCloseTargets } from './tabCloseTargets'
import type { OpenFile } from './useOpenFiles'

// 탭 우클릭 메뉴가 닫을 대상들.

const FILES: OpenFile[] = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({ path, text: '' }))

describe('닫을 대상 고르기', () => {
  it('가운데 탭 기준으로 넷을 가른다', () => {
    expect(tabCloseTargets(FILES, 'b.ts')).toEqual({
      self: ['b.ts'],
      others: ['a.ts', 'c.ts', 'd.ts'],
      left: ['a.ts'],
      right: ['c.ts', 'd.ts'],
    })
  })

  it('맨 왼쪽 탭이면 왼쪽이 비어 있다 — 메뉴가 그 항목을 잠근다', () => {
    const targets = tabCloseTargets(FILES, 'a.ts')

    expect(targets.left).toEqual([])
    expect(targets.right).toEqual(['b.ts', 'c.ts', 'd.ts'])
  })

  it('맨 오른쪽 탭이면 오른쪽이 비어 있다', () => {
    const targets = tabCloseTargets(FILES, 'd.ts')

    expect(targets.right).toEqual([])
    expect(targets.left).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('탭이 하나뿐이면 자기 말고는 닫을 것이 없다', () => {
    const one: OpenFile[] = [{ path: 'only.ts', text: '' }]

    expect(tabCloseTargets(one, 'only.ts')).toEqual({
      self: ['only.ts'],
      others: [],
      left: [],
      right: [],
    })
  })

  it('화면에 보이는 순서를 그대로 쓴다 — 이름순이 아니다', () => {
    // 정렬을 끼우면 「오른쪽 모두 닫기」가 엉뚱한 것을 닫는다.
    const unsorted: OpenFile[] = ['z.ts', 'a.ts', 'm.ts'].map((path) => ({ path, text: '' }))

    expect(tabCloseTargets(unsorted, 'a.ts').left).toEqual(['z.ts'])
    expect(tabCloseTargets(unsorted, 'a.ts').right).toEqual(['m.ts'])
  })

  it('없는 탭이면 전부 빈 배열이다 — "나머지 모두" 가 전부 닫기로 돌변하면 안 된다', () => {
    // 메뉴가 열려 있는 사이에 그 탭이 닫혔을 수 있다.
    expect(tabCloseTargets(FILES, '사라진.ts')).toEqual({
      self: [],
      others: [],
      left: [],
      right: [],
    })
  })
})
