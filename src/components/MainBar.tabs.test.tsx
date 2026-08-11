// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MainBar } from './MainBar'
import type { OpenFilesApi, OpenFile } from '../state/useOpenFiles'

// 탭 줄의 두 가지 — 넘칠 때의 좌우 화살표, 그리고 우클릭 닫기 메뉴.
//
// 닫을 대상을 고르는 판정은 `state/tabCloseTargets.test.ts` 가 본다.
// 여기서 보는 것은 **화면에 붙었는가**: 화살표가 언제 뜨는지, 메뉴가 무엇을 넘기는지.

const FILES: OpenFile[] = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({ path, text: '' }))

function renderBar(overrides: Partial<OpenFilesApi> = {}) {
  const closeMany = vi.fn()
  const api = {
    files: FILES,
    active: 'b.ts',
    close: vi.fn(),
    closeMany,
    select: vi.fn(),
    ...overrides,
  } as unknown as OpenFilesApi

  render(<MainBar openFiles={api} logs={false} onLogs={() => {}} scm={false} onScm={() => {}} />)
  return { closeMany }
}

/** 탭 줄이 넘치게 만든다 — jsdom 은 레이아웃을 안 하므로 크기를 직접 심는다. */
function overflow({ scrollLeft = 0, clientWidth = 300, scrollWidth = 900 } = {}) {
  const strip = document.querySelector('.main-tabs') as HTMLElement
  Object.defineProperty(strip, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(strip, 'scrollWidth', { value: scrollWidth, configurable: true })
  strip.scrollLeft = scrollLeft
  fireEvent.scroll(strip)
  return strip
}

afterEach(cleanup)

describe('탭 줄 좌우 화살표', () => {
  it('넘치지 않으면 그리지 않는다 — 빈 화살표가 자리만 먹는다', () => {
    renderBar()

    expect(screen.queryByLabelText('왼쪽 탭 보기')).toBeNull()
    expect(screen.queryByLabelText('오른쪽 탭 보기')).toBeNull()
  })

  it('넘치면 양쪽에 뜬다', () => {
    renderBar()
    overflow()

    expect(screen.getByLabelText('왼쪽 탭 보기')).toBeTruthy()
    expect(screen.getByLabelText('오른쪽 탭 보기')).toBeTruthy()
  })

  it('맨 왼쪽이면 왼쪽 화살표를 잠근다 — 감추지 않는다', () => {
    // 자리가 사라지면 탭이 통째로 흔들린다.
    renderBar()
    overflow({ scrollLeft: 0 })

    expect((screen.getByLabelText('왼쪽 탭 보기') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('오른쪽 탭 보기') as HTMLButtonElement).disabled).toBe(false)
  })

  it('맨 오른쪽이면 오른쪽 화살표를 잠근다', () => {
    renderBar()
    overflow({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 })

    expect((screen.getByLabelText('왼쪽 탭 보기') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('오른쪽 탭 보기') as HTMLButtonElement).disabled).toBe(true)
  })

  it('누르면 보이는 너비만큼 옮긴다', () => {
    renderBar()
    const strip = overflow({ scrollLeft: 100 })
    const scrollBy = vi.fn()
    strip.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']

    fireEvent.click(screen.getByLabelText('오른쪽 탭 보기'))
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' })

    fireEvent.click(screen.getByLabelText('왼쪽 탭 보기'))
    expect(scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' })
  })
})

describe('탭 우클릭 닫기 메뉴', () => {
  function openMenu(label: string) {
    fireEvent.contextMenu(screen.getByText(label).closest('.main-tab')!)
  }

  it('파일 탭을 우클릭하면 닫기 갈래 넷이 뜬다', () => {
    renderBar()
    openMenu('b.ts')

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '닫기',
      '나머지 모두 닫기2',
      '왼쪽 모두 닫기',
      '오른쪽 모두 닫기',
    ])
  })

  it('대화 탭에는 메뉴가 없다 — 닫을 것이 없다', () => {
    renderBar()
    fireEvent.contextMenu(screen.getByText('대화'))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('나머지 모두 닫기는 그 탭만 남긴다', () => {
    const { closeMany } = renderBar()
    openMenu('b.ts')

    fireEvent.click(screen.getByText(/나머지 모두 닫기/))

    expect(closeMany).toHaveBeenCalledWith(['a.ts', 'c.ts'])
  })

  it('왼쪽·오른쪽은 보이는 순서를 따른다', () => {
    const { closeMany } = renderBar()
    openMenu('b.ts')
    fireEvent.click(screen.getByText('오른쪽 모두 닫기'))
    expect(closeMany).toHaveBeenCalledWith(['c.ts'])

    openMenu('b.ts')
    fireEvent.click(screen.getByText('왼쪽 모두 닫기'))
    expect(closeMany).toHaveBeenLastCalledWith(['a.ts'])
  })

  it('닫을 것이 없는 항목은 잠긴다', () => {
    renderBar()
    openMenu('a.ts')

    expect((screen.getByText('왼쪽 모두 닫기') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('오른쪽 모두 닫기') as HTMLButtonElement).disabled).toBe(false)
  })

  it('고르면 메뉴가 닫힌다', () => {
    renderBar()
    openMenu('b.ts')

    fireEvent.click(screen.getByText('닫기'))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Esc 로 닫는다 — 열어 놓고 아무것도 안 고르는 것이 흔하다', () => {
    renderBar()
    openMenu('b.ts')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('바깥을 누르면 닫힌다', () => {
    renderBar()
    openMenu('b.ts')

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
