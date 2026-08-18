// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionTree } from './ExtensionTree'
import type { TreeNode } from '../state/extensionTree'

// **접히지 않는 구획** (`ExtensionTreeNodePayload.section`) 과 **둘째 줄** (`detail`).
//
// 폴더 가지는 접을 수 있어야 한다 — 903줄짜리가 통째로 펼쳐지면 어디서 시작할지 알 수 없다.
// 그런데 상태로 가른 무리(「미작성」·「작성완료」)에서 접기는 성격이 반대다: 개수가 적고,
// 접으면 그 확장을 여는 이유인 **「무엇이 비었나」가 통째로 사라진다.**
//
// 무엇이 폴더고 무엇이 구획인지는 확장만 아니까 데이터로 받는다 (`action` 과 같은 규칙).
// 그래서 이 시험이 보는 것은 **두 갈래가 서로 다르게 그려지는가**다 — 구획을 도입하며
// 폴더 쪽이 함께 펼쳐져 버리면 그 903줄이 돌아온다.

const SECTION: TreeNode[] = [
  {
    id: 'group:todo',
    label: '미작성',
    section: true,
    badge: '2',
    children: [
      { id: 'templates/matches.html', label: '경기 목록 조회', detail: 'templates/matches.html' },
      { id: 'templates/new.html', label: '경기 등록', detail: 'templates/new.html · 직접' },
    ],
  },
]

const FOLDER: TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    children: [{ id: 'src/a.tsx', label: 'a.tsx' }],
  },
]

/** `defaultOpen` 을 **주지 않는다** — 처음 열었을 때의 모습이 이 시험의 표적이다. */
function draw(nodes: TreeNode[]) {
  return render(<ExtensionTree nodes={nodes} picked={new Set()} onPickedChange={() => {}} onAction={() => {}} />)
}

afterEach(cleanup)

describe('구획은 접히지 않는다', () => {
  it('아무것도 안 시켜도 자식이 보인다 — 처음 열었을 때 빈 화면이면 안 된다', () => {
    draw(SECTION)

    expect(screen.getByText('경기 목록 조회')).toBeTruthy()
    expect(screen.getByText('경기 등록')).toBeTruthy()
  })

  it('폴더 가지는 예전대로 접힌 채로 뜬다 — 구획을 들이며 903줄을 되살리지 않는다', () => {
    draw(FOLDER)

    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.queryByText('a.tsx')).toBeNull()
  })

  it('꺾쇠도 체크박스도 없다 — 누를 수 없는 라벨이라야 폴더와 갈린다', () => {
    const { container } = draw(SECTION)
    const head = container.querySelector('.ext-tree__row--section')

    expect(head).toBeTruthy()
    expect(head?.querySelector('.ext-tree__twist')).toBeNull()
    expect(head?.querySelector('.ext-tree__check')).toBeNull()
    // 자식 줄에는 둘 다 그대로 있다 — 없앤 것은 구획 머리뿐이다
    expect(container.querySelectorAll('.ext-tree__check')).toHaveLength(2)
  })

  it('구획 머리는 「끝남」으로 물들지 않는다 — 그 배지는 끝난 수가 아니라 든 수다', () => {
    const { container } = draw(SECTION)

    expect(screen.getByText('2')).toBeTruthy()
    expect(container.querySelectorAll('.ext-tree__row--done')).toHaveLength(0)
  })

  // 폴더 가지는 체크하면 몇 개가 딸려 나가는지 미리 말한다. 구획은 체크할 수가 없어
  // 그 숫자가 뜻이 없다 — 개수를 배지와 둘로 적으면 「미작성 2 2」가 된다.
  it('구획에는 딸려올 개수를 안 적는다 — 같은 수가 두 번 서면 안 된다', () => {
    const { container } = draw(SECTION)

    expect(container.querySelector('.ext-tree__row--section .ext-tree__count')).toBeNull()
  })
})

describe('줄 버튼이 여럿일 때', () => {
  // 하나로는 못 담는 짝이 실제로 나왔다: 이미 쓴 시나리오는 **보고** 나서 **다시** 만든다.
  // 하나만 둘 수 있으면 둘 중 하나가 딴 데로 가고, 그 줄에서 하려던 일이 두 자리로 갈린다.
  it('선언한 순서대로 나란히 그린다', () => {
    const hit: string[] = []
    render(
      <ExtensionTree
        nodes={[
          {
            id: 'a.html',
            label: '승률 대시보드',
            actions: [
              { label: '보기', command: 'x.show' },
              { label: '다시', command: 'x.write' },
            ],
          },
        ]}
        picked={new Set()}
        onPickedChange={() => {}}
        onAction={(command, id) => hit.push(`${command}:${id}`)}
      />,
    )

    const labels = Array.from(document.querySelectorAll('.ext-tree__action')).map((one) => one.textContent)
    expect(labels).toEqual(['보기', '다시'])

    screen.getByRole('button', { name: '다시' }).click()
    expect(hit).toEqual(['x.write:a.html'])
  })

  it('하나짜리 action 과 함께 오면 이어서 그린다 — 서로 지우지 않는다', () => {
    render(
      <ExtensionTree
        nodes={[
          { id: 'a', label: 'A', action: { label: '결과', command: 'x.show' }, actions: [{ label: '다시', command: 'x.run' }] },
        ]}
        picked={new Set()}
        onPickedChange={() => {}}
        onAction={() => {}}
      />,
    )

    expect(Array.from(document.querySelectorAll('.ext-tree__action')).map((one) => one.textContent)).toEqual(['결과', '다시'])
  })
})

describe('둘째 줄은 이름만으로 못 가리는 것을 말한다', () => {
  it('경로가 이름 밑에 그려진다 — 툴팁은 마우스가 없는 사람에게 없는 것과 같다', () => {
    draw(SECTION)

    expect(screen.getByText('templates/matches.html')).toBeTruthy()
    expect(screen.getByText('templates/new.html · 직접')).toBeTruthy()
  })

  it('둘째 줄이 없는 줄은 예전 그대로 한 줄이다', () => {
    const { container } = draw(FOLDER)

    expect(container.querySelector('.ext-tree__detail')).toBeNull()
  })
})
