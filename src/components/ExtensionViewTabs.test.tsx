// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import type { ExtensionPanelTarget } from '../state/extensionPanels'
import type { ExtensionTreeNodePayload } from '../../shared/ipc/channels'
import { useExtensionExpanded } from '../state/useExtensionExpanded'

// 확장 하나가 뷰를 여럿 선언했을 때 — **패널 안의 탭**으로 갈린다.
//
// 예전에는 뷰마다 사이드바 선택기 항목이 하나씩 생겨, 확장 하나가 목록을 세 줄 차지했다.
// 여기서 잠그는 것은 그 뒤로 생긴 규칙들이다: 탭이 언제 뜨나 · 개수 배지가 무엇을 세나 ·
// **탭을 옮겨도 앞 탭에서 고른 것이 명령에 함께 실리나.**

const TARGET: ExtensionPanelTarget = {
  id: 'ext:test-scenario',
  title: '테스트 시나리오',
  views: [
    { id: 'ts.screens', title: '화면', kind: 'tree' },
    { id: 'ts.apis', title: 'API', kind: 'tree' },
    { id: 'ts.result', title: '결과', kind: 'html' },
  ],
  extension: {
    name: 'test-scenario',
    displayName: '테스트 시나리오',
    version: '0.2.0',
    dir: '/확장/test-scenario',
    enabled: true,
    contributes: { commands: [{ id: 'ts.write', title: '작성' }] },
  },
}

const SCREENS: ExtensionTreeNodePayload[] = [
  { id: 'src', label: 'src', children: [{ id: 'src/A.tsx', label: 'A.tsx' }, { id: 'src/B.tsx', label: 'B.tsx' }] },
]
const APIS: ExtensionTreeNodePayload[] = [{ id: 'GET /a', label: 'GET /a' }]

/**
 * 펼침은 원래 사이드바(`useExtensionPanel`)가 쥐고 패널에 내려 준다.
 * 여기서는 그 자리를 대신한다 — 정적 값으로 두면 펼치기 클릭이 아무 일도 하지 않는다.
 */
function Panel(props: { target?: ExtensionPanelTarget; onRunCommand?: (id: string, selection?: string[]) => Promise<boolean> }) {
  const expanded = useExtensionExpanded('p1')
  return (
    <ExtensionViewPanel
      target={props.target ?? TARGET}
      projectId="p1"
      expanded={expanded}
      rowsByView={{}}
      treesByView={
        (props.target ?? TARGET).views.length === 1
          ? { 'ts.screens': SCREENS }
          : { 'ts.screens': SCREENS, 'ts.apis': APIS }
      }
      htmlByView={{}}
      running={[]}
      progressByExtension={{}}
      progressLog={{}}
      onCancel={() => {}}
      onRunCommand={props.onRunCommand ?? (() => Promise.resolve(true))}
      onOpenRow={() => {}}
      onOpenPath={() => {}}
      onOpenHtml={() => {}}
      onNotice={() => {}}
    />
  )
}

function renderPanel(options: { onRunCommand?: (id: string, selection?: string[]) => Promise<boolean> } = {}) {
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { exportExtensionCsv: () => Promise.resolve({ ok: true }) }
  render(<Panel {...(options.onRunCommand ? { onRunCommand: options.onRunCommand } : {})} />)
}

/**
 * 이름으로 체크박스를 찾아 켠다 — 트리는 이름을 aria-label 로 쓴다.
 *
 * 잎이 가지 안에 있으면 **먼저 펼친다.** 트리는 접힌 채로 시작한다 (903개짜리가 통째로
 * 펼쳐지면 어디서 시작할지 알 수 없다).
 */
function check(label: string, openFirst?: string) {
  if (openFirst !== undefined) fireEvent.click(screen.getByRole('button', { name: '펼치기' }))
  fireEvent.click(screen.getByRole('checkbox', { name: label }))
}

afterEach(cleanup)

describe('뷰가 여럿이면 탭으로 갈린다', () => {
  it('선언 순서대로 탭이 서고 첫 탭을 보고 있다', () => {
    renderPanel()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['화면2', 'API1'])
    expect(screen.getByRole('tab', { name: /화면/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('배지는 **좁힌 것 / 그 탭 전부**다 — 여전히 고른 개수가 아니다', () => {
    // 고른 개수를 탭마다 나눠 붙이면 합계를 사람이 암산해야 한다. 고른 것은 한 줄이 합쳐 말한다.
    //
    // (2026-08-06) **정의가 바뀌었다.** 예전에는 "그 탭에 몇 개" 하나만 세어 좁혀도 배지가
    // 전체 수 그대로였다. 좁히기는 보고 있는 탭에만 걸리는 것이 아니라 **모든 탭에 같이**
    // 걸리는데, 예전 배지로는 「`A` 로 좁혔더니 API 탭은 0건」 이라는 사실이 아무 데도
    // 보이지 않았다 (`_workspace/87_explore` §3-4).
    renderPanel()
    check('A.tsx', 'src')

    // 고른 것은 배지를 흔들지 않는다
    expect(screen.getByRole('tab', { name: /화면/ }).textContent).toBe('화면2')

    fireEvent.change(screen.getByPlaceholderText('이름으로 좁히기'), { target: { value: 'A.tsx' } })

    expect(screen.getByRole('tab', { name: /화면/ }).textContent).toBe('화면1/2')
    // 안 보고 있는 탭도 같은 꼴로 — 여기서 0건인 것이 보인다
    expect(screen.getByRole('tab', { name: /API/ }).textContent).toBe('API0/1')
  })

  it('안 좁혔으면 숫자 하나만 — 늘 `2/2` 면 슬래시가 뜻을 잃는다', () => {
    renderPanel()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['화면2', 'API1'])
  })

  it('결과(html) 화면은 탭에 서지 않는다 — 본문 탭에 그려지므로 여긴 빈 껍데기다', () => {
    // 실측: 「오른쪽에 열었습니다」 한 줄뿐인 탭이 폭의 3분의 1을 먹었다 (기획서 §1-4).
    renderPanel()

    expect(screen.queryByRole('tab', { name: /결과/ })).toBeNull()
  })

  it('탭을 누르면 그 뷰를 그린다', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: /API/ }))

    expect(screen.getByRole('checkbox', { name: 'GET /a' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'A.tsx' })).toBeNull()
  })
})

describe('탭을 넘나들며 고른 것', () => {
  it('앞 탭의 선택이 풀리지 않는다', () => {
    // 풀리면 화면과 API 를 한 번에 못 돌리고 두 번 나눠 돌려야 한다.
    renderPanel()
    check('A.tsx', 'src')

    fireEvent.click(screen.getByRole('tab', { name: /API/ }))
    fireEvent.click(screen.getByRole('tab', { name: /화면/ }))

    // 펼침도 남는다 — 다시 펼칠 것이 없다 (`useExtensionExpanded`).
    // 예전에는 여기서 트리가 도로 접혀 있어 열어 봐야 선택이 보였다.
    expect((screen.getByRole('checkbox', { name: 'A.tsx' }) as HTMLInputElement).checked).toBe(true)
  })

  it('명령에는 **합쳐서** 실린다', () => {
    const onRunCommand = vi.fn((_id: string, _selection?: string[]) => Promise.resolve(true))
    renderPanel({ onRunCommand })
    check('A.tsx', 'src')
    fireEvent.click(screen.getByRole('tab', { name: /API/ }))
    check('GET /a')

    fireEvent.click(screen.getByText('작성'))

    expect(onRunCommand.mock.calls[0]?.[1]?.sort()).toEqual(['GET /a', 'src/A.tsx'])
  })

  it('고른 것을 탭별로 나누어 적는다 — 지금 안 보는 탭의 것도 나간다', () => {
    renderPanel()
    check('A.tsx', 'src')
    fireEvent.click(screen.getByRole('tab', { name: /API/ }))
    check('GET /a')

    expect(screen.getByText('화면 1개 · API 1개 골랐습니다')).toBeTruthy()
  })

  it('아무것도 안 골랐으면 selection 을 아예 넘기지 않는다', () => {
    // 빈 배열은 "고른 결과가 없다" 로 읽혀 확장이 거절할 근거를 잃는다.
    const onRunCommand = vi.fn((_id: string, _selection?: string[]) => Promise.resolve(true))
    renderPanel({ onRunCommand })

    fireEvent.click(screen.getByText('작성'))

    expect(onRunCommand).toHaveBeenCalledWith('ts.write', undefined)
  })
})

describe('뷰가 하나뿐이면', () => {
  it('탭 줄을 그리지 않는다 — 고를 것이 없는 탭은 자리만 먹는다', () => {
    const single: ExtensionPanelTarget = { ...TARGET, views: [TARGET.views[0]!] }
    ;(window as unknown as { davis: unknown }).davis = { exportExtensionCsv: () => Promise.resolve({ ok: true }) }
    render(<Panel target={single} />)

    expect(screen.queryAllByRole('tab')).toEqual([])
  })
})
