import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { shell } from 'electron'
import { resolveInside, resolveNewInside } from '../fs/resolveInside'
import type { ProjectFsAction, ProjectFsResult } from '../../shared/ipc/projectFsPayloads'

// 프로젝트 파일을 읽는 유일한 통로.
//
// **열린 프로젝트 루트 아래만 읽는다.** 이게 이 파일의 존재 이유다 —
// renderer 가 경로를 만들어 보내므로, 경계를 main 이 쥐지 않으면
// `..` 하나로 홈 디렉토리 전체가 읽힌다.
//
// 쓰기는 오래도록 **덮어쓰기만** 했다 — 만들기·지우기·이름변경은 요청이 없었다.
// 2026-08-18 에 파일 트리 우클릭 메뉴가 생기며 넷이 붙었다 (`fsAction`). 경계는 그대로다:
// **만드는 자리도 루트 안이어야 한다.** 없는 경로는 `realpath` 로 못 재므로 그쪽은
// `resolveNewInside` 가 부모를 펴서 판정한다.
//
// **지우지 않는다 — 휴지통으로 보낸다.** 되돌릴 수 없는 조작을 앱이 대신 결정하지 않는다.

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

  /**
   * 만들고 옮기고 버린다 (`project:fsAction`).
   *
   * 갈래마다 **경계를 재는 함수가 다르다**: 있는 것을 가리키면 `resolveInside`,
   * 아직 없는 자리를 가리키면 `resolveNewInside`. 이름 바꾸기는 **둘 다** 쓴다 —
   * 원본은 있어야 하고 목적지는 없어야 한다.
   */
  async fsAction(projectId: string, action: ProjectFsAction): Promise<ProjectFsResult> {
    const root = this.rootOf(projectId)
    if (root === null) return { ok: false, reason: 'not_allowed' }

    try {
      if (action.kind === 'newFile' || action.kind === 'newDir') {
        const target = await resolveNewInside(root, action.path)
        if (target === null) return { ok: false, reason: 'not_allowed' }
        // **덮어쓰지 않는다.** 있는 파일을 조용히 비우는 것이 이 조작의 최악이다.
        // `wx` 는 그 판정을 파일시스템에게 맡긴다 — 있나 보고 쓰는 두 걸음 사이에
        // 남이 만들면 우리 검사가 늦는다.
        if (action.kind === 'newFile') {
          await writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
          return { ok: true }
        }
        // **부모가 있어야 만든다.** `recursive` 는 「이미 있으면 넘어간다」를 위한 것이지
        // 중간 폴더를 만들라는 뜻이 아니다 — 부모가 없으면 위 `resolveNewInside` 가
        // 이미 거부했다. 경계를 재는 길이 부모를 실경로로 펴는 것이라 그 위는 잴 수 없다.
        await mkdir(target, { recursive: true })
        return { ok: true }
      }

      const source = await resolveInside(root, action.path)
      // 옮기거나 버릴 것이 없다. 경계 위반과 가르는 이유는 사용자가 할 일이 달라서다 —
      // 앞은 목록이 낡은 것이고(다시 읽으면 된다), 뒤는 잘못 가리킨 것이다.
      if (source === null) return { ok: false, reason: 'missing' }

      if (action.kind === 'trash') {
        // **지우지 않는다.** 휴지통이 없는 환경에서는 던지고, 그때도 파일은 그대로 남는다.
        await shell.trashItem(source)
        return { ok: true }
      }

      const target = await resolveNewInside(root, action.to)
      if (target === null) return { ok: false, reason: 'not_allowed' }
      // **덮어쓰지 않는다.** `rename` 은 목적지가 있으면 말없이 지운다 — 이름을 잘못
      // 적은 한 번에 남의 파일이 사라지는 자리다. 여기만 검사와 실행 사이가 벌어지는데
      // (`wx` 같은 원자적 갈래가 없다), 그 틈에 남이 그 이름을 만드는 것보다
      // 사람이 오타로 덮는 쪽이 비교할 수 없이 흔하다.
      if (await exists(target)) return { ok: false, reason: 'exists' }
      await rename(source, target)
      return { ok: true }
    } catch (error) {
      // 이미 있는 것(`EEXIST`)만 갈라 준다 — 화면이 「다른 이름을 쓰세요」로 안내할 수 있다
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return { ok: false, reason: 'exists' }
      return { ok: false, reason: 'failed', detail: describe(error) }
    }
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

/** 그 자리에 무언가 있나. 종류는 안 본다 — 이름이 겹치면 파일이든 폴더든 못 옮긴다. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 실패 원문. 화면은 이걸 그대로 보여주지 않고 사유 코드로 문구를 고른다. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 대화에 넣는 경로는 플랫폼과 무관하게 / 로 쓴다 */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}
