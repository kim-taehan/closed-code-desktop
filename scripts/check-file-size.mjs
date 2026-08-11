// 설계 §2: .ts/.tsx 파일당 300줄 상한. 위반 시 종료 코드 1.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LINES = 300
const ROOTS = ['src', 'electron', 'shared', 'tests', 'extensions']
const SKIP = new Set(['node_modules', 'dist', 'dist-electron'])

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
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const violations = ROOTS.flatMap(collect)
  .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n').length }))
  .filter(({ lines }) => lines > MAX_LINES)
  .sort((a, b) => b.lines - a.lines)

if (violations.length > 0) {
  console.error(`${MAX_LINES}줄 상한을 넘긴 파일 ${violations.length}개:`)
  for (const { file, lines } of violations) console.error(`  ${lines}줄  ${file}`)
  process.exit(1)
}

console.log(`파일 크기 검사 통과 (상한 ${MAX_LINES}줄)`)
