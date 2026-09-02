// 설계 §2: .ts/.tsx 파일당 300줄 상한. 위반 시 종료 코드 1.
//
// 상한과 함께 **날 NUL 바이트**도 여기서 막는다. 전 소스를 이미 읽고 있어 값이 거의 공짜인데,
// 놓치면 비싸다: git 은 NUL 이 든 파일을 바이너리로 보고 `diff`·`blame`·리뷰 도구가
// 그 파일의 변경을 **한 줄도 안 보여 준다**. 이 레포의 주석은 실측 근거인데
// 거기서 근거가 지워져도 아무도 못 본다 (2026-08-16 에 세 파일에서 실제로 났다).
// 값이 필요하면 소스에는 `'\0'` 이스케이프로 적는다 — 런타임 값은 같다.
//
// **NUL 검사만 `.js` 까지 본다** (2026-08-28). 확장은 `.js` 로 쓰는데, 그쪽에서 날 NUL 이
// 실제로 새어 나갔다 — 복합키 구분자로 넣은 것이 `core/graph.js` 를 통째로 바이너리로
// 만들어 커밋에 `Bin 0 -> 4302 bytes` 로 들어갔다. 줄 수 상한은 그대로 `.ts/.tsx` 만이다 —
// 그건 우리가 쓰는 코드에 대한 규칙이고, 날 NUL 은 **git 이 그 파일을 안 보여 주는** 문제라
// 성격이 다르다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LINES = 300
const ROOTS = ['src', 'electron', 'shared', 'tests', 'extensions']
// `vendor` — 확장이 싣는 남의 산출물(문법 wasm·런타임). 우리가 쓴 코드가 아니다
const SKIP = new Set(['node_modules', 'dist', 'dist-electron', 'vendor'])

function collect(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.(tsx?|js)$/.test(entry)) out.push(full)
  }
  return out
}

const sources = ROOTS.flatMap(collect).map((file) => ({ file, text: readFileSync(file, 'utf8') }))

const binaries = sources.filter(({ text }) => text.includes('\0')).map(({ file }) => file)

if (binaries.length > 0) {
  console.error(`날 NUL 바이트가 든 파일 ${binaries.length}개 (git 이 바이너리로 읽는다):`)
  for (const file of binaries) console.error(`  ${file}`)
  console.error(`  고침: 리터럴의 날 NUL 을 '\\0' 이스케이프로. 런타임 값은 같다.`)
  process.exit(1)
}

const violations = sources
  .filter(({ file }) => /\.tsx?$/.test(file))
  .map(({ file, text }) => ({ file, lines: text.split('\n').length }))
  .filter(({ lines }) => lines > MAX_LINES)
  .sort((a, b) => b.lines - a.lines)

if (violations.length > 0) {
  console.error(`${MAX_LINES}줄 상한을 넘긴 파일 ${violations.length}개:`)
  for (const { file, lines } of violations) console.error(`  ${lines}줄  ${file}`)
  process.exit(1)
}

console.log(`파일 크기 검사 통과 (상한 ${MAX_LINES}줄, NUL 없음)`)
