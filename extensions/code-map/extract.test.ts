import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { parseFile, VENDOR } = require_('./core/parser')
const { extract } = require_('./core/extract')

// 문법(wasm)은 `scripts/fetch-grammars.mjs` 가 받아 온다 — 레포에 없다.
// **없으면 건너뛴다.** 여기서 빨갛게 하면 갓 받은 체크아웃에서 게이트가 무조건 깨진다.
const vendored = existsSync(join(VENDOR, 'web-tree-sitter', 'web-tree-sitter.wasm'))

async function symbolsOf(path: string, source: string) {
  const tree = await parseFile(path, source)
  return { ...extract(tree.root, tree.languageId), hasError: tree.hasError }
}

describe.skipIf(!vendored)('구조 추출', () => {
  it('이름 있는 것만 심볼로 센다', async () => {
    const { symbols } = await symbolsOf(
      'a.ts',
      ['export class Foo {', '  bar() {}', '}', 'export function baz() {}', 'const qux = () => {}'].join('\n'),
    )

    // 시그니처를 함께 싣는다 — 심볼 목록에서 같은 이름을 가르는 유일한 단서다
    expect(symbols).toEqual([
      { name: 'Foo', kind: 'class', line: 1 },
      { name: 'bar', kind: 'method', line: 2, params: '()' },
      { name: 'baz', kind: 'function', line: 4, params: '()' },
      { name: 'qux', kind: 'function', line: 5 },
    ])
  })

  /**
   * **익명은 목록에 두지 않는다.**
   *
   * 이 레포의 `transport.ts` 는 익명 화살표함수가 6개다. 「(익명)」으로 세면 심볼 목록에
   * 누를 수 없는 줄이 그만큼 쌓이고, 목록의 숫자도 실제 이동 가능한 자리보다 부풀려진다.
   */
  it('익명 화살표함수는 세지 않는다', async () => {
    const { symbols } = await symbolsOf('a.ts', 'run(() => {})\nlist.map(function () {})')

    expect(symbols).toEqual([])
  })

  it('const 에 매달린 화살표함수는 이름으로 센다', async () => {
    const { symbols } = await symbolsOf('a.ts', 'const handle = async () => {}')

    expect(symbols).toEqual([{ name: 'handle', kind: 'function', line: 1 }])
  })

  it('TypeScript 수입에서 따옴표를 벗긴다', async () => {
    const { imports } = await symbolsOf('a.ts', "import { x } from './y'\nimport 'side-effect'")

    expect(imports).toEqual([
      { source: './y', line: 1 },
      { source: 'side-effect', line: 2 },
    ])
  })

  /**
   * ⚠️ **`.tsx` 는 문법이 따로다.**
   *
   * 같은 npm 패키지에 wasm 이 둘 들어 있어 한 언어처럼 보이지만, `.tsx` 를 typescript
   * 문법으로 파싱하면 **예외가 아니라 오류 트리**가 나온다. 이 워크스페이스 실측으로
   * 243개 중 208개가 그랬다. 실패가 조용해서(빈 결과) 한참 못 알아챈다 —
   * 이 시험이 그 갈림을 잠근다.
   */
  it('tsx 는 tsx 문법으로 읽어야 성공한다', async () => {
    const jsx = 'export function View() {\n  return <div className="x">안녕</div>\n}'

    const asTsx = await symbolsOf('a.tsx', jsx)
    expect(asTsx.hasError).toBe(false)
    expect(asTsx.symbols).toEqual([{ name: 'View', kind: 'function', line: 1, params: '()' }])

    const asTs = await symbolsOf('a.ts', jsx)
    expect(asTs.hasError, '.ts 문법으로 읽으면 오류 트리가 나온다 — 그래서 확장자마다 갈라 싣는다').toBe(true)
  })

  /**
   * Kotlin 수입 노드는 `import_header` 가 아니라 **`import`** 다 (실측).
   * 이름만 보고 짐작하면 수입이 0개로 나오고, 그러면 간선이 하나도 안 생긴다.
   */
  it('Kotlin 수입과 선언을 읽는다', async () => {
    const { symbols, imports } = await symbolsOf(
      'a.kt',
      ['package p', 'import develop.x.Foo', 'import develop.x.Bar as Baz', 'class Svc {', '  fun run() {}', '}'].join('\n'),
    )

    expect(imports).toEqual([
      { source: 'develop.x.Foo', line: 2 },
      { source: 'develop.x.Bar', line: 3 },
    ])
    expect(symbols).toEqual([
      { name: 'Svc', kind: 'class', line: 4 },
      { name: 'run', kind: 'function', line: 5 },
    ])
  })

  /**
   * Java 수입 노드는 **`import_declaration`** 이고 끝에 `;` 가 붙는다.
   * `import static` 을 안 걷어내면 수입 경로가 `static` 이 되어 아무 파일과도 안 맞는다.
   */
  it('Java 수입과 선언을 읽는다', async () => {
    const { symbols, imports } = await symbolsOf(
      'A.java',
      [
        'package p;',
        'import a.b.Foo;',
        'import static a.b.Bar.baz;',
        'public class Svc {',
        '  public void run() {}',
        '}',
        'interface Port {}',
      ].join('\n'),
    )

    expect(imports).toEqual([
      { source: 'a.b.Foo', line: 2 },
      { source: 'a.b.Bar.baz', line: 3 },
    ])
    expect(symbols).toEqual([
      { name: 'Svc', kind: 'class', line: 4 },
      { name: 'run', kind: 'method', line: 5, params: '()' },
      { name: 'Port', kind: 'interface', line: 7 },
    ])
  })

  /**
   * ⚠️ **애노테이션이 선언 줄을 가린다.**
   *
   * `class_declaration` 노드는 애노테이션부터 시작한다. langrisser 실측으로 심볼 256개 중
   * **102개(40%)**, 클래스·인터페이스만 보면 46개 중 32개(70%)가 어긋나 있었다.
   * 그 결함은 예외가 아니라 **엉뚱한 줄로 이동**이라 화면만 봐서는 못 잡는다.
   */
  it('애노테이션을 건너뛰고 선언 줄을 가리킨다', async () => {
    const { symbols } = await symbolsOf(
      'A.java',
      ['@Entity', '@Getter', '@Builder', 'public class Player {', '  @Override', '  public void run() {}', '}'].join('\n'),
    )

    expect(symbols).toEqual([
      { name: 'Player', kind: 'class', line: 4 },
      { name: 'run', kind: 'method', line: 6, params: '()' },
    ])
  })

  /** `constructor_declaration` 은 `method_declaration` 과 다른 노드다 — 빠뜨리면 조용히 사라진다 */
  it('생성자를 시그니처와 함께 센다', async () => {
    const { symbols } = await symbolsOf(
      'A.java',
      ['class Player {', '  protected Player(String nickname, ServerType server) {}', '}'].join('\n'),
    )

    expect(symbols).toContainEqual({
      name: 'Player',
      kind: 'constructor',
      line: 2,
      params: '(String nickname, ServerType server)',
    })
  })

  /**
   * 상속·구현은 **언어마다 트리 모양이 다르다** (실측). 필드로만 짜면 Java 클래스만 걸리고
   * 나머지는 전부 빈 배열이 되는데, 그건 「상속이 없다」와 구분되지 않는다.
   */
  describe('상속·구현', () => {
    it('Java 클래스는 필드에, 인터페이스는 자식 노드에 있다', async () => {
      const cls = await symbolsOf('A.java', 'class Svc extends Base implements Port, Other {}')
      expect(cls.kin).toEqual(['Base', 'Port', 'Other'])

      const iface = await symbolsOf('B.java', 'interface P extends Q {}')
      expect(iface.kin, '인터페이스에는 superclass/interfaces 필드가 없다').toEqual(['Q'])
    })

    /** Kotlin 은 `:` 하나로 상속과 구현을 함께 적는다 — 우리도 가르지 않는다 */
    it('Kotlin 의 위임 목록을 읽는다', async () => {
      const { kin } = await symbolsOf('a.kt', 'class Svc : Port, Base() {\n  fun run() {}\n}')

      expect(kin).toEqual(['Port', 'Base'])
    })

    /**
     * ⚠️ TypeScript 의 `class_heritage` 는 `extends Base implements Port` 가 **한 덩어리**라
     * 둘 사이에 쉼표가 없다. 쉼표로만 가르면 `"Base   Port"` 라는 이름이 나온다 (실측).
     */
    it('TypeScript 의 extends 와 implements 를 갈라 읽는다', async () => {
      const { kin } = await symbolsOf('a.ts', 'export class Svc extends Base implements Port, Other {}')

      expect(kin).toEqual(['Base', 'Port', 'Other'])
    })

    it('제네릭과 패키지 경로를 벗긴다', async () => {
      const { kin } = await symbolsOf('A.java', 'class Svc implements Comparable<Foo>, a.b.Port {}')

      expect(kin).toEqual(['Comparable', 'Port'])
    })

    it('상속이 없으면 빈 목록이다', async () => {
      expect((await symbolsOf('a.ts', 'export class Plain {}')).kin).toEqual([])
    })
  })

  it('모르는 확장자는 읽지 않는다', async () => {
    expect(await parseFile('a.py', 'def x(): pass')).toBeNull()
    expect(await parseFile('a.md', '# hi')).toBeNull()
  })
})
