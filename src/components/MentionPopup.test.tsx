// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MentionPopup } from './MentionPopup'

// `@` 자동완성. 파일뿐 아니라 **폴더도 고를 수 있어야 한다** — 범위를 가리키는 참조가
// 파일 하나를 가리키는 것만큼 흔하다. 폴더는 뒤에 `/` 를 붙여 넣어 받는 쪽이 구분한다.
// `/open` 재사용분(includeDirs 없음)은 파일만 보여야 한다 — 폴더는 열 수 없다.

const FILES = ['src/App.tsx', 'src/state/fuzzy.ts']
const DIRS = ['src', 'src/state']

beforeEach(() => {
  ;(window as unknown as { davis: unknown }).davis = {
    listFiles: () => Promise.resolve({ files: FILES, dirs: DIRS, truncated: false }),
  }
})

afterEach(cleanup)

describe('MentionPopup 폴더 참조', () => {
  it('includeDirs 면 폴더가 목록에 뜨고, 고르면 뒤에 / 가 붙은 경로를 준다', async () => {
    const onPick = vi.fn()
    render(<MentionPopup query="state" onPick={onPick} onClose={vi.fn()} includeDirs />)

    await waitFor(() => expect(screen.getByText('src/state/')).toBeTruthy())
    fireEvent.mouseDown(screen.getByText('src/state/'))
    expect(onPick).toHaveBeenCalledWith('src/state/')
  })

  it('폴더가 파일보다 먼저 온다 — 범위를 가리키려는 의도가 앞선다', async () => {
    render(<MentionPopup query="" onPick={vi.fn()} onClose={vi.fn()} includeDirs />)

    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(DIRS.length + FILES.length))
    const options = screen.getAllByRole('option')
    expect(options[0]!.textContent).toContain('src/')
    expect(options[1]!.textContent).toContain('src/state/')
  })

  it('includeDirs 가 없으면(`/open`) 폴더는 나오지 않는다 — 폴더는 열 수 없다', async () => {
    render(<MentionPopup query="" onPick={vi.fn()} onClose={vi.fn()} label="파일 열기" />)

    await waitFor(() => expect(screen.getByText('src/App.tsx')).toBeTruthy())
    expect(screen.queryByText('src/state/')).toBeNull()
    expect(screen.getAllByRole('option')).toHaveLength(FILES.length)
  })
})

describe('경로(depth) 검색', () => {
  beforeEach(() => {
    ;(window as unknown as { davis: unknown }).davis = {
      listFiles: () =>
        Promise.resolve({
          // 'dist/asse' 가 서브시퀀스로 걸리는 깊은 파일들이 섞여 있다 (실측 화면)
          files: [
            'dist-electron/electron/session/agentTaskStore.js',
            'dist/assets/index-a1.js',
            'dist/index.html',
          ],
          dirs: ['dist', 'dist/assets', 'dist-electron', 'dist-electron/electron'],
          truncated: false,
        }),
    }
  })

  it('친 경로가 그대로 들어 있는 폴더가 맨 위에 온다', async () => {
    render(<MentionPopup query="dist/asse" onPick={vi.fn()} onClose={vi.fn()} includeDirs />)

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('option')[0]!.textContent).toContain('dist/assets/')
  })

  it('폴더가 파일보다 항상 먼저다', async () => {
    render(<MentionPopup query="dist" onPick={vi.fn()} onClose={vi.fn()} includeDirs />)

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(2))
    const texts = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    const lastDir = texts.map((text) => text.includes('.js')).indexOf(true)
    expect(lastDir).toBeGreaterThan(0)
    expect(texts.slice(0, lastDir).every((text) => !text.includes('.js'))).toBe(true)
  })

  it('슬래시로 끝나면 그 폴더 안을 보여준다 — 남의 경로(dist-electron)는 안 섞인다', async () => {
    render(<MentionPopup query="dist/" onPick={vi.fn()} onClose={vi.fn()} includeDirs />)

    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2))
    const texts = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    // 하위 폴더 먼저, 그 다음 파일. 더 깊은 것(assets/index-a1.js)은 폴더를 다시 골라 들어간다.
    expect(texts[0]).toContain('dist/assets/')
    expect(texts[1]).toContain('dist/index.html')
    expect(texts.some((text) => text.includes('dist-electron'))).toBe(false)
  })
})

// 일치가 0행이어도 상자를 남긴다 (SlashPopup 과 같은 처방).
// 사라지면 Esc 의 임자 판정(useShortcuts 의 [role=listbox])이 팝업을 못 보고,
// 같은 Esc 가 턴 리뷰 거절까지 발동해 파일이 확인 없이 되돌아간다.
describe('일치 0행', () => {
  it('보이지는 않지만 DOM 에는 남는다 — Esc 의 임자가 여기 있음을 알려야 한다', async () => {
    render(<MentionPopup query="zzzzzz" onPick={vi.fn()} onClose={vi.fn()} includeDirs />)

    await waitFor(() => {
      const box = document.querySelector('[role="listbox"]')
      expect(box).not.toBeNull()
      expect((box as HTMLElement).hidden).toBe(true)
    })
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('`/open` 인자 구간도 같다 — 같은 컴포넌트를 재사용한다', async () => {
    render(<MentionPopup query="zzzzzz" onPick={vi.fn()} onClose={vi.fn()} label="파일 열기" />)

    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  })
})
