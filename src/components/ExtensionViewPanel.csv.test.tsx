// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROWS, renderPanel, stubExport } from './extensionViewPanelTestBed'

// 확장 표를 **CSV 로 들고 나가는** 자리.
//
// 화면 그대로 내보낸다 — 거른 것도 정렬한 것도 지금 보고 있는 상태다.
// 다만 표가 200행까지만 그리는 것과 달리 **거른 전부**를 넘긴다.

afterEach(cleanup)

describe('CSV 로 내보내기', () => {
  /** 눌러서 넘어간 payload 하나 */
  async function exportOnce(rows?: Record<string, unknown>[]) {
    const send = stubExport()
    renderPanel(rows)
    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })
    return send.mock.calls[0]![0]
  }

  it('첫 줄이 열 이름이고 그 아래가 행이다', async () => {
    const payload = await exportOnce()

    expect(payload.csv.split('\r\n')).toEqual([
      'file,bytes,lines,ext',
      'package-lock.json,498000,11507,json',
      'src/App.tsx,9000,287,tsx',
      'src/main.ts,400,12,ts',
      '',
    ])
  })

  it('파일 이름은 뷰 제목에서 온다', async () => {
    const payload = await exportOnce()

    expect(payload.suggestedName).toBe('샘플 확장.csv')
  })

  it('거른 것·정렬한 것이 그대로 나간다 — 보는 것과 나가는 것이 같아야 한다', async () => {
    const send = stubExport()
    renderPanel()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /bytes/ }))

    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })

    const payload = send.mock.calls[0]![0]
    expect(payload.csv.split('\r\n').slice(0, 2)).toEqual(['file,bytes,lines,ext', 'src/main.ts,400,12,ts'])
  })

  it('내보낼 것이 없으면 누를 수 없다', () => {
    stubExport()
    renderPanel([])

    expect((screen.getByText('CSV 로 내보내기') as HTMLButtonElement).disabled).toBe(true)
  })

  it('저장하면 몇 행을 어디에 넣었는지 알린다 — 화면에는 흔적이 안 남는다', async () => {
    const onNotice = vi.fn()
    stubExport({ ok: true, path: '/tmp/결과.csv' })
    renderPanel(ROWS, onNotice)

    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })

    expect(onNotice).toHaveBeenCalledWith('3행을 저장했습니다: /tmp/결과.csv')
  })

  it('창을 닫은 것은 실패가 아니다 — 아무 말도 하지 않는다', async () => {
    const onNotice = vi.fn()
    stubExport({ ok: false, cancelled: true })
    renderPanel(ROWS, onNotice)

    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })

    expect(onNotice).not.toHaveBeenCalled()
  })

  it('못 쓰면 사유를 알린다', async () => {
    const onNotice = vi.fn()
    stubExport({ ok: false, reason: '권한이 없습니다' })
    renderPanel(ROWS, onNotice)

    await act(async () => {
      fireEvent.click(screen.getByText('CSV 로 내보내기'))
    })

    expect(onNotice).toHaveBeenCalledWith('내보내지 못했습니다: 권한이 없습니다')
  })
})
