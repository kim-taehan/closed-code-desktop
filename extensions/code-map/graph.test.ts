import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// 그래프 조립은 **파서를 안 탄다** — 추출 결과만 받아 접는다. 그래서 wasm 없이 돈다.
// 확장은 CJS 라 `require` 로 싣는다 (호스트가 `require` 로 싣는 것과 같은 길).
// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { buildGraph, neighborhood, normalize, resolveRelative, resolveKotlin } = require_('./core/graph')

const file = (path: string, imports: string[], symbols: { name: string; kind: string }[] = []) => ({
  path,
  imports: imports.map((source, i) => ({ source, line: i + 1 })),
  symbols: symbols.map((s, i) => ({ ...s, line: i + 1 })),
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

describe('Kotlin 수입', () => {
  // Kotlin 수입은 파일 경로가 아니라 **패키지 경로**라 상대 해석이 통하지 않는다.
  // 마지막 마디를 그 이름을 선언한 파일에서 찾는다.
  const declaredIn = new Map([['RateLimit', 'gateway/domain/RateLimit.kt']])

  it('마지막 마디로 선언한 파일을 찾는다', () => {
    expect(resolveKotlin('develop.x.gateway.domain.RateLimit', declaredIn)).toBe('gateway/domain/RateLimit.kt')
  })

  /**
   * `import a.b.*` 는 **버린다.**
   *
   * 무엇을 쓰는지 알 수 없는데 선을 그으면 틀린 선이 된다. 그래프는 「없는 것」보다
   * 「틀린 것」이 훨씬 나쁘다 — 없으면 더 찾아보지만, 틀리면 그대로 믿는다.
   */
  it('와일드카드는 그리지 않는다', () => {
    expect(resolveKotlin('develop.x.gateway.domain.*', declaredIn)).toBeNull()
  })

  it('프로젝트 밖 수입은 그리지 않는다', () => {
    expect(resolveKotlin('kotlinx.coroutines.flow.Flow', declaredIn)).toBeNull()
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
