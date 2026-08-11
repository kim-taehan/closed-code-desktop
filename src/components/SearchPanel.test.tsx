// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SearchPanel } from './SearchPanel'
import type { SearchResultPayload } from '../../shared/ipc/searchPayloads'

// 내용 검색: 2글자 미만은 안 돌고, 디바운스/Enter 로 검색하며,
// 늦게 온 옛 응답은 버린다. 그 행동을 본다.

function result(over: Partial<SearchResultPayload> = {}): SearchResultPayload {
  return { matches: [], truncated: false, ...over }
}

function stubDavis(overrides: Record<string, unknown> = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = {
    searchText: vi.fn(() => Promise.resolve(result())),
    ...overrides,
  }
}

function input() {
  return screen.getByLabelText('찾을 내용') as HTMLInputElement
}

beforeEach(() => stubDavis())
afterEach(cleanup)

describe('SearchPanel — 최소 길이', () => {
  it('빈 쿼리에는 입력 안내를 보인다', () => {
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByText('찾을 내용을 입력하세요')).toBeTruthy()
  })

  it('1글자면 검색하지 않고 "2글자 이상" 안내를 보인다', async () => {
    const searchText = vi.fn(() => Promise.resolve(result()))
    stubDavis({ searchText })
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    fireEvent.change(input(), { target: { value: 'a' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(searchText).not.toHaveBeenCalled()
    expect(screen.getByText('2글자 이상 입력하세요')).toBeTruthy()
  })
})

describe('SearchPanel — 검색 실행', () => {
  it('Enter 로 즉시 검색하고 결과를 그린다 (곳 수 + 미리보기)', async () => {
    stubDavis({
      searchText: vi.fn(() =>
        Promise.resolve(
          result({ matches: [{ file: 'a.ts', line: 3, preview: 'hello world' }] }),
        ),
      ),
    })
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    fireEvent.change(input(), { target: { value: 'hello' } })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => screen.getByText('hello world'))
    expect(screen.getByText('1곳')).toBeTruthy()
    expect(screen.getByText(':3')).toBeTruthy()
  })

  it('디바운스 후 저절로 검색한다 (Enter 없이)', async () => {
    const searchText = vi.fn(() => Promise.resolve(result()))
    stubDavis({ searchText })
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    fireEvent.change(input(), { target: { value: 'abc' } })
    await waitFor(() => expect(searchText).toHaveBeenCalledWith({ query: 'abc' }))
  })

  it('결과가 없으면 "찾지 못했습니다"', async () => {
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    fireEvent.change(input(), { target: { value: 'zzz' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => screen.getByText('찾지 못했습니다'))
  })

  it('잘렸으면 그 사실을 알린다', async () => {
    stubDavis({
      searchText: vi.fn(() =>
        Promise.resolve(
          result({ matches: [{ file: 'a.ts', line: 1, preview: 'x' }], truncated: true }),
        ),
      ),
    })
    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    fireEvent.change(input(), { target: { value: 'xx' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => screen.getByText('결과가 많아 일부만 보여줍니다'))
  })

  it('결과를 클릭하면 파일을 열고 닫는다', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    stubDavis({
      searchText: vi.fn(() =>
        Promise.resolve(result({ matches: [{ file: 'a.ts', line: 3, preview: 'hit' }] })),
      ),
    })
    render(<SearchPanel onOpen={onOpen} onClose={onClose} />)
    fireEvent.change(input(), { target: { value: 'hit' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => screen.getByText('hit'))
    fireEvent.click(screen.getByText('hit'))
    expect(onOpen).toHaveBeenCalledWith('a.ts')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SearchPanel — 늦은 응답 버리기', () => {
  it('옛 요청이 늦게 도착해도 최신 결과를 덮지 않는다', async () => {
    let resolveFirst!: (r: SearchResultPayload) => void
    const first = new Promise<SearchResultPayload>((res) => (resolveFirst = res))
    const second = Promise.resolve(result({ matches: [{ file: 'new.ts', line: 1, preview: '새 결과' }] }))
    const searchText = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    stubDavis({ searchText })

    render(<SearchPanel onOpen={() => {}} onClose={() => {}} />)
    // 첫 검색(느림) → 둘째 검색(빠름)
    fireEvent.change(input(), { target: { value: 'ab' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.change(input(), { target: { value: 'abc' } })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => screen.getByText('새 결과'))
    // 이제 옛 응답이 뒤늦게 도착해도 화면이 바뀌면 안 된다
    resolveFirst(result({ matches: [{ file: 'old.ts', line: 1, preview: '옛 결과' }] }))
    await Promise.resolve()
    await waitFor(() => screen.getByText('새 결과'))
    expect(screen.queryByText('옛 결과')).toBeNull()
  })
})

describe('SearchPanel — 닫기', () => {
  it('Esc 로 닫는다', () => {
    const onClose = vi.fn()
    render(<SearchPanel onOpen={() => {}} onClose={onClose} />)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('백드롭 클릭으로 닫는다', () => {
    const onClose = vi.fn()
    const { container } = render(<SearchPanel onOpen={() => {}} onClose={onClose} />)
    fireEvent.click(container.querySelector('.dc-modal')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
