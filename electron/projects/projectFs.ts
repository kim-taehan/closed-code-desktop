import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { shell } from 'electron'
import { resolveInside } from '../fs/resolveInside'

// 프로젝트 파일을 읽는 유일한 통로.
//
// **열린 프로젝트 루트 아래만 읽는다.** 이게 이 파일의 존재 이유다 —
// renderer 가 경로를 만들어 보내므로, 경계를 main 이 쥐지 않으면
// `..` 하나로 홈 디렉토리 전체가 읽힌다.
//
// 쓰기는 **덮어쓰기만** 한다. 만들기·지우기·이름변경은 요청이 없어 두지 않는다.

/**
 * 트리에서 감출 항목.
 *
 * 점 파일 전부를 감추지는 않는다 — `.claude` `.github` 처럼 사람이 직접 보는 것도 있다.
 * 여기 있는 것은 **내용을 사람이 읽을 일이 없는데 양이 많아** 정작 소스를 밀어내는 것들이다.
 */
const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store'])

export interface DirEntry {
  name: string
  /** 프로젝트 루트 기준 상대경로. 화면과 대화가 쓰는 것은 이 값이다. */
  path: string
  isDirectory: boolean
}

export type ReadDirResult =
  | { ok: true; entries: DirEntry[] }
  | { ok: false; reason: 'not_allowed' | 'unreadable' }

export type ReadFileResult =
  | { ok: true; text: string; mtimeMs: number }
  | { ok: false; reason: 'not_allowed' | 'unreadable' | 'too_large' | 'binary' }

export type WriteFileResult =
  | { ok: true; mtimeMs: number }
  /** stale: 연 뒤에 누군가 고쳤다 — 에이전트가 고쳤을 수 있다 */
  | { ok: false; reason: 'not_allowed' | 'unwritable' | 'stale' }

export type OpenExternalResult = { ok: true } | { ok: false; reason: string }

/**
 * 열 수 있는 최대 크기.
 *
 * 뷰어는 내용을 통째로 화면 상태에 올린다 — 큰 파일을 넣으면 앱이 멈춘다.
 * 소스 코드를 보는 것이 목적이라 이 정도면 충분하다.
 */
export const MAX_FILE_BYTES = 512 * 1024

/** 어떤 프로젝트가 열려 있는지 아는 쪽. 레지스트리가 이 모양을 만족한다. */
export interface OpenRootSource {
  openProjects: { id: string; root: string }[]
}

export class ProjectFs {
  constructor(private readonly source: OpenRootSource) {}

  /**
   * 프로젝트 안의 디렉토리 한 겹을 읽는다.
   *
   * 한 겹만 읽는 이유는 큰 저장소에서 전체를 훑으면 앱이 멈추기 때문이다.
   * 화면이 펼칠 때마다 다시 부른다.
   */
  async readDir(projectId: string, relativePath = ''): Promise<ReadDirResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, reason: 'not_allowed' }

    const target = await resolveInside(root, relativePath)
    if (target === null) return { ok: false, reason: 'not_allowed' }

    try {
      const found = await readdir(target, { withFileTypes: true })
      const entries = found
        .filter((entry) => !HIDDEN.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          path: toPosix(relative(root, join(target, entry.name))),
          isDirectory: entry.isDirectory(),
        }))
      return { ok: true, entries: sortEntries(entries) }
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
  }

  /**
   * 파일 하나를 텍스트로 읽는다. 경계는 readDir 과 같다.
   *
   * 바이너리는 거부한다 — 화면에 깨진 글자를 쏟아내는 것보다 못 연다고 말하는 게 낫다.
   */
  async readFile(projectId: string, relativePath: string): Promise<ReadFileResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, reason: 'not_allowed' }

    const target = await resolveInside(root, relativePath)
    if (target === null) return { ok: false, reason: 'not_allowed' }

    try {
      const info = await stat(target)
      if (!info.isFile()) return { ok: false, reason: 'not_allowed' }
      if (info.size > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' }

      const buffer = await readFile(target)
      // NUL 바이트는 텍스트에 나오지 않는다 — 있으면 바이너리로 본다
      if (buffer.includes(0)) return { ok: false, reason: 'binary' }
      // mtime 을 함께 준다 — 저장할 때 그 사이 바뀌었는지 판단하는 근거다
      return { ok: true, text: buffer.toString('utf8'), mtimeMs: info.mtimeMs }
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
  }

  /**
   * 파일을 덮어쓴다. 경계는 읽기와 같다.
   *
   * **연 뒤에 파일이 바뀌었으면 거절한다** — 에이전트도 같은 파일을 고친다.
   * 그대로 쓰면 에이전트가 방금 한 수정을 조용히 지운다.
   * 판단은 mtime 으로 한다. 화면이 연 시점의 값을 들고 와야 한다.
   */
  async writeFile(
    projectId: string,
    relativePath: string,
    text: string,
    expectedMtimeMs: number,
  ): Promise<WriteFileResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, reason: 'not_allowed' }

    const target = await resolveInside(root, relativePath)
    if (target === null) return { ok: false, reason: 'not_allowed' }

    try {
      const before = await stat(target)
      if (!before.isFile()) return { ok: false, reason: 'not_allowed' }
      // 1ms 오차는 파일시스템에 따라 생긴다. 같은 밀리초면 그대로 본다.
      if (Math.abs(before.mtimeMs - expectedMtimeMs) > 1) return { ok: false, reason: 'stale' }

      await writeFile(target, text, 'utf8')
      return { ok: true, mtimeMs: (await stat(target)).mtimeMs }
    } catch {
      return { ok: false, reason: 'unwritable' }
    }
  }

  /**
   * OS 로 연다. mode='external' 은 기본 앱으로, 'reveal' 은 Finder 에서 위치만 보여준다.
   * 경계는 읽기와 같다 — 루트 밖은 열지 않는다.
   */
  async openInOs(
    projectId: string,
    relativePath: string,
    mode: 'external' | 'reveal',
  ): Promise<OpenExternalResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, reason: 'not_allowed' }

    const target = await resolveInside(root, relativePath)
    if (target === null) return { ok: false, reason: 'not_allowed' }

    if (mode === 'reveal') {
      shell.showItemInFolder(target)
      return { ok: true }
    }
    // shell.openPath 는 성공 시 빈 문자열, 실패 시 에러 메시지를 준다
    const error = await shell.openPath(target)
    return error ? { ok: false, reason: error } : { ok: true }
  }

  private rootOf(projectId: string): string | null {
    return this.source.openProjects.find((project) => project.id === projectId)?.root ?? null
  }
}

/** 디렉토리 먼저, 그 안에서 이름순. 화면이 다시 정렬하지 않게 여기서 정한다. */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** 대화에 넣는 경로는 플랫폼과 무관하게 / 로 쓴다 */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}
