import { ProjectFs } from '../projects/projectFs'
import { parseGlob } from './globFilter'

// `code.workspace.*` 의 실제 구현. **main 안에서 돈다.**
//
// 확장(자식)이 아니라 여기서 파일을 여는 이유가 둘이다:
// 1. 어떤 프로젝트가 열려 있는지는 main 만 안다. 자식에 사본을 두면 프로젝트를 바꾼 뒤
//    낡은 루트로 읽는다.
// 2. `ProjectFs` 머리말이 "프로젝트 파일을 읽는 유일한 통로" 라고 못 박았다.
//    확장용 읽기 경로를 따로 만들면 경계·크기 상한·바이너리 판정이 두 벌이 된다.
//
// 그래서 여기서는 `ProjectFs` 를 그대로 쓴다 — 경로 탈출 차단(`resolveInside`)·
// 512KB 상한·바이너리 거부·`.git`/`node_modules` 숨김이 전부 거기 있는 것들이다.

/** 확장이 훑을 수 있는 최대 파일 수. */
//
// 확장은 이 목록을 받아 **한 건씩 readFile 을 부른다** — 목록 길이가 그대로 RPC 왕복 수다.
// 5천이면 왕복이 1ms 라 쳐도 5초다. 여기서 안 끊으면 확장 하나가 호스트를 붙잡는다.
export const MAX_LIST_FILES = 5_000

/** 훑을 수 있는 최대 디렉토리 수. 파일이 안 걸려도 걷기 자체가 끝나야 한다. */
export const MAX_WALK_DIRS = 2_000

/** 열린 프로젝트를 아는 쪽. `ProjectRegistry` 가 이 모양을 만족한다. */
export interface ActiveProjectSource {
  readonly active: { id: string; root: string } | null
  readonly openProjects: { id: string; root: string }[]
}

export class ExtensionWorkspace {
  private readonly fs: ProjectFs

  /**
   * 프로젝트는 **창이 뜬 뒤에** 정해지는데 확장 호스트는 앱 수명이라 그보다 먼저 뜬다.
   * 그래서 인스턴스가 아니라 조회 함수를 받는다.
   */
  constructor(private readonly source: () => ActiveProjectSource | null) {
    this.fs = new ProjectFs({
      get openProjects() {
        return source()?.openProjects ?? []
      },
    })
  }

  /** 현재 프로젝트의 절대경로. 열린 것이 없으면 던진다 — 빈 문자열을 주면 확장이 루트로 오해한다. */
  getProjectPath(): string {
    return this.requireActive().root
  }

  /**
   * glob 에 맞는 파일을 프로젝트 상대경로로 돌려준다.
   *
   * 걷기는 `ProjectFs.readDir` 로 한 겹씩 한다. 직접 `readdir` 하지 않는 이유는
   * 거기에 경계 판정과 숨김 목록(`.git`·`node_modules`)이 이미 들어 있어서다.
   *
   * ⚠️ **상한에 닿으면 `truncated` 가 참이다.** 예전에는 그냥 멈추고 목록만 돌려줘서,
   * 받는 쪽이 「이 프로젝트에 N개가 있다」와 「N개에서 끊겼다」를 **구분할 수 없었다.**
   * 실측 사례: 디렉토리 5,895개짜리 Java 프로젝트에서 3,723개 중 1,671개(55%)만 걸렸는데
   * 확장 화면에는 그것이 전부인 것처럼 떴다. 조용히 절반만 보여주는 것이 이 구멍이었다.
   */
  async listFiles(glob: string): Promise<{ files: string[]; truncated: boolean }> {
    const project = this.requireActive()
    const filter = parseGlob(glob)

    const files: string[] = []
    const queue = ['']
    let visited = 0

    while (queue.length > 0 && visited < MAX_WALK_DIRS) {
      const current = queue.shift() as string
      visited += 1

      const result = await this.fs.readDir(project.id, current)
      // 못 읽는 디렉토리 하나가 전체 훑기를 끝내지 않는다 — 읽히는 데까지 보여준다
      if (!result.ok) continue

      for (const entry of result.entries) {
        if (entry.isDirectory) {
          if (filter.recursive) queue.push(entry.path)
          continue
        }
        if (!filter.matches(entry.name)) continue
        files.push(entry.path)
        if (files.length >= MAX_LIST_FILES) return { files, truncated: true }
      }
    }

    // 큐가 남았는데 나왔다면 디렉토리 상한에 걸린 것이다 — 파일 상한과 사유가 다르지만
    // 받는 쪽에는 **똑같이 「전부가 아니다」**이므로 한 값으로 낸다
    return { files, truncated: queue.length > 0 }
  }

  /** 파일 하나를 텍스트로. 실패는 **던진다** — 확장 API 는 사유 객체가 아니라 예외로 말한다. */
  async readFile(relativePath: string): Promise<string> {
    const project = this.requireActive()
    const result = await this.fs.readFile(project.id, relativePath)
    if (!result.ok) throw new Error(`파일을 읽을 수 없습니다 (${result.reason}): ${relativePath}`)
    return result.text
  }

  private requireActive(): { id: string; root: string } {
    const active = this.source()?.active ?? null
    if (active === null) throw new Error('열린 프로젝트가 없습니다')
    return active
  }
}
