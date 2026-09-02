import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { rippleSvg, MAX_COLUMN } = require_('./core/diagram')
const { layerModel } = require_('./core/strata')

const model = layerModel(['a/domain/C.java', 'a/application/B.java', 'a/adapter/A.java'])
const view = (over = {}) => ({
  center: 'a/domain/C.java',
  blast: { rings: [['a/application/B.java'], ['a/adapter/A.java']], total: 2 },
  model,
  violations: [],
  ...over,
})
// B → C, A → B. 즉 C 를 고치면 B 가 1촌, A 가 2촌이다
const edges = [
  { from: 'a/application/B.java', to: 'a/domain/C.java' },
  { from: 'a/adapter/A.java', to: 'a/application/B.java' },
]

describe('파문 그림', () => {
  it('촌수마다 열 이름을 적는다', () => {
    const svg = rippleSvg(view(), edges)

    expect(svg).toContain('1촌 1')
    expect(svg).toContain('2촌 1')
  })

  /** 그림의 값어치는 **경로**다 — 선이 없으면 목록과 같은 것을 더 크게 그린 것뿐이다 */
  it('거쳐 가는 선을 긋는다', () => {
    const svg = rippleSvg(view(), edges)

    expect(svg.match(/<path /g), 'C←B 와 B←A 두 선').toHaveLength(2)
  })

  /**
   * **한 칸 안쪽으로 가는 간선만** 그린다. 같은 열끼리나 두 칸을 건너뛰는 선까지 그리면
   * 열의 뜻(촌수)이 흐려지고 그림이 다시 실타래가 된다.
   */
  it('칸을 건너뛰는 선은 안 긋는다', () => {
    const svg = rippleSvg(view(), [...edges, { from: 'a/adapter/A.java', to: 'a/domain/C.java' }])

    expect(svg.match(/<path /g)).toHaveLength(2)
  })

  it('노드를 누르면 그 파일로 옮겨 간다', () => {
    const svg = rippleSvg(view(), edges)

    expect(svg).toContain('data-command="codeMap.focus"')
    expect(svg).toContain('data-arg="a/adapter/A.java"')
  })

  /** 층을 어긴 선은 눈에 띄어야 한다 — 목록에만 있으면 그림이 「문제 없음」이라 주장한다 */
  it('층 위반 선은 빨갛게 긋는다', () => {
    const svg = rippleSvg(view({ violations: [{ from: 'a/application/B.java', to: 'a/domain/C.java' }] }), edges)

    expect(svg).toContain('#e0574f')
  })

  /**
   * ⚠️ **방향을 안 그리면 뜻이 뒤집혀 전달된다.**
   *
   * 화살표가 없으면 `C ─ B` 를 왼쪽→오른쪽 습관대로 「C 가 B 를 쓴다」로 읽는데 실제로는
   * 반대다. 화살표는 언제나 **쓰는 쪽 → 쓰이는 쪽**이다.
   */
  it('선마다 화살촉을 그린다', () => {
    const svg = rippleSvg(view(), edges)

    expect(svg.match(/<polygon /g), '선 두 개에 화살촉 두 개').toHaveLength(2)
  })

  it('어느 쪽이 쓰는 쪽인지 글자로도 적는다', () => {
    expect(rippleSvg(view(), edges)).toContain('이 파일을 씀')
  })

  /** 나가는 쪽을 안 그리면 이웃의 절반이 목록에만 남아 그림에서 사라진다 */
  it('이 파일이 쓰는 것을 왼쪽에 그린다', () => {
    const svg = rippleSvg(view({ outbound: ['a/adapter/Jpa.java'] }), edges)

    expect(svg).toContain('이 파일이 쓰는 것 1')
    expect(svg.match(/<polygon /g), '나가는 선 하나가 더 있다').toHaveLength(3)
  })

  it('나가는 것이 없으면 그 열을 안 만든다', () => {
    expect(rippleSvg(view(), edges)).not.toContain('이 파일이 쓰는 것')
  })

  it('나가는 것을 중복 없이 그린다', () => {
    const svg = rippleSvg(view({ outbound: ['a/adapter/Jpa.java', 'a/adapter/Jpa.java'] }), edges)

    expect(svg).toContain('이 파일이 쓰는 것 1')
  })

  /**
   * **양쪽이 다 비었을 때만** 안 그린다. 한쪽만 보고 빠져나가면, 아무도 안 쓰지만 남을
   * 쓰는 파일이 그림을 통째로 잃는다 — langrisser 의 `PlayerModifyService` 가 그렇다.
   */
  it('아무도 안 써도 쓰는 것이 있으면 그린다', () => {
    const svg = rippleSvg(view({ blast: { rings: [], total: 0 }, outbound: ['a/adapter/Jpa.java'] }), edges)

    expect(svg).toContain('이 파일이 쓰는 것 1')
  })

  it('양쪽이 다 비면 그림을 안 그린다', () => {
    expect(rippleSvg(view({ blast: { rings: [], total: 0 } }), edges)).toBe('')
  })

  /**
   * **자른 것을 숨기지 않는다.** 4촌까지만 그리는데 그 사실을 안 적으면 화면이
   * 「이게 전부」라고 주장한다.
   */
  it('먼 촌수를 뺐으면 몇 개를 뺐는지 적는다', () => {
    const deep = Array.from({ length: MAX_COLUMN + 2 }, (_, i) => [`a/adapter/N${i}.java`])
    const svg = rippleSvg(view({ blast: { rings: deep, total: deep.length } }), edges)

    expect(svg).toContain(`${MAX_COLUMN}촌까지 그렸습니다`)
    expect(svg).toContain('더 먼 2개')
  })

  it('딱 맞으면 자른다는 말을 안 한다', () => {
    const exact = Array.from({ length: MAX_COLUMN }, (_, i) => [`a/adapter/N${i}.java`])
    const svg = rippleSvg(view({ blast: { rings: exact, total: exact.length } }), edges)

    expect(svg).not.toContain('그렸습니다')
  })

  /** 이름이 열을 넘으면 옆 열의 선 위에 글자가 얹힌다 */
  it('긴 이름은 잘라 쓰되 전체 경로는 남긴다', () => {
    const long = 'a/adapter/PlayerGoogleSheetImporterFactory.java'
    const svg = rippleSvg(
      view({ blast: { rings: [[long]], total: 1 }, model: layerModel([...model.of.keys(), long]) }),
      [{ from: long, to: 'a/domain/C.java' }],
    )

    expect(svg).toContain('…')
    expect(svg, '툴팁에는 전체 경로가 남는다').toContain(`<title>${long}</title>`)
  })
})
