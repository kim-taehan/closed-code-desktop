// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionRunPane, elapsed } from './ExtensionRunPane'
import type { ExtensionProgressLine } from '../state/extensionProgressLog'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'

// 도는 동안의 **진행 칸**. 예전에는 여기가 한 줄이었다.
//
// 한 줄로는 원리상 못 하는 일이 둘 있었다: **겹쳐 도는 것**(확장이 넷을 동시에 돌리면
// 한 줄은 그중 하나밖에 못 적는다)과 **남기는 것**(다음 줄이 오면 앞 줄이 사라진다).
// 아래는 그 둘이 실제로 화면에 붙었는지를 본다.

const LINES: ExtensionProgressLine[] = [
  { at: 1, kind: 'note', text: '고른 대상 15개' },
  { at: 2, kind: 'done', text: '관리자 목록 — 6건' },
  { at: 3, kind: 'fail', text: '문서 업로드 — 못 이음' },
  { at: 4, kind: 'done', text: '스트리밍 테스트 — 3건' },
]

const RUNNING: ExtensionProgressPayload = {
  extension: 'test-scenario',
  text: '작성 중…',
  done: 2,
  total: 15,
  lanes: [
    { name: '비상 로그인', startedAt: 0, doing: '읽는 중' },
    { name: '로그인 API', startedAt: 0 },
  ],
}

afterEach(cleanup)

describe('겹쳐 도는 갈래', () => {
  it('갈래 수만큼 줄을 그린다 — 줄 수를 앱이 정하지 않는다', () => {
    render(<ExtensionRunPane progress={RUNNING} lines={[]} />)

    expect(screen.getByText('비상 로그인')).toBeTruthy()
    expect(screen.getByText('로그인 API')).toBeTruthy()
  })

  it('그 갈래가 지금 하는 일을 함께 적는다 — 없는 갈래에는 안 적는다', () => {
    const { container } = render(<ExtensionRunPane progress={RUNNING} lines={[]} />)

    expect(screen.getByText('읽는 중')).toBeTruthy()
    expect(container.querySelectorAll('.ext-lane__doing')).toHaveLength(1)
  })

  it('갈래가 없으면 칸을 안 그린다 — 한 줄로 도는 명령도 있다', () => {
    const { container } = render(
      <ExtensionRunPane progress={{ extension: 'ts', text: '훑는 중…' }} lines={[]} />,
    )

    expect(container.querySelector('.ext-run__lanes')).toBeNull()
    expect(screen.getByText('훑는 중…')).toBeTruthy()
  })

  it('분수는 있을 때만 — **없는 분모를 지어내지 않는다**', () => {
    const { container } = render(
      <ExtensionRunPane progress={{ extension: 'ts', text: '훑는 중…' }} lines={[]} />,
    )
    expect(container.querySelector('.ext-run__frac')).toBeNull()

    cleanup()
    render(<ExtensionRunPane progress={RUNNING} lines={[]} />)
    expect(screen.getByText('2/15')).toBeTruthy()
  })
})

describe('쌓인 줄', () => {
  it('마지막 몇 개만 그린다 — 전부 보는 자리는 본문 탭이다', () => {
    const { container } = render(<ExtensionRunPane progress={RUNNING} lines={LINES} />)

    const shown = [...container.querySelectorAll('.ext-line__text')].map((one) => one.textContent)
    expect(shown).toEqual(['관리자 목록 — 6건', '문서 업로드 — 못 이음', '스트리밍 테스트 — 3건'])
  })

  it('성패를 **글자로도** 가른다 — 색만으로 가르면 색맹·흑백에서 같아 보인다', () => {
    const { container } = render(<ExtensionRunPane progress={null} lines={LINES} />)

    const glyphs = [...container.querySelectorAll('.ext-line__glyph')].map((one) => one.textContent)
    expect(glyphs).toEqual(['✓', '✕', '✓'])
  })

  it('끝난 뒤에도 남는다 — 돌아온 사람에게 무엇이 됐는지 말해 주는 것이 이것뿐이다', () => {
    render(<ExtensionRunPane progress={null} lines={LINES} />)

    expect(screen.getByText('스트리밍 테스트 — 3건')).toBeTruthy()
    expect(screen.getByText('끝났습니다')).toBeTruthy()
  })
})

describe('경과 시각', () => {
  it('분:초로 적는다 — 시간 단위는 안 쓴다', () => {
    expect(elapsed(0)).toBe('0:00')
    expect(elapsed(9_000)).toBe('0:09')
    expect(elapsed(192_000)).toBe('3:12')
  })

  it('음수는 0 으로 — 시계가 어긋나도 「-1:-3」 같은 것을 보이지 않는다', () => {
    expect(elapsed(-5_000)).toBe('0:00')
  })
})
