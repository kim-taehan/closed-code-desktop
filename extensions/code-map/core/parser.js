const { join } = require('node:path')
const { languageOf } = require('./languages')

// tree-sitter 를 **확장 안에 실린 wasm 으로** 띄운다.
//
// 네이티브 바인딩(`.node`)은 쓰지 않는다 — 썼다면 Electron ABI 로 다시 빌드해야 하고
// 플랫폼마다 갈린 아티팩트가 생긴다. wasm 은 어느 판에서나 같은 파일이라 그 일이 없다.
//
// **확장은 asar 밖(`~/.open-code/desktop-extensions/`)에 풀려 있다.** 그래서 여기서는
// 평범한 파일 경로로 wasm 을 읽을 수 있다 — 앱 본체에 넣었다면 asar 안이라 못 읽는다.
// 확장으로 만든 실질적인 이득이 이 한 줄이다.

const VENDOR = join(__dirname, '..', 'vendor')

let ready = null
const grammars = new Map()

/** `Parser.init` 은 한 번만. 여러 번 부르면 런타임을 다시 올린다 */
function boot() {
  if (!ready) {
    const runtime = require(join(VENDOR, 'web-tree-sitter', 'web-tree-sitter.cjs'))
    ready = runtime.Parser
      .init({ locateFile: () => join(VENDOR, 'web-tree-sitter', 'web-tree-sitter.wasm') })
      .then(() => runtime)
  }
  return ready
}

/**
 * 문법 하나를 올린다. **실패하면 던진다.**
 *
 * 조용히 넘어가면 그 언어의 파일이 전부 빈 결과가 되고, 화면에는 「심볼 0개」로만 보인다.
 * 그건 「이 파일에 아무것도 없다」와 구분되지 않아서, 무엇이 틀렸는지 아무도 못 찾는다.
 */
async function grammarFor(language) {
  if (!grammars.has(language.wasm)) {
    const runtime = await boot()
    const path = join(VENDOR, language.wasm)
    try {
      grammars.set(language.wasm, await runtime.Language.load(path))
    } catch (cause) {
      throw new Error(`문법을 못 읽었습니다: ${language.wasm} — ${cause?.message ?? cause}`)
    }
  }
  return grammars.get(language.wasm)
}

/**
 * 파일 하나를 파싱한다. 모르는 확장자면 null.
 *
 * ⚠️ 파서는 **확장자마다 문법을 갈아 끼운다.** 한 파서를 재사용하되 `setLanguage` 를
 * 매번 부르는 것이 tree-sitter 의 정석이다 (`.tsx` 함정은 `languages.js` 머리말).
 */
async function parseFile(path, text) {
  const language = languageOf(path)
  if (!language) return null

  const runtime = await boot()
  const parser = new runtime.Parser()
  parser.setLanguage(await grammarFor(language))
  const tree = parser.parse(text)
  return { root: tree.rootNode, languageId: language.id, hasError: tree.rootNode.hasError }
}

module.exports = { parseFile, VENDOR }
