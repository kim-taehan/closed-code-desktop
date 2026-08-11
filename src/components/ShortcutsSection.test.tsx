// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ShortcutsSection } from './ShortcutsSection'
import { MOD } from '../state/modKey'

afterEach(cleanup)

// 이 목록의 규칙은 "실제로 등록된 것만 적는다" 다 (ShortcutsSection.tsx 머리말).
// ⌘L 은 개발자 모드에서만 등록되므로(App.tsx → useShortcuts.onLogs), 행도 그때만 있어야 한다.

describe('설정 → 단축키 목록', () => {
  it('개발자 모드가 아니면 로그 보기(⌘L) 행이 없다', () => {
    render(<ShortcutsSection developerMode={false} />)
    expect(screen.queryByText(`${MOD} + L`)).toBeNull()
  })

  it('개발자 모드면 로그 보기(⌘L) 행이 있다', () => {
    render(<ShortcutsSection developerMode />)
    expect(screen.getByText(`${MOD} + L`)).toBeTruthy()
  })

  it('설정 열기(⌘,)는 개발자 모드와 무관하게 늘 적혀 있다 — 늘 등록돼 있다', () => {
    render(<ShortcutsSection developerMode={false} />)
    expect(screen.getByText(`${MOD} + ,`)).toBeTruthy()
  })
})
