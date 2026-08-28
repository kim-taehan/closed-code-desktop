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

    expect(symbols).toEqual([
      { name: 'Foo', kind: 'class', line: 1 },
      { name: 'bar', kind: 'method', line: 2 },
      { name: 'baz', kind: 'function', line: 4 },
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
    expect(asTsx.symbols).toEqual([{ name: 'View', kind: 'function', line: 1 }])

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
      { name: 'run', kind: 'method', line: 5 },
      { name: 'Port', kind: 'interface', line: 7 },
    ])
  })

  it('모르는 확장자는 읽지 않는다', async () => {
    expect(await parseFile('a.py', 'def x(): pass')).toBeNull()
    expect(await parseFile('a.md', '# hi')).toBeNull()
  })
})
