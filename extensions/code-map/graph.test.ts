import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// 그래프 조립은 **파서를 안 탄다** — 추출 결과만 받아 접는다. 그래서 wasm 없이 돈다.
// 확장은 CJS 라 `require` 로 싣는다 (호스트가 `require` 로 싣는 것과 같은 길).
// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { buildGraph, neighborhood, blastRadius, normalize, resolveRelative, resolvePackage } = require_('./core/graph')

const file = (
  path: string,
  imports: string[],
  symbols: { name: string; kind: string }[] = [],
  kin: string[] = [],
) => ({
  path,
  imports: imports.map((source, i) => ({ source, line: i + 1 })),
  symbols: symbols.map((s, i) => ({ ...s, line: i + 1 })),
  kin,
  lines: 10,
})

describe('경로 접기', () => {
  it('.. 을 걷어낸다', () => {
    expect(normalize('a/b/../c')).toBe('a/c')
    expect(normalize('./a//b/')).toBe('a/b')
  })
})

describe('TypeScript 상대 수입', () => {
  const known = new Set(['a/b/y.ts', 'a/b/z.tsx', 'a/b/deep/index.ts'])

  // 소스는 확장자를 안 적는 것이 보통이라(`./y`) 후보를 대 봐야 한다
  it('확장자 없이 적은 것을 찾아낸다', () => {
    expect(resolveRelative('a/b/x.ts', './y', known)).toBe('a/b/y.ts')
    expect(resolveRelative('a/b/x.ts', './z', known)).toBe('a/b/z.tsx')
    expect(resolveRelative('a/b/x.ts', './deep', known)).toBe('a/b/deep/index.ts')
  })

  /**
   * **프로젝트 밖은 그리지 않는다.**
   *
   * `react`·`node:fs` 까지 노드로 세우면 그래프가 라이브러리 이름으로 뒤덮이고,
   * 정작 보려던 우리 파일 사이의 선이 안 보인다.
   */
  it('패키지 수입은 간선이 되지 않는다', () => {
    expect(resolveRelative('a/b/x.ts', 'react', known)).toBeNull()
    expect(resolveRelative('a/b/x.ts', 'node:fs', known)).toBeNull()
  })

  it('없는 파일을 가리키면 그리지 않는다', () => {
    expect(resolveRelative('a/b/x.ts', './없는것', known)).toBeNull()
  })
})

describe('Kotlin·Java 수입', () => {
  // Kotlin·Java 수입은 파일 경로가 아니라 **패키지 경로**라 상대 해석이 통하지 않는다.
  // 마지막 마디를 그 이름을 선언한 파일에서 찾는다.
  const declaredIn = new Map([['RateLimit', 'gateway/domain/RateLimit.kt']])

  it('마지막 마디로 선언한 파일을 찾는다', () => {
    expect(resolvePackage('develop.x.gateway.domain.RateLimit', declaredIn)).toBe('gateway/domain/RateLimit.kt')
  })

  /**
   * `import a.b.*` 는 **버린다.**
   *
   * 무엇을 쓰는지 알 수 없는데 선을 그으면 틀린 선이 된다. 그래프는 「없는 것」보다
   * 「틀린 것」이 훨씬 나쁘다 — 없으면 더 찾아보지만, 틀리면 그대로 믿는다.
   */
  it('와일드카드는 그리지 않는다', () => {
    expect(resolvePackage('develop.x.gateway.domain.*', declaredIn)).toBeNull()
  })

  it('프로젝트 밖 수입은 그리지 않는다', () => {
    expect(resolvePackage('kotlinx.coroutines.flow.Flow', declaredIn)).toBeNull()
    expect(resolvePackage('java.util.List', declaredIn)).toBeNull()
  })
})

describe('그래프 조립', () => {
  it('같은 두 파일 사이에 선을 하나만 긋는다', () => {
    const graph = buildGraph([file('a/x.ts', ['./y', './y']), file('a/y.ts', [])])

    expect(graph.edges).toEqual([{ from: 'a/x.ts', to: 'a/y.ts' }])
  })

  // 자기를 수입하는 모양은 배럴 파일에서 실제로 나온다. 자기 고리를 그리면 화면만 어지럽다
  it('자기 자신으로 가는 선은 긋지 않는다', () => {
    const graph = buildGraph([file('a/x.ts', ['./x'])])

    expect(graph.edges).toEqual([])
  })

  /**
   * 같은 이름이 여럿이면 **먼저 선언한 파일이 이긴다.**
   *
   * 어차피 못 가르는데 나중 것이 덮어쓰게 두면 파일을 훑는 순서에 따라 그래프가 달라진다 —
   * 같은 코드에서 회차마다 다른 그림이 나오면 아무도 안 믿는다.
   */
  it('이름이 겹쳐도 회차마다 달라지지 않는다', () => {
    const files = [
      file('a/first.kt', [], [{ name: 'Caller', kind: 'class' }]),
      file('a/second.kt', [], [{ name: 'Caller', kind: 'class' }]),
      file('a/uses.kt', ['x.y.Caller']),
    ]

    expect(buildGraph(files).edges).toEqual([{ from: 'a/uses.kt', to: 'a/first.kt' }])
    expect(buildGraph(files).edges).toEqual([{ from: 'a/uses.kt', to: 'a/first.kt' }])
  })

  // 함수 이름으로 파일을 찾으면 흔한 이름(`of`·`run`)이 엉뚱한 파일을 물고 온다
  it('함수 이름으로는 파일을 찾지 않는다', () => {
    const files = [file('a/util.kt', [], [{ name: 'run', kind: 'function' }]), file('a/uses.kt', ['x.y.run'])]

    expect(buildGraph(files).edges).toEqual([])
  })
})

describe('상속·구현 간선', () => {
  const port = { name: 'PlayerStore', kind: 'interface' }

  it('구현하는 파일에서 선언한 파일로 긋는다', () => {
    const graph = buildGraph([
      file('app/PlayerStore.kt', [], [port]),
      file('adapter/JpaPlayerStore.kt', [], [{ name: 'JpaPlayerStore', kind: 'class' }], ['PlayerStore']),
    ])

    expect(graph.kinEdges).toEqual([{ from: 'adapter/JpaPlayerStore.kt', to: 'app/PlayerStore.kt' }])
  })

  /**
   * **수입 간선과 섞지 않는다.** 같은 두 파일이 수입으로도 상속으로도 이어질 수 있고,
   * 그 둘은 화면에서 다른 선이다 — 합치면 「이 포트의 구현체가 어디 있나」가 다시 안 보인다.
   */
  it('같은 짝이 수입과 상속 양쪽에 있어도 각자 남는다', () => {
    const graph = buildGraph([
      file('app/PlayerStore.kt', [], [port]),
      file('adapter/Jpa.kt', ['x.y.PlayerStore'], [{ name: 'Jpa', kind: 'class' }], ['PlayerStore']),
    ])

    expect(graph.edges).toEqual([{ from: 'adapter/Jpa.kt', to: 'app/PlayerStore.kt' }])
    expect(graph.kinEdges).toEqual([{ from: 'adapter/Jpa.kt', to: 'app/PlayerStore.kt' }])
  })

  it('프로젝트 밖 타입을 상속하면 긋지 않는다', () => {
    const graph = buildGraph([file('a/X.kt', [], [{ name: 'X', kind: 'class' }], ['RuntimeException'])])

    expect(graph.kinEdges).toEqual([])
  })
})

describe('영향 반경', () => {
  // C ← B ← A. C 를 고치면 B 가 1촌, A 가 2촌이다
  const chain = () =>
    buildGraph([
      file('a/C.ts', []),
      file('a/B.ts', ['./C']),
      file('a/A.ts', ['./B']),
    ])

  it('촌수별로 갈라 끝까지 따라간다', () => {
    expect(blastRadius(chain(), 'a/C.ts')).toEqual({ rings: [['a/B.ts'], ['a/A.ts']], total: 2 })
  })

  /** 직접 참조 수와 **다른 값**이다 — 이게 같으면 이 함수를 만든 이유가 없다 */
  it('직접 들어옴이 하나여도 반경은 더 클 수 있다', () => {
    const graph = chain()
    const direct = graph.edges.filter((e: { to: string }) => e.to === 'a/C.ts').length

    expect(direct).toBe(1)
    expect(blastRadius(graph, 'a/C.ts').total).toBe(2)
  })

  it('아무도 안 쓰면 반경이 0이다', () => {
    expect(blastRadius(chain(), 'a/A.ts')).toEqual({ rings: [], total: 0 })
  })

  // 고리가 있으면 다시 세지 않는다 — 안 그러면 무한히 돈다
  it('순환이 있어도 같은 파일을 두 번 세지 않는다', () => {
    const graph = buildGraph([file('a/X.ts', ['./Y']), file('a/Y.ts', ['./X'])])

    expect(blastRadius(graph, 'a/X.ts').total).toBe(1)
  })

  /** 같은 패키지 안에서는 수입 문장이 없다 — 상속을 안 세면 그 관계가 통째로 빠진다 */
  it('상속으로만 이어진 것도 반경에 든다', () => {
    const graph = buildGraph([
      file('a/Port.kt', [], [{ name: 'Port', kind: 'interface' }]),
      file('a/Impl.kt', [], [{ name: 'Impl', kind: 'class' }], ['Port']),
    ])

    expect(graph.edges, '수입은 하나도 없다').toEqual([])
    expect(blastRadius(graph, 'a/Port.kt').total).toBe(1)
  })
})

describe('이웃 고르기', () => {
  it('들어오는 것과 나가는 것을 갈라 준다', () => {
    const graph = buildGraph([
      file('a/x.ts', ['./center']),
      file('a/center.ts', ['./out']),
      file('a/out.ts', []),
    ])

    expect(neighborhood(graph, 'a/center.ts')).toEqual({
      center: 'a/center.ts',
      inbound: ['a/x.ts'],
      outbound: ['a/out.ts'],
    })
  })
})
