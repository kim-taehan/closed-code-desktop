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
    // `method_declaration` 과 **다른 노드**다. 이름이 비슷해 한 번 빠뜨렸고, 그러면 생성자만
    // 조용히 목록에서 사라진다 — 실측으로 langrisser 에서 심볼 7개가 그렇게 없었다.
    constructor_declaration: 'constructor',
  },
}

function fieldNode(node, field) {
  return node.childForFieldName ? node.childForFieldName(field) : null
}

function fieldText(node, field) {
  const child = fieldNode(node, field)
  return child ? child.text : null
}

/**
 * 선언이 **실제로 시작하는 줄**.
 *
 * ⚠️ `node.startPosition` 을 쓰면 안 된다 — `class_declaration` 노드는 **애노테이션부터**
 * 시작한다. langrisser 의 `Player` 는 `@Entity`·`@Table`… 여섯 개가 붙어 있어 노드는 17줄,
 * 진짜 `class Player` 는 32줄이다. 눌러서 가면 애노테이션 무더기 한가운데로 떨어진다.
 *
 * 실측: 심볼 256개 중 **102개(40%)** 가 어긋나 있었고, 클래스·인터페이스만 보면
 * 46개 중 32개(70%)다. 메서드도 `@Override` 하나에 한 줄씩 밀린다.
 * 이름 노드가 없으면 노드 시작으로 물러난다 (없는 것보다 낫다).
 */
function declarationLine(node) {
  const name = fieldNode(node, 'name')
  return (name ?? node).startPosition.row + 1
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

/**
 * 상속·구현으로 이어지는 **타입 이름들**.
 *
 * ⚠️ **네 언어가 전부 다른 모양이다** (실측 2026-08-30). 필드로만 짜면 Java 클래스만
 * 걸리고 나머지는 조용히 0이 된다:
 *
 *   Java 클래스     필드 `superclass`("extends Base") · `interfaces`("implements P, Q")
 *   Java 인터페이스  자식 `extends_interfaces`("extends Q")   — 필드가 없다
 *   Kotlin         자식 `delegation_specifiers`("P, Base()")  — 상속·구현을 구분하지 않는다
 *   TypeScript 클래스    자식 `class_heritage`("extends Base implements P")
 *   TypeScript 인터페이스 자식 `extends_type_clause`("extends Q")
 *
 * 그래서 **자식 노드 타입**으로 찾고, 글자에서 키워드를 걷어낸다. Kotlin 이 둘을 안 가르므로
 * 우리도 안 가른다 — 「이어져 있다」까지만 말하고 방향은 주장하지 않는다.
 */
const KIN_NODES = new Set([
  'superclass',
  'super_interfaces',
  'extends_interfaces',
  'delegation_specifiers',
  'class_heritage',
  'extends_type_clause',
])

/** 이름으로 쓸 수 있는 것만 남긴다 — 제네릭을 걷어내고 남은 `>` 같은 부스러기를 거른다 */
const NAME_LIKE = /^[A-Za-z_$][\w$.]*$/

function kinNames(node) {
  const out = []
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i)
    if (!KIN_NODES.has(child.type)) continue
    // ⚠️ **쉼표로만 가르면 안 된다.** TypeScript 의 `class_heritage` 는
    // `extends Base implements Port, Other` 가 통째로 한 덩어리라 `Base` 와 `Port` 사이에
    // 쉼표가 없다 — 실측에서 `"Base   Port"` 라는 이름이 나왔다. 공백으로도 가른다.
    // 제네릭·생성자 인자를 **먼저** 걷어낸다 (`Comparable<Foo, Bar>` 안의 쉼표 때문에).
    const flat = child.text
      .replace(/<[^>]*>/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(extends|implements)\b/g, ' ')
      .replace(/:/g, ' ')
    for (const piece of flat.split(/[,\s]+/)) {
      if (!NAME_LIKE.test(piece)) continue
      // `a.b.Port` → `Port`. 그래프가 이름으로 파일을 찾으므로 마지막 마디만 쓴다
      const name = piece.split('.').pop()
      if (name) out.push(name)
    }
  }
  return out
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
 * @returns `{ symbols: [{name, kind, line, params?}], imports: [{source, line}], kin: [이름] }`
 *          line 은 1부터이고 **선언 이름의 줄**이다 (`declarationLine` 머리말)
 */
function extract(root, languageId) {
  const ruleset = rulesetOf(languageId)
  const named = NAMED[ruleset] ?? {}
  const symbols = []
  const imports = []
  /** 이 파일이 상속·구현으로 이어지는 타입 이름들. 중복 없이, 자기 이름은 빼고 */
  const kin = []

  const visit = (node) => {
    const kind = named[node.type]
    if (kind) {
      const name = fieldText(node, 'name')
      // 이름을 못 읽으면 **버린다.** 「(익명)」을 목록에 넣으면 누를 수 없는 줄이 쌓인다
      if (name) {
        const params = fieldText(node, 'parameters')
        symbols.push({
          name,
          kind,
          line: declarationLine(node),
          ...(params ? { params: params.replace(/\s+/g, ' ') } : {}),
        })
        for (const one of kinNames(node)) if (one !== name && !kin.includes(one)) kin.push(one)
      }
    } else if (ruleset === 'typescript') {
      const arrow = arrowSymbol(node)
      // 화살표함수에는 애노테이션이 안 붙으므로 노드 시작이 곧 선언 줄이다
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
  return { symbols, imports, kin }
}

module.exports = { extract, NAMED }
