// @vitest-environment jsdom
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useTheme, type ThemeChoice } from './useTheme'

// **테마가 걸리는 시점**을 겨눈다.
//
// 증상: 테마를 바꾸면 셸 드로어의 터미널만 옛 색으로 남았다 (다크로 바꿨는데 터미널은 흰 배경).
// 원인은 색이 아니라 순서였다 — `useTheme` 을 부르는 App 이 부모고 터미널은 자식인데,
// React 는 **자식 효과를 부모 효과보다 먼저** 돌린다. 그래서 CSS 변수를 읽는 자식이
// `data-theme` 이 아직 안 바뀐 상태에서 읽어 **늘 한 테마 뒤처졌다.**
//
// 여기서 재는 것은 xterm 이 아니라 그 순서다. jsdom 은 CSS 변수를 제대로 계산해 주지
// 않아 색으로는 못 재고, 색의 근거인 `data-theme` 이 자식 효과 시점에 이미 새 값인지를 본다.

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/** CSS 변수를 읽는 자식(DrawerTerminal) 자리. 읽은 시점의 data-theme 을 남긴다. */
function ThemeReader({ theme, seen }: { theme: ThemeChoice; seen: string[] }) {
  useEffect(() => {
    seen.push(document.documentElement.getAttribute('data-theme') ?? '(없음)')
  }, [theme])
  return null
}

function Host({ seen }: { seen: string[] }) {
  const theme = useTheme()
  return (
    <>
      <button type="button" onClick={() => theme.setChoice('paper')}>
        페이퍼로
      </button>
      <ThemeReader theme={theme.choice} seen={seen} />
    </>
  )
}

describe('테마 적용 시점', () => {
  it('자식이 색을 읽을 때 data-theme 은 이미 새 테마다', () => {
    const seen: string[] = []
    render(<Host seen={seen} />)
    expect(seen).toEqual(['dark'])

    fireEvent.click(screen.getByRole('button'))

    // 여기가 'dark' 로 남으면 자식은 옛 팔레트를 읽는다 — 터미널만 옛 색으로 남던 자리다
    expect(seen[seen.length - 1]).toBe('paper')
  })

  it('첫 마운트에도 이미 걸려 있다 — 자식이 속성 없는 문서를 읽지 않는다', () => {
    document.documentElement.removeAttribute('data-theme')
    const seen: string[] = []
    render(<Host seen={seen} />)
    // 효과에만 걸던 시절 여기는 '(없음)' 이었다
    expect(seen[0]).toBe('dark')
  })
})
