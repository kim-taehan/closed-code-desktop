// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionTree } from './ExtensionTree'
import type { TreeNode } from '../state/extensionTree'

// 트리 줄에 붙는 **형편** (`ExtensionTreeNodePayload.state`).
//
// 바닥 진행 칸이 「비상 로그인이 도는 중」이라 말할 때 그 줄이 트리의 어디인가를 여기서 말한다.
// 무엇이 도는지·남았는지·터졌는지를 아는 것은 확장뿐이라 **데이터로 받는다** (`action` 과 같다).

const NODES: TreeNode[] = [
  { id: 'a.tsx', label: '비상 로그인', state: 'running' },
  { id: 'b.tsx', label: '공지 발송', state: 'waiting' },
  { id: 'c.tsx', label: '문서 업로드', state: 'failed' },
  { id: 'd.tsx', label: '관리자 목록', badge: '6', action: { label: '결과', command: 'x.show' } },
  { id: 'e.tsx', label: '아직 안 고른 것' },
]

function draw(nodes: TreeNode[] = NODES) {
  // 줄 버튼은 **받는 쪽이 있어야** 그려진다 — 없으면 누를 데 없는 버튼이 된다
  return render(
    <ExtensionTree nodes={nodes} picked={new Set()} onPickedChange={() => {}} onAction={() => {}} defaultOpen />,
  )
}

afterEach(cleanup)

describe('줄의 형편', () => {
  it('색이 아니라 **낱말**로 말한다 — 색맹·흑백에서도 갈려야 한다', () => {
    draw()

    expect(screen.getByText('도는 중')).toBeTruthy()
    expect(screen.getByText('대기')).toBeTruthy()
    expect(screen.getByText('실패')).toBeTruthy()
  })

  it('형편이 없는 줄에는 아무것도 안 붙는다 — 목록만 만든 트리가 조용해야 한다', () => {
    const { container } = draw([{ id: 'e.tsx', label: '아직 안 고른 것' }])

    expect(container.querySelector('.ext-tree__state')).toBeNull()
  })

  it('도는 줄만 바탕이 물든다 — 넷이 도는데 열다섯 줄이 다 물들면 초점이 사라진다', () => {
    const { container } = draw()

    const running = container.querySelectorAll('.ext-tree__row--running')
    expect(running).toHaveLength(1)
    expect(running[0]!.textContent).toContain('비상 로그인')
  })

  it('끝난 줄은 배지와 「결과」가 그대로다', () => {
    const { container } = draw()

    expect(screen.getByText('6')).toBeTruthy()
    // 배지가 붙은 줄은 예전대로 「끝남」 색을 입는다
    expect(container.querySelectorAll('.ext-tree__row--done')).toHaveLength(1)
  })

  it('**형편과 배지가 한 줄에 함께 선다** — 둘은 서로 다른 사실이다', () => {
    // 잡는 회귀: 형편이 배지를 이기게 두었더니 실패한 줄에서 지난 판의 결과가 사라졌다.
    // 배지는 *저장소에 몇 건이 있나*, 형편은 *이번 판이 어떻게 됐나* — 부정 관계가 아니다.
    draw([
      { id: 'x.tsx', label: '스트리밍 테스트', badge: '3', state: 'failed', action: { label: '결과', command: 'x.show' } },
    ])

    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('실패')).toBeTruthy()
    expect(screen.getByRole('button', { name: '결과' })).toBeTruthy()
  })

  it('형편은 갈래별로 다른 표시를 얻는다 — 셋이 같아 보이면 적은 뜻이 없다', () => {
    const { container } = draw()

    expect(container.querySelector('.ext-tree__state--running')).toBeTruthy()
    expect(container.querySelector('.ext-tree__state--waiting')).toBeTruthy()
    expect(container.querySelector('.ext-tree__state--failed')).toBeTruthy()
  })
})
