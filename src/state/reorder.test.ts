import { describe, expect, it } from 'vitest'
import { moveTo } from './reorder'

const id = (value: string) => value

describe('끌어 옮기기 순서 계산', () => {
  it('오른쪽으로 끌면 놓은 탭 뒤에 선다', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], id, 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('왼쪽으로 끌면 놓은 탭 앞에 선다', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], id, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })

  // 커서 위치를 재지 않는 규칙이라 양 끝에 닿는지가 빠지기 쉽다
  it('맨 뒤·맨 앞에도 닿는다', () => {
    expect(moveTo(['a', 'b', 'c'], id, 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveTo(['a', 'b', 'c'], id, 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('제자리·모르는 키면 원본을 그대로 준다 — 다시 그릴 이유를 만들지 않는다', () => {
    const items = ['a', 'b']
    expect(moveTo(items, id, 'a', 'a')).toBe(items)
    expect(moveTo(items, id, 'x', 'a')).toBe(items)
    expect(moveTo(items, id, 'a', 'x')).toBe(items)
  })

  it('원본을 고치지 않는다', () => {
    const items = ['a', 'b', 'c']
    moveTo(items, id, 'a', 'c')
    expect(items).toEqual(['a', 'b', 'c'])
  })

  it('키로 찾아 원소째 옮긴다', () => {
    const items = [{ path: 'x' }, { path: 'y' }]
    expect(moveTo(items, (item) => item.path, 'y', 'x')).toEqual([{ path: 'y' }, { path: 'x' }])
  })
})
