// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import type { ExtensionPanelTarget } from '../state/extensionPanels'
import { useExtensionExpanded } from '../state/useExtensionExpanded'

// **주 행동이 끝나면 고른 것을 푼다.**
//
// 왜: 작성이 끝나도 체크가 그대로 남아, 다음에 다른 대상을 고르려면 앞엣것을 하나씩
// 지워야 했다. 수십 개를 골라 돌린 뒤에는 그것이 곧 수십 번의 클릭이다.
//
// **좁게 푼다.** 푸는 자리는 아래 큰 버튼(주 행동)이 **성공했을 때** 하나뿐이다:
//   - `⋯` 의 마무리 명령(내보내기·초기화)은 고른 것을 쓰지 않는다 — 풀면 사용자는
//     무엇을 눌렀든 선택이 사라지는 것으로 겪는다
//   - 줄의 「결과」 버튼은 자기 마디만 싣는다 — 결과를 봤다고 선택이 날아가면 안 된다
//   - 실패·중단에는 안 푼다 — 그 선택이 곧 **다시 돌릴 대상**이다

const TARGET: ExtensionPanelTarget = {
  id: 'ext:test-scenario',
  title: '테스트 시나리오',
  views: [{ id: 'ts.screens', title: '화면', kind: 'tree' }],
  extension: {
    name: 'test-scenario',
    displayName: '테스트 시나리오',
    version: '1.0.0',
    dir: '/확장/test-scenario',
    enabled: true,
    contributes: {
      commands: [
        { id: 'ts.write', title: '작성' },
        { id: 'ts.export', title: 'MD 내보내기', placement: 'menu' },
      ],
    },
  },
}

const TREE = [
  {
    id: 'src',
    label: 'src',
    children: [
      { id: 'src/A.tsx', label: 'A.tsx', action: { label: '결과', command: 'ts.show' } },
      { id: 'src/B.tsx', label: 'B.tsx' },
    ],
  },
]

function Panel(props: { run: (id: string, selection?: string[]) => Promise<boolean> }) {
  const expanded = useExtensionExpanded('p1')
  return (
    <ExtensionViewPanel
      target={TARGET}
      projectId="p1"
      expanded={expanded}
      rowsByView={{}}
      treesByView={{ 'ts.screens': TREE }}
      htmlByView={{}}
      running={[]}
      progressByExtension={{}}
      progressLog={{}}
      onCancel={() => {}}
      onRunCommand={props.run}
      onOpenRow={() => {}}
      onOpenPath={() => {}}
      onOpenHtml={() => {}}
      onNotice={() => {}}
    />
  )
}

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

/** 둘 다 고른 상태로 세운다. 트리는 접힌 채 시작하므로 **먼저 펼친다**. */
function renderPanel(run: (id: string, selection?: string[]) => Promise<boolean>) {
  render(<Panel run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '펼치기' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'A.tsx' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'B.tsx' }))
  expect(box('A.tsx').checked).toBe(true)
}

afterEach(cleanup)

describe('작성이 끝나면 체크가 풀린다', () => {
  it('주 행동이 성공하면 전부 풀린다', async () => {
    renderPanel(() => Promise.resolve(true))

    fireEvent.click(screen.getByText('작성'))

    await waitFor(() => expect(box('A.tsx').checked).toBe(false))
    expect(box('B.tsx').checked).toBe(false)
    expect(screen.getByText('고른 것이 없습니다')).toBeTruthy()
  })

  // 그 선택이 곧 다시 돌릴 대상이다 — 풀면 수십 개를 처음부터 다시 골라야 한다
  it('실패하거나 중단하면 그대로 둔다', async () => {
    renderPanel(() => Promise.resolve(false))

    fireEvent.click(screen.getByText('작성'))

    await waitFor(() => expect(box('A.tsx').checked).toBe(true))
    expect(box('B.tsx').checked).toBe(true)
  })

  it('`⋯` 의 마무리 명령은 풀지 않는다 — 고른 것을 쓰지 않는다', async () => {
    renderPanel(() => Promise.resolve(true))

    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    fireEvent.click(screen.getByText('MD 내보내기'))

    await waitFor(() => expect(box('A.tsx').checked).toBe(true))
  })

  it('줄의 「결과」 버튼은 풀지 않는다 — 자기 마디만 싣는다', async () => {
    const carried: (string[] | undefined)[] = []
    renderPanel((_id, selection) => {
      carried.push(selection)
      return Promise.resolve(true)
    })

    fireEvent.click(screen.getByText('결과'))

    await waitFor(() => expect(carried).toEqual([['src/A.tsx']]))
    expect(box('A.tsx').checked).toBe(true)
    expect(box('B.tsx').checked).toBe(true)
  })
})
