import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  MAX_OPEN_PROJECTS,
  pruneToRecentCap,
  sortProjects,
  type ProjectRecord,
} from '../../shared/projects/projectRecord'
import type { PersistedProjects, ProjectStore } from './projectStore'

// 프로젝트 목록의 유일한 판단 주체. 세션도 화면도 여기를 거친다.
//
// 동일성은 언제나 realpath 로 판정한다 — 심링크나 ../ 를 거쳐 들어와도 같은 프로젝트다.

export type OpenResult =
  | { ok: true; project: ProjectRecord; alreadyOpen: boolean }
  | { ok: false; reason: 'not_a_directory' | 'too_many_open'; message: string }

export interface RegistryDeps {
  store: ProjectStore
  /** 테스트에서 시간을 고정하기 위해 주입한다 */
  now?: () => number
  maxOpen?: number
}

export class ProjectRegistry {
  private projects: ProjectRecord[] = []
  private openIds: string[] = []
  private activeId: string | null = null

  private readonly now: () => number
  private readonly maxOpen: number

  constructor(private readonly deps: RegistryDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.maxOpen = deps.maxOpen ?? MAX_OPEN_PROJECTS
  }

  // 바깥에는 언제나 복사본을 준다 — 내부 레코드를 그대로 넘기면
  // 호출부가 레지스트리를 우회해 상태를 바꿀 수 있고, 저장도 되지 않는다.
  get all(): ProjectRecord[] {
    return sortProjects(this.projects).map(copy)
  }

  /**
   * 연 순서 그대로 준다. **정렬하지 않는다** —
   * 탭을 누를 때마다 lastOpenedAt 이 갱신되므로 최근순으로 정렬하면
   * 누를 때마다 탭이 자리를 옮겨 다음에 누를 곳을 예측할 수 없다.
   */
  get openProjects(): ProjectRecord[] {
    return this.openIds
      .map((id) => this.projects.find((project) => project.id === id))
      .filter((project): project is ProjectRecord => project !== undefined)
      .map(copy)
  }

  get active(): ProjectRecord | null {
    const found = this.projects.find((project) => project.id === this.activeId)
    return found ? copy(found) : null
  }

  /**
   * 저장된 상태를 읽고, 사라진 경로를 정리한다.
   * 폴더가 없어진 프로젝트를 목록에 남기면 열 때마다 실패한다.
   */
  async restore(): Promise<void> {
    const state = await this.deps.store.load()
    const alive: ProjectRecord[] = []
    for (const project of state.projects) {
      if (await isDirectory(project.root)) alive.push(project)
    }

    this.projects = alive
    const aliveIds = new Set(alive.map((project) => project.id))
    this.openIds = state.openIds.filter((id) => aliveIds.has(id)).slice(0, this.maxOpen)
    this.activeId = state.activeId !== null && aliveIds.has(state.activeId) ? state.activeId : null
    if (this.activeId === null) this.activeId = this.openIds[0] ?? null
  }

  /**
   * 폴더를 연다.
   *
   * 이미 열려 있으면 **거부가 아니라 전환한다** (설계 §4.3) —
   * 사용자 의도는 "이 프로젝트를 보고 싶다" 이므로 오류를 띄울 자리가 아니다.
   */
  async open(root: string): Promise<OpenResult> {
    const resolved = await resolveRoot(root)
    if (resolved === null) {
      return { ok: false, reason: 'not_a_directory', message: `폴더가 아닙니다: ${root}` }
    }

    const existing = this.projects.find((project) => project.root === resolved)
    if (existing) {
      const wasOpen = this.openIds.includes(existing.id)
      if (!wasOpen && this.openIds.length >= this.maxOpen) return this.tooMany()
      existing.lastOpenedAt = this.now()
      if (!wasOpen) this.openIds.push(existing.id)
      this.activeId = existing.id
      await this.persist()
      return { ok: true, project: copy(existing), alreadyOpen: wasOpen }
    }

    if (this.openIds.length >= this.maxOpen) return this.tooMany()

    const project: ProjectRecord = {
      id: randomUUID(),
      root: resolved,
      name: basename(resolved) || resolved,
      favorite: false,
      lastOpenedAt: this.now(),
    }
    this.projects.push(project)
    this.openIds.push(project.id)
    this.activeId = project.id
    await this.persist()
    return { ok: true, project: copy(project), alreadyOpen: false }
  }

  /** 목록에서 지우지는 않는다 — 최근 목록에 남아야 다시 열 수 있다. */
  async close(id: string): Promise<void> {
    this.openIds = this.openIds.filter((openId) => openId !== id)
    if (this.activeId === id) this.activeId = this.openIds[0] ?? null
    await this.persist()
  }

  async activate(id: string): Promise<boolean> {
    if (!this.openIds.includes(id)) return false
    this.activeId = id
    const project = this.projects.find((candidate) => candidate.id === id)
    if (project) project.lastOpenedAt = this.now()
    await this.persist()
    return true
  }

  /** 표시용 이름만 바꾼다. root 는 불변이므로 동일성은 그대로다. */
  async rename(id: string, name: string): Promise<boolean> {
    const project = this.projects.find((candidate) => candidate.id === id)
    const trimmed = name.trim()
    if (!project || trimmed === '') return false
    project.name = trimmed
    await this.persist()
    return true
  }

  async setFavorite(id: string, favorite: boolean): Promise<boolean> {
    const project = this.projects.find((candidate) => candidate.id === id)
    if (!project) return false
    project.favorite = favorite
    await this.persist()
    return true
  }

  private tooMany(): OpenResult {
    return {
      ok: false,
      reason: 'too_many_open',
      message: `프로젝트는 최대 ${this.maxOpen}개까지 열 수 있습니다. 닫을 프로젝트를 선택하세요.`,
    }
  }

  /** 저장 직전에만 상한을 적용한다 — 열려 있는 것은 상한과 무관하게 남긴다. */
  private async persist(): Promise<void> {
    const pruned = pruneToRecentCap(this.projects)
    const keep = new Set([...pruned.map((project) => project.id), ...this.openIds])
    this.projects = this.projects.filter((project) => keep.has(project.id))

    const state: PersistedProjects = {
      projects: this.projects,
      openIds: this.openIds,
      activeId: this.activeId,
    }
    await this.deps.store.save(state)
  }
}

function copy(project: ProjectRecord): ProjectRecord {
  return { ...project }
}

async function resolveRoot(root: string): Promise<string | null> {
  try {
    const resolved = await realpath(root)
    return (await stat(resolved)).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return (await resolveRoot(path)) !== null
}
