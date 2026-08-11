// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ExtensionTreePane } from './ExtensionTreePane'
import type { TreeNode } from '../state/extensionTree'

// 트리 갈래의 조작 — **경로 조각 칩**과 좁히기 글.
//
// 실측: 잎 평균 깊이 5.75, 80%가 깊이 6~7 이라 하나를 고르는 데 펼치기 5회 + 체크 1회였다.
// 칩은 그 다섯 번을 한 번으로 줄이는 자리다. 여기서 잠그는 것은 「칩이 트리를 실제로 좁히나」와
// 「좁힌 것이 펼쳐진 채로 보이나」다 — 좁혀 놓고 접혀 있으면 찾아 놓고도 열어 봐야 한다.

/** 폴더 셋(controller 3 · dto 4 · service 3)에 잎 열. `app` 은 전부에 들어 칩에서 빠진다. */
const TREE: TreeNode[] = [
  {
    id: 'app',
    label: 'app',
    children: [
      {
        id: 'app/order',
        label: 'order',
        children: [
          { id: 'app/order/controller/OrderController.java', label: 'OrderController.java' },
          { id: 'app/order/dto/OrderDto.java', label: 'OrderDto.java' },
          { id: 'app/order/dto/OrderItemDto.java', label: 'OrderItemDto.java' },
          { id: 'app/order/service/OrderService.java', label: 'OrderService.java' },
        ],
      },
      {
        id: 'app/user',
        label: 'user',
        children: [
          { id: 'app/user/controller/UserController.java', label: 'UserController.java' },
          { id: 'app/user/controller/AuthController.java', label: 'AuthController.java' },
          { id: 'app/user/dto/UserDto.java', label: 'UserDto.java' },
          { id: 'app/user/dto/RoleDto.java', label: 'RoleDto.java' },
          { id: 'app/user/service/UserService.java', label: 'UserService.java' },
          { id: 'app/user/service/AuthService.java', label: 'AuthService.java' },
        ],
      },
    ],
  },
]

/** 폴더 일곱(잎 9·8·7·6·5·4·3) — 칩 여섯 자리보다 하나 많다. `p` 는 전부에 들어 빠진다. */
const WIDE: TreeNode[] = [
  ['a', 9],
  ['b', 8],
  ['c', 7],
  ['d', 6],
  ['e', 5],
  ['f', 4],
  ['g', 3],
].flatMap(([folder, count]) =>
  Array.from({ length: count as number }, (_, i) => ({ id: `p/${folder}/${i}.ts`, label: `${i}.ts` })),
)

/** 좁히기 상태는 원래 `ExtensionViewPanel` 이 쥔다 — 여기서는 그 자리를 대신한다. */
function Harness(props: {
  nodes?: TreeNode[] | undefined
  segment?: string
  onPickedChange?: (picked: Set<string>) => void
}) {
  const [find, setFind] = useState('')
  const [segment, setSegment] = useState(props.segment ?? '')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // 펼침도 원래 바깥(`useExtensionExpanded`)이 쥔다 — 여기서는 그 자리를 대신한다
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  return (
    <ExtensionTreePane
      nodes={'nodes' in props ? props.nodes : TREE}
      find={find}
      onFind={setFind}
      segment={segment}
      onSegment={setSegment}
      expanded={expanded}
      onToggle={(id) =>
        setExpanded((previous) => {
          const next = new Set(previous)
          if (!next.delete(id)) next.add(id)
          return next
        })
      }
      picked={picked}
      onPickedChange={(next) => {
        setPicked(next)
        props.onPickedChange?.(next)
      }}
      onOpen={() => {}}
      onAction={() => {}}
    />
  )
}

// 칩만 골라 본다 — 트리 행의 이름 버튼과 글자가 겹친다 (`app` 은 칩에도 행에도 있을 수 있다)
const chips = () => within(screen.getByRole('group', { name: '경로로 좁히기' }))
const chip = (name: string) => chips().getByRole('button', { name: new RegExp(`^${name}`) })
const leafNames = () =>
  screen
    .getAllByRole('checkbox')
    .map((box) => box.getAttribute('aria-label') ?? '')
    .filter((label) => label.endsWith('.java'))

afterEach(cleanup)

describe('경로 조각 칩', () => {
  it('그 프로젝트에서 실제로 갈리는 조각만 뜬다 — 확장자도 언어도 보지 않는다', () => {
    render(<Harness />)

    // 잎 수 순이고, 조각 뒤에 몇 개인지 붙는다
    expect(chip('dto').textContent).toBe('dto4')
    expect(chip('controller').textContent).toBe('controller3')
    // `app` 만 빠진다 — 열 잎 **전부**에 들어 눌러도 목록이 그대로다 (변별력 0)
    expect(chips().queryByRole('button', { name: /^app/ })).toBeNull()
  })

  it('누르면 그 조각을 가진 잎만 남고 **펼쳐진 채로** 보인다', () => {
    render(<Harness />)
    // 누르기 전에는 접혀 있다 — 잎이 하나도 안 보인다
    expect(leafNames()).toEqual([])

    fireEvent.click(chip('controller'))

    expect(leafNames()).toEqual([
      'OrderController.java',
      'UserController.java',
      'AuthController.java',
    ])
  })

  it('같은 칩을 다시 누르면 풀린다 — 푸는 자리를 따로 두지 않는다', () => {
    render(<Harness />)
    fireEvent.click(chip('controller'))
    expect(chip('controller').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip('controller'))

    expect(chip('controller').getAttribute('aria-pressed')).toBe('false')
    expect(leafNames()).toEqual([])
  })

  it('상위 여섯 밖의 조각을 걸어도 칩은 남고 **개수는 진짜 개수**다', () => {
    // 칩은 여섯까지인데, 탭을 옮기면 걸어 둔 조각이 그 탭의 여섯 안에 없을 수 있다.
    // 그때 칩을 지우면 되돌릴 자리가 사라지고, 남기되 0 이라 적으면 세 개가 걸려 있는데
    // 「0」 인 칩이 남는다. 실측에서 `controller`(24개)가 잦기 15위라 정확히 이 경우였다.
    render(<Harness nodes={WIDE} segment="g" />)

    expect(chip('g').textContent).toBe('g3')
    expect(chip('g').getAttribute('aria-pressed')).toBe('true')
    // 여섯 자리는 잦은 것들이 그대로 채운다 — 걸린 칩은 그 앞에 얹힌다
    expect(chips().getAllByRole('button')).toHaveLength(7)
  })

  it('칩과 글은 **겹쳐** 건다 (AND)', () => {
    render(<Harness />)
    fireEvent.click(chip('controller'))

    fireEvent.change(screen.getByPlaceholderText('이름으로 좁히기'), { target: { value: 'user' } })

    expect(leafNames()).toEqual(['UserController.java', 'AuthController.java'])
  })

  it('좁힌 채로 골라도 명령에 실리는 것은 잎 id 그대로다', () => {
    const onPickedChange = vi.fn()
    render(<Harness onPickedChange={onPickedChange} />)
    fireEvent.click(chip('controller'))

    fireEvent.click(screen.getByRole('checkbox', { name: 'OrderController.java' }))

    expect([...(onPickedChange.mock.calls[0]?.[0] ?? [])]).toEqual([
      'app/order/controller/OrderController.java',
    ])
  })
})

describe('빈 상태', () => {
  it('안 돌린 것과 돌렸는데 없는 것을 가른다 — 버튼이 안 먹은 것과 구분돼야 한다', () => {
    const { unmount } = render(<Harness nodes={undefined} />)
    expect(screen.getByText('아직 실행하지 않았습니다.')).toBeTruthy()
    unmount()

    render(<Harness nodes={[]} />)
    expect(screen.getByText('결과가 없습니다.')).toBeTruthy()
  })

  it('좁혀서 하나도 안 남으면 「찾은 것이 없습니다」', () => {
    render(<Harness />)

    fireEvent.change(screen.getByPlaceholderText('이름으로 좁히기'), { target: { value: '없는이름' } })

    expect(screen.getByText('찾은 것이 없습니다.')).toBeTruthy()
  })
})
