// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import type { ExtensionPanelTarget } from '../state/extensionPanels'

// **닫은 결과 탭을 다시 여는 자리.**
//
// 잡는 회귀: 결과는 올라오는 즉시 오른쪽에 뜨는데, 그것을 닫으면 **되열 길이 없었다.**
// 띄우는 효과의 의존값이 HTML 내용이라 탭을 닫아도 효과가 다시 돌지 않고, 앱에 있던
// 되열기 버튼은 `kind: 'html'` 뷰 본문 안에 있는데 그 뷰는 탭에서 빠지기 때문이다
// (`ExtensionViewPanel` 의 `tabViews`). 남은 길은 확장을 한 번 더 왕복시키는 명령뿐이었다.
//
// 그래서 아래 두 가지를 함께 잠근다: **탭 밖에서 닿을 수 있는가**, 그리고
// **내용이 안 바뀌어도 다시 열리는가**.

const TARGET: ExtensionPanelTarget = {
  id: 'ext:test-scenario',
  title: '테스트 시나리오',
  views: [
    { id: 'ts.screens', title: '화면', kind: 'tree' },
    // 이 뷰가 탭에서 빠진다 — 그래서 이 뷰 안의 버튼으로는 되열 수 없다
    { id: 'ts.result', title: '테스트 시나리오', kind: 'html' },
  ],
  extension: {
    name: 'test-scenario',
    displayName: '테스트 시나리오',
    version: '0.2.0',
    dir: '/확장/test-scenario',
    enabled: true,
    contributes: { commands: [{ id: 'ts.write', title: '테스트 시나리오 작성' }] },
  },
}

function Panel(props: {
  htmlByView: Record<string, string>
  onOpenHtml: (key: string, label: string, html: string, focus?: boolean) => void
  onRunCommand?: (commandId: string, selection?: string[]) => Promise<boolean>
  /** 줄 버튼을 보는 시험만 「결과」가 달린 마디를 준다 — 안 그러면 이름이 겹친다 */
  rowAction?: boolean
}) {
  return (
    <ExtensionViewPanel
      target={TARGET}
      projectId="p1"
      expanded={{ of: () => new Set<string>(), toggle: () => {} }}
      rowsByView={{}}
      treesByView={{
        'ts.screens': [
          props.rowAction === true
            ? { id: 'src/A.tsx', label: 'A.tsx', badge: '6', action: { label: '결과', command: 'ts.show' } }
            : { id: 'src/A.tsx', label: 'A.tsx' },
        ],
      }}
      htmlByView={props.htmlByView}
      running={[]}
      progressByExtension={{}}
      progressLog={{}}
      onCancel={() => {}}
      onRunCommand={props.onRunCommand ?? (() => Promise.resolve(true))}
      onOpenRow={() => {}}
      onOpenPath={() => {}}
      onOpenHtml={props.onOpenHtml}
      onNotice={() => {}}
    />
  )
}

afterEach(cleanup)

describe('결과 다시 열기', () => {
  it('아직 결과가 없으면 버튼을 그리지 않는다 — 눌러도 띄울 것이 없다', () => {
    render(<Panel htmlByView={{}} onOpenHtml={() => {}} />)

    expect(screen.queryByRole('button', { name: '결과' })).toBeNull()
  })

  it('결과가 있으면 탭 밖에서도 누를 수 있다 — html 뷰는 탭에 없다', () => {
    render(<Panel htmlByView={{ 'ts.result': '<p>6건</p>' }} onOpenHtml={() => {}} />)

    // 탭은 트리 뷰 하나뿐이라 아예 그려지지 않는다 (`ExtensionViewTabs` 는 둘 미만이면 안 그린다)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('button', { name: '결과' })).toBeTruthy()
  })

  it('내용이 그대로여도 다시 열린다 — 탭을 닫았을 때 되열 유일한 길이다', () => {
    const onOpenHtml = vi.fn()
    render(<Panel htmlByView={{ 'ts.result': '<p>6건</p>' }} onOpenHtml={onOpenHtml} />)

    // 올라오자마자 한 번 열린다
    expect(onOpenHtml).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '결과' }))

    // **같은 내용인데 또 불렸다** — 이 두 번째가 없던 것이 그 버그였다.
    // 넷째 인자(`focus`)만 다르다: 밀린 것과 눌린 것을 가르는 자리다
    expect(onOpenHtml).toHaveBeenCalledTimes(2)
    expect(onOpenHtml.mock.calls[1]!.slice(0, 3)).toEqual(onOpenHtml.mock.calls[0]!.slice(0, 3))
  })

  it('띄우는 것은 뷰 제목과 마지막 HTML 이다 — 확장을 다시 돌리지 않는다', () => {
    const onOpenHtml = vi.fn()
    render(<Panel htmlByView={{ 'ts.result': '<p>6건</p>' }} onOpenHtml={onOpenHtml} />)

    fireEvent.click(screen.getByRole('button', { name: '결과' }))

    const [key, label, html] = onOpenHtml.mock.calls[1]!
    expect(key).toContain('test-scenario')
    expect(label).toBe('테스트 시나리오')
    expect(html).toBe('<p>6건</p>')
  })
})

// **누른 것은 그 화면으로 데려가야 한다.**
//
// 잡는 회귀: 밀려오는 갱신이 탭을 도로 끌어오는 것을 막느라 「처음 한 번만 앞으로」로
// 두었는데(`useOpenHtmlTab`), 그 방어가 **사람이 누른 것까지** 막았다 — 눌러도 결과는
// 갱신되는데 화면은 그대로였다 (실측 불만: *"테스트 시나리오는 나오는데 그 화면으로
// 이동되지는 않네"*). 가르는 것은 `focus` 인자다.
describe('눌러서 열면 그 화면으로 간다', () => {
  /** `onOpenHtml` 호출들 중 `focus` 가 참인 것 */
  const focused = (calls: unknown[][]) => calls.filter((one) => one[3] === true)

  it('밀려온 갱신은 앞으로 끌어오지 않는다 — 도는 동안 다른 파일을 볼 수 있어야 한다', () => {
    const onOpenHtml = vi.fn()
    render(<Panel htmlByView={{ 'ts.result': '<p>6건</p>' }} onOpenHtml={onOpenHtml} />)

    expect(onOpenHtml).toHaveBeenCalledTimes(1)
    expect(focused(onOpenHtml.mock.calls)).toHaveLength(0)
  })

  it('바닥 「결과」를 누르면 데려간다', () => {
    const onOpenHtml = vi.fn()
    render(<Panel htmlByView={{ 'ts.result': '<p>6건</p>' }} onOpenHtml={onOpenHtml} />)

    fireEvent.click(screen.getByRole('button', { name: '결과' }))

    expect(focused(onOpenHtml.mock.calls)).toHaveLength(1)
  })

  it('트리 줄의 「결과」를 눌러도 데려간다 — 명령이 끝난 뒤에', async () => {
    const onOpenHtml = vi.fn()
    render(
      <Panel
        htmlByView={{ 'ts.result': '<p>6건</p>' }}
        onOpenHtml={onOpenHtml}
        onRunCommand={() => Promise.resolve(true)}
        rowAction
      />,
    )

    // 트리 줄의 버튼과 바닥 버튼이 둘 다 「결과」라 **앞의 것**(트리 줄)을 누른다
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '결과' })[0]!)
    })

    expect(focused(onOpenHtml.mock.calls)).toHaveLength(1)
  })

  it('명령이 실패하면 데려가지 않는다 — 볼 것이 없다', async () => {
    const onOpenHtml = vi.fn()
    render(
      <Panel
        htmlByView={{ 'ts.result': '<p>6건</p>' }}
        onOpenHtml={onOpenHtml}
        onRunCommand={() => Promise.resolve(false)}
        rowAction
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '결과' })[0]!)
    })

    expect(focused(onOpenHtml.mock.calls)).toHaveLength(0)
  })
})
