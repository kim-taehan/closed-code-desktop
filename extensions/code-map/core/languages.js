// 확장자 → 문법. **문법 파일은 확장 안에 실려 온다** (`vendor/`, `scripts/fetch-grammars.mjs`).
//
// ⚠️ **`.tsx` 는 `.ts` 와 다른 문법이다.** 같은 npm 패키지가 wasm 을 둘 담고 있어 한 언어처럼
// 보이지만, `.tsx` 를 typescript 문법으로 파싱하면 **예외가 아니라 오류 트리**가 나온다 —
// 이 워크스페이스 실측으로 243개 중 208개가 그랬다. 갈라 실은 뒤 오류는 1,002개 중 6개다.
// 실패가 조용해서(빈 결과) 한참 못 알아챈다.

const LANGUAGES = {
  '.ts': { id: 'typescript', wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm' },
  '.tsx': { id: 'tsx', wasm: 'tree-sitter-typescript/tree-sitter-tsx.wasm' },
  '.kt': { id: 'kotlin', wasm: 'tree-sitter-kotlin/tree-sitter-kotlin.wasm' },
  '.java': { id: 'java', wasm: 'tree-sitter-java/tree-sitter-java.wasm' },
}

/** 화면이 「무엇을 읽는지」 말할 때 쓰는 이름. 목록과 문구가 갈리면 한쪽이 낡는다 */
const READS = 'TypeScript · Kotlin · Java'

/** `listFiles` 에 넘길 glob. 여기 없는 확장자는 애초에 읽지 않는다 */
const GLOB = '**/*.{ts,tsx,kt,java}'

/** 경로 → 문법. 모르는 확장자면 null (호출자가 건너뛴다) */
function languageOf(path) {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? null : (LANGUAGES[path.slice(dot)] ?? null)
}

/**
 * `.tsx` 는 문법 id 가 `tsx` 지만 **추출 규칙은 typescript 와 같다.**
 * 규칙표를 두 벌 두면 한쪽만 고쳐진다.
 */
function rulesetOf(languageId) {
  return languageId === 'tsx' ? 'typescript' : languageId
}

module.exports = { LANGUAGES, GLOB, READS, languageOf, rulesetOf }
