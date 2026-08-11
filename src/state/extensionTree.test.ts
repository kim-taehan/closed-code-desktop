import { describe, expect, it } from 'vitest'
import {
  branchStateOf,
  leavesOf,
  leavesOfAll,
  matchingTree,
  prunedSelection,
  segmentChips,
  segmentTree,
  toggled,
  type TreeNode,
} from './extensionTree'

// 트리 선택 규칙. **이 규칙이 곧 명령에 실려 나가는 값**이라 화면 없이 여기서 잠근다.

const TREE: TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    children: [
      {
        id: 'src/pages/AdminMgmt',
        label: 'AdminMgmt',
        children: [
          { id: 'src/pages/AdminMgmt/List.tsx', label: 'List.tsx' },
          { id: 'src/pages/AdminMgmt/Add.tsx', label: 'Add.tsx' },
        ],
      },
      { id: 'src/Login.tsx', label: 'Login.tsx' },
    ],
  },
]

const branch = TREE[0] as TreeNode
const adminMgmt = (branch.children as TreeNode[])[0] as TreeNode

describe('잎만 고른다', () => {
  it('가지 아래의 잎을 전부 모은다', () => {
    expect(leavesOf(branch)).toEqual([
      'src/pages/AdminMgmt/List.tsx',
      'src/pages/AdminMgmt/Add.tsx',
      'src/Login.tsx',
    ])
  })

  it('잎 자신은 자기 하나다', () => {
    expect(leavesOf({ id: 'a.tsx', label: 'a.tsx' })).toEqual(['a.tsx'])
  })

  it('가지를 켜면 아래 잎이 전부 딸려온다', () => {
    // 가지 자체를 값으로 넘기면 확장이 "폴더" 와 "그 안의 파일들" 을 둘 다 다뤄야 한다.
    const picked = toggled(adminMgmt, new Set())

    expect([...picked]).toEqual(['src/pages/AdminMgmt/List.tsx', 'src/pages/AdminMgmt/Add.tsx'])
  })

  it('전부 켜진 가지를 누르면 전부 꺼진다', () => {
    const all = toggled(branch, new Set())

    expect(toggled(branch, all).size).toBe(0)
  })

  it('일부만 켜진 가지를 누르면 **켜진다**', () => {
    // 고르는 중이었으므로 채우는 쪽이 사람의 기대에 맞다.
    const some = new Set(['src/pages/AdminMgmt/List.tsx'])

    expect(toggled(adminMgmt, some).size).toBe(2)
  })
})

describe('가지의 체크 모양', () => {
  it('빈칸 · 중간 · 체크 세 가지가 나온다', () => {
    expect(branchStateOf(adminMgmt, new Set())).toBe('none')
    expect(branchStateOf(adminMgmt, new Set(['src/pages/AdminMgmt/List.tsx']))).toBe('some')
    expect(branchStateOf(adminMgmt, new Set(leavesOf(adminMgmt)))).toBe('all')
  })

  it('잎이 없는 가지는 체크된 것으로 보이지 않는다', () => {
    // `all` 로 보면 빈 폴더가 체크된 채로 뜬다 — 고를 것이 없는데 골라진 것처럼 보인다.
    expect(branchStateOf({ id: '빈폴더', label: '빈폴더', children: [] }, new Set())).toBe('none')
  })
})

describe('목록을 다시 만들면', () => {
  it('사라진 항목의 선택을 버린다', () => {
    // 남겨 두면 **화면에 보이지 않는 것이 명령에 실려 나간다** — 사용자는 자기가 고른 적
    // 없는 대상의 결과를 받는다.
    const picked = new Set(['src/Login.tsx', '지워진파일.tsx'])

    expect([...prunedSelection(TREE, picked)]).toEqual(['src/Login.tsx'])
  })
})

describe('글자로 좁히기', () => {
  const PAGES: TreeNode[] = [
    {
      id: 'src/pages',
      label: 'pages',
      children: [
        { id: 'src/pages/AdminMgmtList.tsx', label: 'AdminMgmtList.tsx' },
        { id: 'src/pages/Login.tsx', label: 'Login.tsx' },
      ],
    },
    { id: 'src/main.ts', label: 'main.ts' },
  ]

  it('빈 글이면 그대로다', () => {
    expect(matchingTree(PAGES, '   ')).toBe(PAGES)
  })

  it('잎은 id 와 label 둘 다 본다 — 폴더까지 친 것도 걸린다', () => {
    expect(leavesOfAll(matchingTree(PAGES, 'admin'))).toEqual(['src/pages/AdminMgmtList.tsx'])
    expect(leavesOfAll(matchingTree(PAGES, 'pages/log'))).toEqual(['src/pages/Login.tsx'])
  })

  it('대소문자를 가리지 않는다', () => {
    expect(leavesOfAll(matchingTree(PAGES, 'LOGIN'))).toEqual(['src/pages/Login.tsx'])
  })

  it('가지는 살아남은 자식이 있을 때만 남는다', () => {
    // 가지 이름만 맞고 속이 비면 열어 봐야 빈 것을 알게 된다
    expect(matchingTree(PAGES, 'pages').map((node) => node.id)).toEqual(['src/pages'])
    expect(matchingTree(PAGES, '없는것')).toEqual([])
  })

  it('맞는 것이 없으면 빈 배열이다 — 부르는 쪽이 「찾은 것이 없습니다」로 갈린다', () => {
    expect(matchingTree(PAGES, 'zzz')).toEqual([])
  })
})

/** 잎만 있는 평평한 트리 — 칩은 잎의 **경로**만 보므로 접힌 모양과 무관하다. */
function flat(ids: string[]): TreeNode[] {
  return ids.map((id) => ({ id, label: id.slice(id.lastIndexOf('/') + 1) }))
}

describe('경로 조각 칩', () => {
  it('잦은 순으로 센다 — 무엇이 뜨는지는 그 프로젝트가 정한다', () => {
    const tree = flat([
      ...Array.from({ length: 8 }, (_, i) => `app/dto/D${i}.java`),
      ...Array.from({ length: 5 }, (_, i) => `app/service/S${i}.java`),
      ...Array.from({ length: 3 }, (_, i) => `app/controller/C${i}.java`),
      ...Array.from({ length: 2 }, (_, i) => `web/pages/P${i}.tsx`),
    ])

    // `app` 은 18잎 중 16(88.9%)이라 빠진다. 같은 수(2)면 이름순이라 목록이 흔들리지 않는다.
    expect(segmentChips(tree)).toEqual([
      { segment: 'dto', count: 8 },
      { segment: 'service', count: 5 },
      { segment: 'controller', count: 3 },
      { segment: 'pages', count: 2 },
      { segment: 'web', count: 2 },
    ])
  })

  it('여섯 개까지만 — 사이드바 폭에서 두 줄을 넘기면 트리를 밀어낸다', () => {
    // 폴더 여덟 갈래에 잎이 둘씩. 전부 25% 라 하나도 「흔해서」 빠지지 않는다.
    const tree = flat('abcdefgh'.split('').flatMap((one) => [`p/${one}/1.ts`, `p/${one}/2.ts`]))

    expect(segmentChips(tree).map((chip) => chip.segment)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('거의 모든 잎에 든 조각은 칩이 아니다 — 눌러도 목록이 그대로다', () => {
    // ⚠️ **90% 로 잡으면 통과했을 값을 여기서 거부한다.** 실측(Spring 레포 280잎)에서
    // `com`·`java`·`skax`·`davis` 가 88.6% 로 나란히 상위 넷을 차지해, 칩 여섯 중 넷이
    // 아무것도 걸러 내지 못했다. 잘라 내는 몫이 15% 미만이면 칩이 아니다.
    const tree = flat([
      // 25잎 중 22 (88%) 가 `com`·`skax` 아래 — 90% 규칙이면 이 둘이 상위를 차지한다
      ...Array.from({ length: 12 }, (_, i) => `com/skax/dto/D${i}.java`),
      ...Array.from({ length: 10 }, (_, i) => `com/skax/service/S${i}.java`),
      ...Array.from({ length: 3 }, (_, i) => `web/pages/P${i}.tsx`),
    ])

    expect(segmentChips(tree).map((chip) => chip.segment)).toEqual(['dto', 'service', 'pages', 'web'])
  })

  it('잎 하나짜리 조각은 칩이 아니다 — 그 잎을 직접 고르는 것이 빠르다', () => {
    const tree = flat(['a/x/1.ts', 'a/x/2.ts', 'a/only/3.ts', 'b/y/4.ts', 'b/y/5.ts', 'b/z/6.ts'])

    // 잎이 하나뿐인 `only`·`z` 만 빠진다
    expect(segmentChips(tree).map((chip) => chip.segment)).toEqual(['a', 'b', 'x', 'y'])
  })

  it('마지막 조각(자기 이름)은 세지 않는다 — 폴더만 본다', () => {
    const tree = flat(['a/dto.java', 'b/dto.java', 'c/dto.java', 'x/dto/One.java', 'x/dto/Two.java'])

    // `dto` 는 **5가 아니라 2** — 파일 이름으로 셋, 폴더로 둘인데 폴더만 센다
    expect(segmentChips(tree)).toEqual([
      { segment: 'dto', count: 2 },
      { segment: 'x', count: 2 },
    ])
  })

  it('셀 것이 없으면 빈 배열이다', () => {
    expect(segmentChips([])).toEqual([])
  })
})

describe('조각으로 좁히기', () => {
  const TREE_BY_SEGMENT: TreeNode[] = [
    {
      id: 'src/main',
      label: 'main',
      children: [
        { id: 'src/main/controller/A.java', label: 'A.java' },
        { id: 'src/main/dto/B.java', label: 'B.java' },
      ],
    },
    { id: 'domain.md', label: 'domain.md' },
  ]

  it('빈 조각이면 그대로다', () => {
    expect(segmentTree(TREE_BY_SEGMENT, '')).toBe(TREE_BY_SEGMENT)
  })

  it('**폴더 하나와 통째로 같을 때만** 건다 — 글 좁히기와 다르다', () => {
    // `matchingTree('main')` 은 `domain.md` 에도 걸린다 (글 조각을 아무 데나 보므로).
    // 실측에서 `main` 을 치면 268잎(96%)이 남아 좁혀지지 않았다 — 칩은 그 함정을 안 만든다.
    expect(leavesOfAll(matchingTree(TREE_BY_SEGMENT, 'main'))).toContain('domain.md')
    expect(leavesOfAll(segmentTree(TREE_BY_SEGMENT, 'main'))).toEqual([
      'src/main/controller/A.java',
      'src/main/dto/B.java',
    ])
  })

  it('자기 이름이 같아도 안 걸린다 — 폴더만 본다', () => {
    expect(segmentTree(flat(['a/dto.java', 'x/dto/One.java']), 'dto').map((node) => node.id)).toEqual([
      'x/dto/One.java',
    ])
  })

  it('가지는 살아남은 자식이 있을 때만 남는다', () => {
    expect(segmentTree(TREE_BY_SEGMENT, 'controller').map((node) => node.id)).toEqual(['src/main'])
    expect(segmentTree(TREE_BY_SEGMENT, '없는폴더')).toEqual([])
  })
})
