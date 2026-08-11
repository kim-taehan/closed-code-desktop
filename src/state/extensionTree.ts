import type { ExtensionTreeNodePayload } from '../../shared/ipc/channels'

// 확장이 올린 트리의 **선택 규칙**. 그리기(`ExtensionTree.tsx`)와 갈라 둔다 —
// 여기 있는 것은 전부 순수 함수라 화면 없이 잠글 수 있고, 이 규칙이 곧
// 명령에 실려 나가는 값(`ExtensionRunCommandPayload.selection`)을 정한다.
//
// **잎만 고른다.** 가지를 고르면 그 아래 잎이 전부 딸려온다 — 가지 자체를 값으로 넘기면
// 확장이 "폴더" 와 "그 안의 파일들" 을 둘 다 다뤄야 하고, 폴더가 무엇인지는 확장마다 다르다.

export type TreeNode = ExtensionTreeNodePayload

/** 이 마디 아래의 잎 id 전부. 자신이 잎이면 자기 자신. */
export function leavesOf(node: TreeNode): string[] {
  if (!node.children || node.children.length === 0) return [node.id]
  return node.children.flatMap(leavesOf)
}

/** 여러 마디 아래의 잎 전부. */
export function leavesOfAll(nodes: TreeNode[]): string[] {
  return nodes.flatMap(leavesOf)
}

/** 가지의 체크 상태. 화면의 세 모양(빈칸·중간·체크)이 그대로 여기서 나온다. */
export type BranchState = 'none' | 'some' | 'all'

export function branchStateOf(node: TreeNode, picked: ReadonlySet<string>): BranchState {
  const leaves = leavesOf(node)
  // 잎이 없는 가지(빈 폴더)는 고를 것이 없다 — `all` 로 보면 빈 폴더가 체크된 채로 보인다
  if (leaves.length === 0) return 'none'
  const count = leaves.filter((id) => picked.has(id)).length
  if (count === 0) return 'none'
  return count === leaves.length ? 'all' : 'some'
}

/**
 * 마디 하나를 켜고 끈 결과.
 *
 * 가지를 누르면 **아래 잎 전부**가 같이 바뀐다. 지금 상태가 `all` 이면 끄고, 아니면 켠다 —
 * `some` 에서 누르면 켜지는 쪽이 사람의 기대에 맞다(고르는 중이었으므로).
 */
export function toggled(node: TreeNode, picked: ReadonlySet<string>): Set<string> {
  const next = new Set(picked)
  const leaves = leavesOf(node)
  const turnOff = branchStateOf(node, picked) === 'all'

  for (const id of leaves) {
    if (turnOff) next.delete(id)
    else next.add(id)
  }
  return next
}

/**
 * 트리에 없는 id 를 버린 선택.
 *
 * 목록을 다시 만들면(갱신) 사라진 항목이 생긴다. 그걸 남겨 두면 **화면에 보이지 않는 것이
 * 명령에 실려 나간다** — 사용자는 자기가 고른 적 없는 대상의 결과를 받게 된다.
 */
export function prunedSelection(nodes: TreeNode[], picked: ReadonlySet<string>): Set<string> {
  const alive = new Set(leavesOfAll(nodes))
  return new Set([...picked].filter((id) => alive.has(id)))
}

/**
 * 글자로 좁힌 트리. 빈 글이면 **그대로** 돌려준다.
 *
 * 화면 탭이 파일 경로 트리라 「관리자 목록 화면」을 찾으려면 그 파일이 어디 있는지 이미
 * 알아야 했다 — API 탭은 `GET /comment/delete/{id}` 처럼 이름이 뜻을 말하는데 이쪽은 아니다.
 *
 * **잎은 `id` 와 `label` 둘 다 본다.** 화면은 id 가 곧 경로라 `pages/Admin` 처럼 폴더까지
 * 걸리고, API 는 label 이 주소다. 가지는 **살아남은 자식이 있으면** 남는다 — 가지 이름만
 * 맞고 속이 비면 열어 봐야 빈 것을 알게 된다.
 *
 * 고른 것은 여기서 건드리지 않는다. 거르개는 **보는 조건**이지 선택이 아니다 —
 * 좁혀 둔 채 명령을 걸어도 안 보이는 곳에서 고른 것이 함께 나간다.
 */
export function matchingTree(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return nodes

  return nodes.flatMap((node) => {
    const children = node.children === undefined ? undefined : matchingTree(node.children, needle)
    if (children !== undefined) {
      return children.length === 0 ? [] : [{ ...node, children }]
    }
    const hit = node.id.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle)
    return hit ? [node] : []
  })
}

/** 칩 하나 — 경로 조각과 그 조각을 가진 잎의 수. */
export interface SegmentChip {
  segment: string
  count: number
}

/** 칩은 여섯 개까지. 사이드바 폭(약 300px)에서 두 줄을 넘기면 트리를 밀어낸다. */
const CHIP_LIMIT = 6
/** 잎 하나짜리 조각은 칩이 아니다 — 그 잎을 직접 고르는 것이 빠르다. */
const CHIP_MIN_LEAVES = 2
/**
 * **거의 모든 잎에 든 조각은 뺀다.** 눌러도 목록이 그대로면 변별력이 0이다.
 *
 * 실측으로 자른 값이다 (`_workspace/87_explore` 의 저장 데이터 두 벌):
 * - Spring 레포 280잎 — `src` 96.1% · `main` 93.6% · `com`/`java`/`skax`/`davis` 88.6% ·
 *   `portal` 86.8% 가 여기 걸려 빠지고, 남는 첫 칩이 `dto` 25.7% 다.
 *   **90% 로 잡으면 `com`·`java`·`skax`·`davis`(88.6%) 가 상위 넷을 차지해 칩이 무의미해진다.**
 * - React 레포 35잎 — `apps`/`src` 97.1% 는 빠지고 `pages` 80.0% · `features` 62.9% 는 남는다.
 *
 * 즉 특정 언어를 아는 목록이 아니라 **「눌러서 얼마나 줄어드나」** 하나로 가른다.
 */
const CHIP_MAX_SHARE = 0.85

/** 잎 경로의 **폴더 조각**들. 마지막 조각(자기 이름)은 뺀다. */
function foldersOf(id: string): Set<string> {
  const parts = id
    .split('/')
    .map((one) => one.trim())
    .filter((one) => one !== '')
  return new Set(parts.slice(0, -1))
}

/**
 * 경로 조각 칩 — 잦은 순 상위 여섯.
 *
 * 잎 평균 깊이가 5.75 라 하나를 고르려면 펼치기만 다섯 번이었다. 조각을 눌러 갈래를
 * 먼저 좁히면 두 번으로 준다.
 *
 * **무엇이 흔한지는 프로젝트가 정한다** — 확장자도 언어도 보지 않는다.
 */
export function segmentChips(nodes: TreeNode[]): SegmentChip[] {
  const leaves = leavesOfAll(nodes)
  if (leaves.length === 0) return []

  const count = new Map<string, number>()
  for (const id of leaves) {
    for (const folder of foldersOf(id)) count.set(folder, (count.get(folder) ?? 0) + 1)
  }

  return [...count]
    .filter(([, n]) => n >= CHIP_MIN_LEAVES && n <= leaves.length * CHIP_MAX_SHARE)
    // 같은 수면 이름순 — 목록이 렌더마다 흔들리지 않게
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CHIP_LIMIT)
    .map(([segment, n]) => ({ segment, count: n }))
}

/**
 * 경로에 그 조각이 든 잎만 남긴 트리. 빈 조각이면 **그대로** 돌려준다.
 *
 * `matchingTree` 와 갈라 둔다 — 저쪽은 글 조각을 아무 데나 걸지만(`main` 이 `domain.md` 에도
 * 걸린다) 이쪽은 **폴더 하나와 통째로 같을 때만** 건다. 둘은 겹쳐 쓴다(AND).
 */
export function segmentTree(nodes: TreeNode[], segment: string): TreeNode[] {
  if (segment === '') return nodes

  return nodes.flatMap((node) => {
    const children = node.children === undefined ? undefined : segmentTree(node.children, segment)
    if (children !== undefined) {
      return children.length === 0 ? [] : [{ ...node, children }]
    }
    return foldersOf(node.id).has(segment) ? [node] : []
  })
}
