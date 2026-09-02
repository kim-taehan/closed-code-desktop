import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { layerModel, violations } = require_('./core/strata')
const { buildGraph } = require_('./core/graph')

const file = (path: string, imports: string[] = [], kin: string[] = []) => ({
  path,
  imports: imports.map((source, i) => ({ source, line: i + 1 })),
  symbols: [{ name: path.split('/').pop()?.replace(/\..*$/, '') ?? '', kind: 'class', line: 1 }],
  kin,
  lines: 10,
})

describe('층 판정', () => {
  it('바깥부터 쌓는다 — 화면에 그 순서로 놓기 위해서다', () => {
    const model = layerModel(['a/domain/P.java', 'a/application/S.java', 'a/adapter/J.java'])

    expect(model.mode).toBe('hexagonal')
    expect(model.order).toEqual(['adapter', 'application', 'domain'])
  })

  /** 링 이름이 **마디**로 들어 있어야 한다. 부분 일치로 재면 엉뚱한 파일이 들어온다 */
  it('mydomain 은 domain 이 아니다', () => {
    const model = layerModel(['a/mydomain/P.java', 'a/application/S.java', 'a/adapter/J.java'])

    expect(model.of.get('a/mydomain/P.java')).toBe('기타')
  })

  /**
   * **하나만 있으면 헥사고날로 보지 않는다.**
   *
   * 우연히 `domain` 폴더가 있는 프로젝트를 그 하나로 뒤집으면 나머지 파일이 전부 「기타」가
   * 되어, 화면이 「이 프로젝트는 층이 없다」고 거짓말하게 된다.
   */
  it('링이 하나뿐이면 폴더로 가른다', () => {
    const model = layerModel(['src/domain/P.ts', 'src/ui/A.ts', 'electron/B.ts'])

    expect(model.mode).toBe('directory')
    expect(model.order).toEqual(['electron', 'src'])
  })

  /** 안팎이 없다는 사실을 화면이 말해야 한다 — 안 적으면 위반 0과 구분되지 않는다 */
  it('폴더로 갈랐으면 방향을 안 잰다고 적는다', () => {
    expect(layerModel(['src/a.ts', 'electron/b.ts']).note).toContain('방향은 재지 않습니다')
  })
})

describe('층 위반', () => {
  const hexa = (files: ReturnType<typeof file>[]) => {
    const graph = buildGraph(files)
    return violations(graph, layerModel(files.map((f) => f.path)))
  }

  it('안쪽이 바깥을 수입하면 잡는다', () => {
    const found = hexa([
      file('a/application/Importer.java', ['x.y.Loader']),
      file('a/adapter/Loader.java'),
      file('a/domain/P.java'),
    ])

    expect(found).toEqual([{ from: 'a/application/Importer.java', to: 'a/adapter/Loader.java' }])
  })

  it('바깥이 안쪽을 수입하는 것은 정상이다', () => {
    const found = hexa([
      file('a/adapter/Jpa.java', ['x.y.P']),
      file('a/domain/P.java'),
      file('a/application/S.java'),
    ])

    expect(found).toEqual([])
  })

  /** 상속으로 어기는 것도 같은 위반이다 — 수입만 보면 이 자리가 통째로 빈다 */
  it('상속으로 바깥을 가리켜도 위반이다', () => {
    const found = hexa([
      file('a/domain/P.java', [], ['Jpa']),
      file('a/adapter/Jpa.java'),
      file('a/application/S.java'),
    ])

    expect(found).toEqual([{ from: 'a/domain/P.java', to: 'a/adapter/Jpa.java' }])
  })

  /** 층을 **모르는 것**과 층을 **어긴 것**은 다르다 */
  it('기타는 어느 쪽으로도 세지 않는다', () => {
    const found = hexa([
      file('a/domain/P.java', ['x.y.Helper']),
      file('a/util/Helper.java'),
      file('a/application/S.java'),
      file('a/adapter/J.java'),
    ])

    expect(found).toEqual([])
  })

  /**
   * 폴더 모드에는 안팎이 없다 — 없는 규칙을 어겼다고 말하지 않는다.
   *
   * ⚠️ **이 시험을 한 번 헛으로 썼다.** 처음 픽스처는 두 파일의 층 이름이 `src`·`ui` 라
   * 순위표에서 **-1 로 먼저 걸러져**, 폴더 모드 가드를 지워도 초록이었다. 가드가 실제로
   * 일하는 자리는 **폴더 이름이 우연히 링 이름과 같을 때**다:
   *
   *   `application/a/domain/P.java` 는 `ringOf` 가 (RINGS 순서상) `domain` 을 먼저 찾아
   *   링이 하나뿐이 되어 폴더 모드로 떨어지는데, 그 파일의 **폴더**는 `application` 이다.
   *   가드가 없으면 `domain → application` 을 위반으로 읽는다.
   */
  it('폴더 이름이 링 이름과 같아도 방향을 재지 않는다', () => {
    const files = [file('domain/B.java', [], ['P']), file('application/a/domain/P.java')]
    const model = layerModel(files.map((f) => f.path))

    expect(model.mode, '링이 domain 하나뿐이라 폴더 모드다').toBe('directory')
    expect(model.of.get('application/a/domain/P.java')).toBe('application')
    expect(buildGraph(files).kinEdges, '이을 선은 실제로 있다').toHaveLength(1)
    expect(violations(buildGraph(files), model)).toEqual([])
  })
})
