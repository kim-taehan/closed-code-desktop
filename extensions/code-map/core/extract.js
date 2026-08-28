const { rulesetOf } = require('./languages')

// 구문트리 하나에서 **심볼과 수입(import)** 을 뽑는다. 여기에 LLM 도 난수도 없다 —
// 같은 파일이면 언제나 같은 결과다. 화면이 「이건 결정적」이라고 말할 수 있는 근거가 이것이다.
//
// 노드 타입은 **추측이 아니라 실측**이다. 이 워크스페이스의 실제 파일을 파싱해 세어 보고 적었다:
//
//   transport.ts       class_declaration 1 · interface_declaration 1 · method_definition 20
//                      lexical_declaration 14 · arrow_function 6 · import_statement 17
//   RelayChatService.kt class_declaration 2 · function_declaration 5 · import 17
//
// ⚠️ 수입 노드 이름이 언어마다 다르다 — Kotlin 은 `import_header` 가 아니라 **`import`**,
// Java 는 **`import_declaration`** 이다. 이름만 보고 짐작하면 수입이 0개로 나오고,
// 그러면 그래프에 간선이 하나도 안 생긴다 — 조용히 비는 실패다.

/** 이름을 가진 것만 심볼로 친다. 익명 화살표함수는 **누를 수 없으므로** 목록에 두지 않는다 */
const NAMED = {
  typescript: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    function_declaration: 'function',
    method_definition: 'method',
  },
  kotlin: {
    class_declaration: 'class',
    object_declaration: 'object',
    function_declaration: 'function',
  },
  java: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'class',
    record_declaration: 'class',
    method_declaration: 'method',
  },
}

function fieldText(node, field) {
  const child = node.childForFieldName ? node.childForFieldName(field) : null
  return child ? child.text : null
}

/**
 * `const foo = () => {}` 를 함수로 센다.
 *
 * 트리에서는 `lexical_declaration › variable_declarator › arrow_function` 이라 위의
 * 이름표만으로는 안 잡힌다. 그런데 이 레포의 `electron/` 은 이 모양을 많이 쓴다 —
 * 안 잡으면 심볼 목록이 실제보다 훨씬 비어 보인다.
 */
function arrowSymbol(node) {
  if (node.type !== 'variable_declarator') return null
  const value = node.childForFieldName ? node.childForFieldName('value') : null
  if (!value || (value.type !== 'arrow_function' && value.type !== 'function_expression')) return null
  const name = fieldText(node, 'name')
  return name ? { name, kind: 'function' } : null
}

/** `import x from './y'` 의 `'./y'`. 따옴표를 벗긴다 */
function importSource(node) {
  const source = fieldText(node, 'source')
  if (!source) return null
  return source.replace(/^['"`]|['"`]$/g, '')
}

/**
 * Kotlin·Java 수입은 필드가 없어 **본문 텍스트에서 읽는다.**
 *
 *   Kotlin  `import a.b.Foo` · `import a.b.Foo as Bar` · `import a.b.*`
 *   Java    `import a.b.Foo;` · `import static a.b.Foo.bar;` · `import a.b.*;`
 *
 * `static` 을 안 걷어내면 수입 경로가 `static` 이 되어 아무 파일과도 안 맞는다.
 */
function packageImport(node) {
  const match = /^import\s+(?:static\s+)?([\w.*]+)/.exec(node.text)
  return match ? match[1] : null
}

/**
 * 파일 하나의 구조.
 *
 * @param root tree-sitter 루트 노드
 * @param languageId `languages.js` 의 id
 * @returns `{ symbols: [{name, kind, line}], imports: [{source, line}] }` — line 은 1부터
 */
function extract(root, languageId) {
  const ruleset = rulesetOf(languageId)
  const named = NAMED[ruleset] ?? {}
  const symbols = []
  const imports = []

  const visit = (node) => {
    const kind = named[node.type]
    if (kind) {
      const name = fieldText(node, 'name')
      // 이름을 못 읽으면 **버린다.** 「(익명)」을 목록에 넣으면 누를 수 없는 줄이 쌓인다
      if (name) symbols.push({ name, kind, line: node.startPosition.row + 1 })
    } else if (ruleset === 'typescript') {
      const arrow = arrowSymbol(node)
      if (arrow) symbols.push({ ...arrow, line: node.startPosition.row + 1 })
    }

    if (node.type === 'import_statement') {
      const source = importSource(node)
      if (source) imports.push({ source, line: node.startPosition.row + 1 })
    } else if (node.type === 'import' || node.type === 'import_declaration') {
      const source = packageImport(node)
      if (source) imports.push({ source, line: node.startPosition.row + 1 })
    }

    for (let i = 0; i < node.childCount; i += 1) visit(node.child(i))
  }

  visit(root)
  return { symbols, imports }
}

module.exports = { extract, NAMED }
