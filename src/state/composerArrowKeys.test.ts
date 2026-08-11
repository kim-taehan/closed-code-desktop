import { describe, expect, it } from 'vitest'
import { wantsHistoryNav } from './composerArrowKeys'

const none = { mention: null, slash: null, openArg: null }
const arrow = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key,
  metaKey: mods.metaKey ?? false,
  ctrlKey: mods.ctrlKey ?? false,
})

describe('wantsHistoryNav', () => {
  it('맨 위/아래 화살표는 입력창 것이다', () => {
    expect(wantsHistoryNav(arrow('ArrowUp'), none)).toBe(true)
    expect(wantsHistoryNav(arrow('ArrowDown'), none)).toBe(true)
  })

  // **이 두 케이스가 이 파일의 이유다.** 안 걸러 내면 ⌘↑ 한 번에 드로어가 열리면서
  // 입력창 내용까지 이전 프롬프트로 바뀐다 (preventDefault 는 전파를 막지 않는다).
  it('⌘↑/⌘↓ 는 셸 드로어 것이다', () => {
    expect(wantsHistoryNav(arrow('ArrowUp', { metaKey: true }), none)).toBe(false)
    expect(wantsHistoryNav(arrow('ArrowDown', { metaKey: true }), none)).toBe(false)
  })

  it('Ctrl+↑/↓ 도 마찬가지다 (윈도우·리눅스)', () => {
    expect(wantsHistoryNav(arrow('ArrowUp', { ctrlKey: true }), none)).toBe(false)
    expect(wantsHistoryNav(arrow('ArrowDown', { ctrlKey: true }), none)).toBe(false)
  })

  it('자동완성이 떠 있으면 화살표는 팝업 것이다', () => {
    expect(wantsHistoryNav(arrow('ArrowUp'), { ...none, mention: 'src' })).toBe(false)
    expect(wantsHistoryNav(arrow('ArrowUp'), { ...none, slash: 'op' })).toBe(false)
    expect(wantsHistoryNav(arrow('ArrowUp'), { ...none, openArg: 'a.ts' })).toBe(false)
  })

  it('화살표가 아니면 상관없다', () => {
    expect(wantsHistoryNav(arrow('Enter'), none)).toBe(false)
    expect(wantsHistoryNav(arrow('ArrowLeft'), none)).toBe(false)
  })
})
