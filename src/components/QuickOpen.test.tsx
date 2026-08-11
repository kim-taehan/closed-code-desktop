// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QuickOpen } from './QuickOpen'

// 빠른 열기: 열 때 목록을 한 번 받아와 퍼지 필터하고, ↑/↓ 로 커서를 옮기고,
// Enter/클릭으로 열고, Esc/백드롭으로 닫는다. 여기선 그 행동만 본다.

const FILES = ['src/App.tsx', 'src/components/QuickOpen.tsx', 'src/state/fuzzy.ts', 'README.md']

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    listFiles: () => Promise.resolve({ files: FILES, dirs: [], truncated: false }),
    ...overrides,
  }
}

function input() {
  return screen.getByLabelText('파일 이름') as HTMLInputElement
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('QuickOpen — 목록 로딩', () => {
  it('받아오기 전에는 "훑는 중"을 보이고, 오면 파일을 그린다', async () => {
    render(<QuickOpen onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByText('파일을 훑는 중…')).toBeTruthy()
    await waitFor(() => screen.getByText('App.tsx'))
    // basename 과 전체 경로를 함께 보인다
    expect(screen.getByText('src/App.tsx')).toBeTruthy()
  })

  it('잘렸으면 그 사실을 알린다', async () => {
    stubDavis({ listFiles: () => Promise.resolve({ files: FILES, dirs: [], truncated: true }) })
    render(<QuickOpen onOpen={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))
    expect(screen.getByText('파일이 너무 많아 일부만 훑었습니다')).toBeTruthy()
  })
})

describe('QuickOpen — 퍼지 필터', () => {
  it('타이핑하면 부분수열로 좁혀진다', async () => {
    render(<QuickOpen onOpen={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.change(input(), { target: { value: 'quick' } })
    await waitFor(() => screen.getByText('QuickOpen.tsx'))
    expect(screen.queryByText('README.md')).toBeNull()
  })

  it('맞는 게 없으면 안내를 보인다', async () => {
    render(<QuickOpen onOpen={() => {}} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))
    fireEvent.change(input(), { target: { value: 'zzzzz' } })
    await waitFor(() => screen.getByText('맞는 파일이 없습니다'))
  })
})

describe('QuickOpen — 키보드 선택', () => {
  it('Enter 는 커서가 가리키는 파일을 열고 닫는다 (기본 커서=첫 항목)', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={onClose} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/App.tsx')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('↓ 로 다음 항목으로 내려가 그것을 연다', async () => {
    const onOpen = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/components/QuickOpen.tsx')
  })

  it('↑ 는 맨 위에서 더 올라가지 않는다 (0 에서 멈춤)', async () => {
    const onOpen = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/App.tsx')
  })

  it('↓ 는 마지막 항목을 넘어가지 않는다', async () => {
    const onOpen = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('README.md')
  })

  it('필터로 목록이 바뀌면 커서가 맨 위로 돌아간다', async () => {
    const onOpen = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={() => {}} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // 커서 1
    fireEvent.change(input(), { target: { value: 'fuzzy' } })
    await waitFor(() => screen.getByText('fuzzy.ts'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    // 커서가 리셋되지 않았다면 엉뚱한(없는) 항목을 열 것이다
    expect(onOpen).toHaveBeenCalledWith('src/state/fuzzy.ts')
  })

  it('Esc 는 열지 않고 닫는다', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={onClose} />)
    await waitFor(() => screen.getByText('App.tsx'))
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('QuickOpen — 클릭/백드롭', () => {
  it('항목을 클릭하면 열고 닫는다', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(<QuickOpen onOpen={onOpen} onClose={onClose} />)
    await waitFor(() => screen.getByText('App.tsx'))
    fireEvent.click(screen.getByText('QuickOpen.tsx'))
    expect(onOpen).toHaveBeenCalledWith('src/components/QuickOpen.tsx')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('백드롭을 클릭하면 닫고, 팔레트 안쪽 클릭은 닫지 않는다', async () => {
    const onClose = vi.fn()
    const { container } = render(<QuickOpen onOpen={() => {}} onClose={onClose} />)
    await waitFor(() => screen.getByText('App.tsx'))

    fireEvent.click(container.querySelector('.dc-palette')!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.dc-modal')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
