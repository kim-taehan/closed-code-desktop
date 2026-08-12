import { registerMcpServer } from './register'
import { McpServer } from './server'
import { createToolRunner, type McpToolPorts } from './tools'

// 데스크톱 MCP 서버의 **수명과 등록 시점**만 쥐는 자리. 프로토콜은 `rpc.ts`,
// HTTP 경계는 `server.ts`, opencode 쪽 호출은 `register.ts` 가 한다.
//
// 등록 시점이 여기 모이는 이유: opencode 의 등록은 **instance 수명**이다 (실측 —
// `POST /instance/dispose` 뒤 `GET /mcp` 가 `{}` 다). 그래서 "앱 시작 시 한 번" 으로는
// 부족하고, **프로젝트 세션이 opencode 에 붙을 때마다** 다시 등록해야 한다.
// 그 신호를 주는 곳은 `SessionBridge` 다 (핸드셰이크가 ready 로 갈 때).
//
// **등록 실패는 연결 실패가 아니다.** 로그만 남기고 세션은 그대로 산다 — MCP 는 있으면
// 좋은 것이지 앱의 조건이 아니다 (공여 `server.ts:52` 의 원칙 그대로).

export interface DesktopMcpOptions {
  /**
   * **매번 읽는다** — 스위치(`desktopMcp`)도 서버 주소(`opencodeUrl`)도 설정탭에서
   * 바뀌고, 그때 앱을 다시 띄우지 않아도 되어야 한다. `SettingsStore.load()` 는
   * 캐시라 디스크를 다시 읽지 않는다.
   */
  settings: () => Promise<{ desktopMcp: boolean; opencodeUrl: string }>
  ports: McpToolPorts
  password?: string
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export class DesktopMcp {
  private readonly server: McpServer
  /** 지금 opencode 에 등록돼 있다고 보는 프로젝트. 재연결하면 지워졌다 다시 채워진다. */
  private readonly registered = new Set<string>()

  constructor(private readonly options: DesktopMcpOptions) {
    this.server = new McpServer(createToolRunner(options.ports))
  }

  /**
   * 프로젝트 세션이 opencode 에 붙었다. 우리 서버를 그 디렉토리에 등록한다.
   *
   * 같은 프로젝트로 두 번 불려도 한 번만 한다 — 핸드셰이크가 ready 인 동안에도
   * 소켓 상태 변화로 같은 상태가 여러 번 올라온다 (`ProjectSession.emitState`).
   */
  async onProjectReady(project: { id: string; root: string }): Promise<void> {
    if (this.registered.has(project.id)) return
    // 자리를 **await 전에** 잡는다. 이 사이에 같은 프로젝트가 또 들어오면 등록이 겹치고,
    // 그러면 opencode 가 같은 이름으로 두 번 붙었다 떼는 동안 도구 목록이 흔들린다.
    this.registered.add(project.id)

    try {
      const settings = await this.options.settings()
      // 꺼져 있으면 자리를 비운다 — 사용자가 나중에 켜면 다음 ready 에 등록되어야 한다
      if (!settings.desktopMcp) {
        this.registered.delete(project.id)
        return
      }

      await this.server.start()
      const address = this.server.address()
      if (address === null) throw new Error('MCP 서버가 포트를 잡지 못했습니다')

      const result = await registerMcpServer({
        opencodeUrl: settings.opencodeUrl,
        directory: project.root,
        projectId: project.id,
        address,
        ...(this.options.password !== undefined ? { password: this.options.password } : {}),
        ...(this.options.fetchImpl !== undefined ? { fetchImpl: this.options.fetchImpl } : {}),
      })
      // **사유를 함께 남긴다.** 등록 실패는 화면에 아무 증상이 없는 종류다 — 도구가 그냥
      // 안 뜬다. 로그가 유일한 단서인데 `failed` 만 남기면 방화벽인지 포트 충돌인지
      // 주소 오타인지 구별할 수 없다. 원인은 opencode 가 주는 `error` 에만 있다.
      const why = result.error === undefined ? '' : ` (${result.error})`
      this.log(`opencode 에 MCP 등록: ${project.root} → ${result.status}${why}`)
      // connected 가 아니면 붙지 못한 것이다. 다음 ready 에 다시 시도하게 자리를 비운다.
      if (result.status !== 'connected') this.registered.delete(project.id)
    } catch (error) {
      this.registered.delete(project.id)
      this.log(`MCP 등록 실패 (${project.root}): ${describe(error)}`)
    }
  }

  /**
   * 세션이 ready 를 벗어났다(끊김·탭 닫힘). **opencode 쪽 등록을 지우지 않는다** —
   * 지울 수 있는 경로가 `POST /mcp/{name}/disconnect` 하나뿐이고 이름이 앱 단위라
   * 그걸 부르면 **다른 프로젝트의 등록까지 끊긴다.** 여기서는 "다음에 붙으면 다시
   * 등록한다" 는 표시만 남긴다. 죽은 등록은 instance 가 사라질 때 함께 사라진다.
   */
  onProjectLost(projectId: string): void {
    this.registered.delete(projectId)
  }

  /**
   * 창이 통째로 사라졌다 (macOS 는 이때 앱이 안 죽는다). **서버는 계속 듣는다** —
   * 포트와 토큰이 바뀌면 opencode 에 등록된 주소가 죽기 때문이다.
   *
   * 등록 표시만 비운다. 창을 되살리면 세션이 새로 붙고 `onSessionReady` 가 다시 오는데,
   * 표시가 남아 있으면 **전부 "이미 등록됨" 으로 걸러진다** — 그 사이 opencode 가
   * 재기동됐다면 도구가 조용히 사라진 채로 굳는다.
   */
  forgetRegistrations(): void {
    this.registered.clear()
  }

  async dispose(): Promise<void> {
    this.registered.clear()
    await this.server.stop()
  }

  private log(line: string): void {
    this.options.log?.(line)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
