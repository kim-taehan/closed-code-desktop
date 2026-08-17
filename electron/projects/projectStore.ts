import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describeError } from '../errors/describeError'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// projects.json 읽기/쓰기만 책임진다. 판단은 ProjectRegistry 가 한다.
//
// **영속 실패는 치명적이지 않다** (설계 §4.2).
// 읽기 실패는 빈 상태로 시작하고, 쓰기 실패는 로그만 남긴다 —
// 세션 복원은 편의지 정확성이 아니다. 여기서 예외를 던지면 앱이 못 뜬다.

export interface PersistedProjects {
  projects: ProjectRecord[]
  /** 마지막으로 열려 있던 프로젝트 id 들 (복원 대상) */
  openIds: string[]
  /** 마지막 활성 프로젝트 id */
  activeId: string | null
}

const EMPTY: PersistedProjects = { projects: [], openIds: [], activeId: null }

export function defaultStorePath(userDataDir: string): string {
  return join(userDataDir, 'projects.json')
}

export class ProjectStore {
  constructor(
    private readonly filePath: string,
    private readonly onError: (message: string) => void = (message) => console.warn(message),
  ) {}

  async load(): Promise<PersistedProjects> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return { ...EMPTY } // 파일이 없는 첫 실행. 오류가 아니다.
    }

    try {
      return normalize(JSON.parse(raw))
    } catch (error) {
      // 손상된 파일로 앱을 못 쓰게 만들지 않는다. 빈 상태로 시작한다.
      this.onError(`projects.json 을 읽지 못했습니다: ${describeError(error)}`)
      return { ...EMPTY }
    }
  }

  async save(state: PersistedProjects): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8')
    } catch (error) {
      this.onError(`projects.json 을 쓰지 못했습니다: ${describeError(error)}`)
    }
  }
}

/**
 * 신뢰할 수 없는 JSON 을 안전한 모양으로 되돌린다.
 * 항목 하나가 망가져도 나머지는 살린다 — 전부 버리면 사용자가 목록을 잃는다.
 */
function normalize(parsed: unknown): PersistedProjects {
  if (parsed === null || typeof parsed !== 'object') return { ...EMPTY }
  const source = parsed as Record<string, unknown>

  const projects = Array.isArray(source['projects'])
    ? source['projects'].map(toRecord).filter((record): record is ProjectRecord => record !== null)
    : []

  return {
    projects,
    openIds: toStringArray(source['openIds']),
    activeId: typeof source['activeId'] === 'string' ? source['activeId'] : null,
  }
}

function toRecord(value: unknown): ProjectRecord | null {
  if (value === null || typeof value !== 'object') return null
  const source = value as Record<string, unknown>

  const id = source['id']
  const root = source['root']
  // id 와 root 가 없으면 가리킬 대상이 없다 — 복구할 수 없으므로 버린다
  if (typeof id !== 'string' || typeof root !== 'string') return null

  return {
    id,
    root,
    name: typeof source['name'] === 'string' ? source['name'] : root,
    favorite: source['favorite'] === true,
    lastOpenedAt: typeof source['lastOpenedAt'] === 'number' ? source['lastOpenedAt'] : 0,
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
