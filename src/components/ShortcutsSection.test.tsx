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

  // 규칙의 **반대 방향**: 도는데 안 적힌 것도 약속을 깬다. 화면이 스스로
  // "지금 동작하는 것만 적혀 있습니다" 라고 광고하므로, 사용자는 목록에 없으면 없다고 믿는다.
  describe('도는데 빠져 있던 것들', () => {
    // Esc 는 행이 둘이다 — 응답 중단과 팝업 닫기. **합치지 않는다**: 둘 다 실제로 도는
    // 별개 동작이고 임자 판정(`useShortcuts` 의 `borrowed()`)이 가른다. 그래서 키가 아니라
    // 설명으로 찾는다.
    it('응답 중단(Esc)과 리뷰 적용(⌘Enter)이 적혀 있다', () => {
      const { container } = render(<ShortcutsSection developerMode={false} />)
      const keysFor = (what: string) =>
        [...container.querySelectorAll('tr')]
          .find((tr) => tr.querySelector('.dc-keys__what')?.textContent === what)
          ?.querySelector('.dc-keys__key')?.textContent

      expect(keysFor('응답 중단')).toBe('Esc')
      expect(keysFor('turn 리뷰 전체 적용')).toBe(`${MOD} + Enter`)
    })

    it('입력 되짚기(↑↓)가 적혀 있다', () => {
      render(<ShortcutsSection developerMode={false} />)
      expect(screen.getByText('↑ ↓')).toBeTruthy()
    })

    it('셸 칸(⌘↓·⌘↑)이 적혀 있다', () => {
      render(<ShortcutsSection developerMode={false} />)
      expect(screen.getByText(`${MOD} + ↓`)).toBeTruthy()
      expect(screen.getByText(`${MOD} + ↑`)).toBeTruthy()
    })

    it('프로젝트 직행(⌘1…9)이 적혀 있다', () => {
      render(<ShortcutsSection developerMode={false} />)
      expect(screen.getByText(`${MOD} + 1…9`)).toBeTruthy()
    })
  })

  // ⇧Tab 은 입력창 안에서만 먹는다 (PermissionModeSwitch). 「창 전체」로 적으면
  // 밖에서 눌러 보고 "안 먹는다" 고 여긴다 — 목록이 거짓말을 하는 그 모양이다.
  it('⇧Tab 의 범위를 입력창으로 적는다', () => {
    const { container } = render(<ShortcutsSection developerMode={false} />)
    const row = [...container.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes('권한 모드 순환'),
    )
    expect(row?.querySelector('.dc-keys__where')?.textContent).toBe('입력창')
  })
})
