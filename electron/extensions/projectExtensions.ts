import { describeError } from '../../shared/errors/describeError'
import type { ProjectRegistry } from '../projects/projectRegistry'

// **어느 프로젝트에 어느 확장이 켜져 있나.** 설치는 앱 전체에 한 번, 켜기는 프로젝트마다다
// (확장 재설계 §3). 켜진 이름은 프로젝트 기록(`ProjectRecord.extensions`)에 산다 —
// 프로젝트 폴더에는 쓰지 않는다 (사용자 레포에 파일이 생기면 git 변경으로 잡힌다).
//
// 이 파일은 상태를 쥐지 않는다. 정본은 `ProjectRegistry` 하나이고, 여기는 그 위에
// **이전(migration)** 과 「목록·싣기·거절이 같은 답을 보게」 하는 규칙만 얹는다.
// 그래서 호스트 쪽(`appLaunch.ts`)과 브리지 쪽(`main.ts`)이 따로 만들어도 어긋나지 않는다.
//
// **이전:** 기록에 `extensions` 가 없는 프로젝트는 이 기능 전에 만든 것이다. 처음 필요할 때
// 옛 앱 전체 기준(설치 − `settings.disabledExtensions`)으로 채워 저장한다 — 안 그러면 올라가는
// 순간 쓰던 확장이 전부 사라진다. 그 뒤로 `disabledExtensions` 는 **읽기만** 하고 쓰지 않는다.
//
// `installed` 를 매번 받는 이유가 그것이다 — 이전은 「지금 설치된 것」을 알아야 하는데,
// 그것을 아는 것은 훑기(`serviceLoad.ts`)다.

/** 이 파일이 레지스트리에서 쓰는 것만 — 시험에서 진짜 레지스트리를 그대로 끼운다 */
export type ExtensionRecords = Pick<
  ProjectRegistry,
  'all' | 'active' | 'whenRestored' | 'fillExtensions' | 'setExtension' | 'dropExtension'
>

export interface ProjectExtensionsPort {
  /** 그 프로젝트에 켜진 이름. 프로젝트가 없으면(`null`·모르는 id) **빈 집합** — 아무것도 안 켜져 있다 */
  enabledIn(projectId: string | null, installed: readonly string[]): Promise<ReadonlySet<string>>
  /** 어느 프로젝트에서든 켜진 이름. 호스트는 하나라 **이 합집합을** 싣는다 */
  enabledAnywhere(installed: readonly string[]): Promise<ReadonlySet<string>>
  /** 목록이 기준으로 삼는 프로젝트 (지금 활성) */
  active(): { id: string; name: string } | null
  /** 한 프로젝트에서 켜고 끈다. 모르는 프로젝트면 던진다 — 조용히 무시하면 토글이 아무 일도 안 한다 */
  set(projectId: string, name: string, enabled: boolean, installed: readonly string[]): Promise<void>
  /** 지운 확장을 **모든 프로젝트에서** 뺀다 */
  forget(name: string): Promise<void>
}

export interface ProjectExtensionsDeps {
  /**
   * 프로젝트 기록. **함수다** — 확장 호스트는 앱 수명이고 레지스트리는 창과 함께 생긴다.
   * 창이 없으면 null 이고, 그때는 어느 프로젝트에도 켜진 것이 없다.
   */
  registry: () => ExtensionRecords | null
  /** 옛 앱 전체 「꺼 둔 이름」. **이전에만** 읽는다 */
  legacyDisabled: () => Promise<readonly string[]>
  log?: (line: string) => void
}

export function createProjectExtensions(deps: ProjectExtensionsDeps): ProjectExtensionsPort {
  /** 이전을 마친 레지스트리. 창이 없으면 null */
  async function migrated(installed: readonly string[]): Promise<ExtensionRecords | null> {
    const registry = deps.registry()
    if (registry === null) return null
    // 복원 전에 물으면 기록이 비어 있어 **아무것도 안 켜진 것**으로 답하게 된다 (`whenRestored`)
    await registry.whenRestored()
    if (registry.all.some((project) => project.extensions === undefined)) {
      const off = new Set(await legacyDisabled())
      await registry.fillExtensions(installed.filter((name) => !off.has(name)))
    }
    return registry
  }

  /**
   * 설정을 못 읽으면 **꺼 둔 것이 없던 것으로** 친다 — 옛 규칙(`disabledNames`)과 같다.
   * 설정 파일 하나 때문에 올라가자마자 확장이 전부 사라지면 사용자가 원인을 짐작할 수 없다.
   */
  async function legacyDisabled(): Promise<readonly string[]> {
    try {
      return await deps.legacyDisabled()
    } catch (error) {
      deps.log?.(`[확장] 꺼둔 목록을 못 읽었다 — 전부 켜진 것으로 옮긴다: ${describeError(error)}`)
      return []
    }
  }

  return {
    async enabledIn(projectId, installed) {
      const registry = await migrated(installed)
      if (registry === null || projectId === null) return new Set()
      return new Set(registry.all.find((project) => project.id === projectId)?.extensions ?? [])
    },

    async enabledAnywhere(installed) {
      const registry = await migrated(installed)
      return new Set(registry?.all.flatMap((project) => project.extensions ?? []) ?? [])
    },

    active() {
      const project = deps.registry()?.active ?? null
      return project === null ? null : { id: project.id, name: project.name }
    },

    async set(projectId, name, enabled, installed) {
      const registry = await migrated(installed)
      if (registry === null || !(await registry.setExtension(projectId, name, enabled))) {
        throw new Error(`프로젝트를 찾지 못했습니다: ${projectId}`)
      }
    },

    async forget(name) {
      await deps.registry()?.dropExtension(name)
    },
  }
}
