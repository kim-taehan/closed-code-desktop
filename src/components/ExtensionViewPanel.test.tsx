// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { files, renderPanel, stubExport } from './extensionViewPanelTestBed'

// 확장 뷰 하나의 본문 — 확장자 거르개와 열 정렬.
//
// 순수 판정은 `state/extensionRowFilter.test.ts`·`state/extensionRowSort.test.ts` 가 본다.
// 여기서 보는 것은 **화면에 붙었는가** 다: 거르개가 언제 뜨고, 눌렀을 때 표가 실제로 바뀌는가.
// 내보내기는 `ExtensionViewPanel.csv.test.tsx` 가 본다.

afterEach(cleanup)

describe('확장자 거르개', () => {
  it('결과에 있는 확장자만 항목으로 올린다', () => {
    renderPanel()

    const options = [...screen.getByRole('combobox').querySelectorAll('option')]
    expect(options.map((option) => option.textContent)).toEqual(['전체', 'json', 'ts', 'tsx'])
  })

  it('고르면 그 확장자만 남는다', () => {
    renderPanel()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })

    expect(files()).toEqual(['src/App.tsx'])
  })

  it('전체로 되돌릴 수 있다', () => {
    renderPanel()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    expect(files()).toEqual(['package-lock.json'])

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(files()).toHaveLength(3)
  })

  it('확장자 없는 파일도 고를 수 있다 — 빈 값이 「전체」와 겹치지 않는다', () => {
    // 값을 확장자 자체로 쓰면 "확장자 없음" 이 빈 문자열이라 「전체」와 구분되지 않는다.
    renderPanel([{ file: 'Makefile', bytes: 30 }, { file: 'a.ts', bytes: 10 }])

    const select = screen.getByRole('combobox')
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      '전체',
      'ts',
      '(확장자 없음)',
    ])

    fireEvent.change(select, { target: { value: '1' } })
    expect(files()).toEqual(['Makefile'])
  })

  it('확장자가 한 종류뿐이면 거르개를 그리지 않는다 — 고를 것이 없다', () => {
    renderPanel([{ file: 'a.ts', bytes: 10 }, { file: 'b.ts', bytes: 20 }])

    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

describe('열 정렬', () => {
  it('처음에는 확장이 준 순서 그대로다', () => {
    renderPanel()

    expect(files()).toEqual(['package-lock.json', 'src/App.tsx', 'src/main.ts'])
  })

  it('열 머리를 누르면 그 열로 정렬한다 — 수 칸은 수로', () => {
    renderPanel()

    // 첫 클릭은 내림차순. 줄 수가 제일 많은 것이 위로 온다
    fireEvent.click(screen.getByRole('button', { name: /lines/ }))
    expect(files()).toEqual(['package-lock.json', 'src/App.tsx', 'src/main.ts'])

    // 다시 누르면 오름차순
    fireEvent.click(screen.getByRole('button', { name: /lines/ }))
    expect(files()).toEqual(['src/main.ts', 'src/App.tsx', 'package-lock.json'])
  })

  it('세 번째로 누르면 확장이 준 순서로 돌아간다', () => {
    renderPanel()
    const header = screen.getByRole('button', { name: /file/ })

    fireEvent.click(header)
    expect(files()[0]).toBe('src/main.ts')

    fireEvent.click(header)
    fireEvent.click(header)

    expect(files()).toEqual(['package-lock.json', 'src/App.tsx', 'src/main.ts'])
  })

  it('지금 정렬 중인 열만 방향을 표시한다', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /bytes/ }))

    const headers = [...document.querySelectorAll('th')]
    const sorted = headers.filter((header) => header.getAttribute('aria-sort') !== 'none')
    expect(sorted).toHaveLength(1)
    expect(sorted[0]?.textContent).toContain('bytes')
    expect(sorted[0]?.getAttribute('aria-sort')).toBe('descending')
  })

  it('거르고 나서도 정렬이 유지된다', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /bytes/ }))
    fireEvent.click(screen.getByRole('button', { name: /bytes/ }))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(files()).toEqual(['src/main.ts', 'src/App.tsx', 'package-lock.json'])
  })
})

describe('전부 보기', () => {
  const MANY = Array.from({ length: 205 }, (_, i) => ({
    file: `f${String(i).padStart(3, '0')}.ts`,
    bytes: 205 - i,
  }))

  it('처음에는 200행만 그리고 남은 수를 알린다', () => {
    stubExport()
    renderPanel(MANY)

    expect(files()).toHaveLength(200)
    expect(screen.getByText(/외 5개/)).toBeTruthy()
  })

  it('누르면 전부 그린다', () => {
    stubExport()
    renderPanel(MANY)

    fireEvent.click(screen.getByText(/전부 보기/))

    expect(files()).toHaveLength(205)
    expect(screen.queryByText(/전부 보기/)).toBeNull()
  })

  it('안 펼쳐도 CSV 에는 전부 나간다 — 내보내기는 눈으로 보는 것이 아니다', async () => {
    const send = stubExport()
    renderPanel(MANY)

    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })

    // 머리글 1줄 + 205행 + 끝의 빈 줄
    expect(send.mock.calls[0]![0].csv.split('\r\n')).toHaveLength(207)
  })
})
