import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

// 프로젝트 안을 훑는다 — 파일 목록(빠른 열기)과 내용 검색.
//
// 경계는 ProjectFs 와 같다: **열린 프로젝트 루트 아래만**.
// 심링크는 따라가지 않는다 — 밖으로 나가거나 순환에 빠진다.
//
// 상한을 두는 이유는 큰 저장소에서 앱이 멈추기 때문이다.
// 잘렸다는 사실은 감추지 않는다 — 없는 줄 알면 다시 찾지 않는다.

/** 트리와 같은 이유로 감춘다 (내용을 사람이 읽을 일이 없는데 양이 많다) */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', '__pycache__'])

export const MAX_FILES = 20_000
export const MAX_MATCHES = 500
/** 이보다 큰 파일은 훑지 않는다 */
const MAX_GREP_BYTES = 2 * 1024 * 1024

export interface SearchMatch {
  /** 루트 기준 상대경로 */
  file: string
  line: number
  /** 그 줄 내용 (앞뒤를 자른 것) */
  preview: string
}

export interface FileListResult {
  files: string[]
  /** 디렉토리 경로 — `@` 자동완성에서 폴더도 고를 수 있어야 한다 (빠른 열기는 쓰지 않는다) */
  dirs: string[]
  truncated: boolean
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

/** 프로젝트 안의 파일·디렉토리 경로를 모은다 (빠른 열기·`@` 자동완성용) */
export async function listFiles(root: string): Promise<FileListResult> {
  const files: string[] = []
  const dirs: string[] = []
  let truncated = false

  await walk(
    root,
    root,
    (relativePath) => {
      if (files.length >= MAX_FILES) {
        truncated = true
        return false
      }
      files.push(relativePath)
      return true
    },
    (relativePath) => {
      // 디렉토리도 같은 상한을 쓴다 — 파일과 같은 이유(큰 저장소에서 앱이 멈춘다)다
      if (dirs.length < MAX_FILES) dirs.push(relativePath)
    },
  )

  return { files, dirs, truncated }
}

/** 내용에서 문자열을 찾는다. 대소문자를 가리지 않는다. */
export async function searchText(root: string, query: string): Promise<SearchResult> {
  const needle = query.toLowerCase()
  if (needle === '') return { matches: [], truncated: false }

  const matches: SearchMatch[] = []
  let truncated = false

  await walk(root, root, async (relativePath, absolutePath) => {
    if (truncated) return false

    const found = await grepFile(absolutePath, relativePath, needle, MAX_MATCHES - matches.length)
    matches.push(...found)
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      return false
    }
    return true
  })

  return { matches, truncated }
}

/** 디렉토리를 너비 우선으로 훑는다. visit 이 false 를 주면 멈춘다. */
async function walk(
  root: string,
  dir: string,
  visit: (relativePath: string, absolutePath: string) => boolean | Promise<boolean>,
  /** 들어가는 디렉토리마다 부른다 (목록에 폴더가 필요한 쪽만 준다) */
  onDir?: (relativePath: string) => void,
): Promise<boolean> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return true // 못 읽는 디렉토리는 건너뛴다 — 전체를 실패시키지 않는다
  }

  for (const entry of entries) {
    // 심링크는 따라가지 않는다: 루트 밖으로 나가거나 순환에 빠진다
    if (entry.isSymbolicLink()) continue

    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      onDir?.(relative(root, absolute).split(sep).join('/'))
      if (!(await walk(root, absolute, visit, onDir))) return false
      continue
    }
    if (!entry.isFile()) continue

    const relativePath = relative(root, absolute).split(sep).join('/')
    if (!(await visit(relativePath, absolute))) return false
  }
  return true
}

async function grepFile(
  absolutePath: string,
  relativePath: string,
  needle: string,
  room: number,
): Promise<SearchMatch[]> {
  try {
    const info = await stat(absolutePath)
    if (info.size > MAX_GREP_BYTES) return []

    const buffer = await readFile(absolutePath)
    // NUL 이 있으면 바이너리다 — 훑어 봐야 의미 없는 결과만 나온다
    if (buffer.includes(0)) return []

    const found: SearchMatch[] = []
    const lines = buffer.toString('utf8').split('\n')
    for (let index = 0; index < lines.length && found.length < room; index++) {
      const line = lines[index]!
      if (!line.toLowerCase().includes(needle)) continue
      found.push({ file: relativePath, line: index + 1, preview: trim(line) })
    }
    return found
  } catch {
    return []
  }
}

/** 긴 줄은 잘라 보여준다 — 화면을 밀어내지 않게 */
function trim(line: string): string {
  const text = line.trim()
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}
