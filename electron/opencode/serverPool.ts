import { findOpencodeBinary, notFoundMessage } from './binary'
import { startOpencodeServer, type SpawnedServer } from './serverProcess'
import type { ServerPidStore } from './pidStore'
import type { ServerStatusPayload } from '../../shared/ipc/diagnosticsTypes'

// **프로젝트마다 opencode 서버 하나.** 이 파일이 "이 앱은 사용자가 띄운 서버에 붙는다" 를 끝낸다.
//
// 왜 우리가 띄우는가: **폐쇄망 현장 개발자는 터미널에서 `opencode serve` 를 칠 수 없다.**
// "사용자가 띄운 것에 붙는다" 는 지금까지의 가정은 개발 환경에서만 성립하던 것이고,
// 그 가정을 근거로 적힌 주석이 여러 곳에 있었다 (`endpoint.ts`·`mcp/register.ts`·
// `runtime/locator.ts`·`session/projectSession.ts`) — 전부 이 파일을 가리키게 고쳤다.
//
// **붙는 경로를 남기지 않았다.** 설정 `opencodeUrl`(전역 주소 한 개)은 통째로 지웠다.
// 개발용 환경변수 오버라이드도 두지 않는다 — 제품이 안 쓰는 분기는 아무도 안 밟는 채로 낡고,
// "왜 내 앱은 서버를 안 띄우지" 를 진단할 때 가장 먼저 의심해야 할 자리가 된다.
// 시험용 이음매는 환경변수가 아니라 **주입**(`ServerPoolOptions.start`)으로 낸다.
// 실행 파일 위치를 바꿔야 하는 사람에게는 `OPENCODE_BIN` 이 그대로 남아 있다 (`binary.ts`).
//
// ⚠️ **격리는 절반이다.** 서버가 갈리면 **MCP 등록**(instance 수명)과 설정 캐시는 갈리지만,
// **세션 저장소는 서버끼리 공유된다** (실측 — A 에서 만든 대화를 B 가 즉시 본다).
// 그래서 이것을 "프로젝트 격리" 라고 부르면 안 된다. 대화가 새지 않게 막는 것은
// 여전히 `transport.ts` 의 sessionID 필터 하나뿐이다.
//
// ⚠️ **우리가 띄운 것만 끈다.** 표에 있는 자식만 kill 한다 — 사용자가 손으로 띄운 서버가
// 같은 기계에 살아 있을 수 있고, `pkill -f opencode` 류의 넓은 종료는 그것까지 죽인다.

export interface ServerPoolOptions {
  /**
   * 서버 하나를 띄운다. **주입 지점** — 시험은 진짜 프로세스를 띄우지 않는다.
   * 기본 구현은 `binary.ts` 로 실행 파일을 찾아 `serverProcess.ts` 로 띄운다.
   */
  start?: (root: string) => Promise<SpawnedServer>
  /**
   * 띄운 PID 를 적어 두는 곳 (`pidStore.ts`). 없으면 안 적는다 — 시험이 그렇게 돈다.
   *
   * **훅이 안 도는 종료(SIGKILL·크래시·전원 차단)의 그물이다.** 우리가 곱게 거둔 것은
   * 지우므로, 파일에 남아 있다는 것은 곧 "지난 실행이 안 거둔 것" 이다.
   */
  pids?: ServerPidStore
  log?: (line: string) => void
}

/** 실행 파일을 찾아 서버 하나를 띄운다. 못 찾으면 **어디를 봤는지 통째로** 사유에 싣는다. */
function defaultStart(root: string, log?: (line: string) => void): Promise<SpawnedServer> {
  const lookup = findOpencodeBinary()
  if (lookup.path === null) return Promise.reject(new Error(notFoundMessage(lookup)))
  return startOpencodeServer({
    binPath: lookup.path,
    cwd: root,
    // 서버 로그를 데스크톱 로그로 흘린다. 우리가 띄운 프로세스라 **여기가 유일한 창**이다 —
    // 사용자에게는 터미널이 없다.
    ...(log ? { log: (line: string) => log(`[opencode] ${line}`) } : {}),
  })
}

export class OpencodeServerPool {
  /** projectId → 띄워 둔 서버 */
  private readonly servers = new Map<string, SpawnedServer>()
  /** 같은 프로젝트로 urlFor 가 겹쳐 들어와도 한 번만 띄운다 */
  private readonly starting = new Map<string, Promise<SpawnedServer>>()

  constructor(private readonly options: ServerPoolOptions = {}) {}

  /**
   * 이 프로젝트의 서버 주소. 없으면 띄우고 주소를 읽어 올 때까지 기다린다.
   *
   * 실패는 삼키지 않는다 — 던지면 `ProjectSession` 이 못 뜨고 그 사유가 화면에 그대로 뜬다.
   * 조용히 기본 주소로 물러나면 **남의 서버에 붙은 채로 굳는다.**
   */
  async urlFor(projectId: string, root: string): Promise<string> {
    const running = this.servers.get(projectId)
    if (running !== undefined) return running.url

    const pending = this.starting.get(projectId)
    if (pending !== undefined) return (await pending).url

    const started = this.launch(projectId, root)
    this.starting.set(projectId, started)
    try {
      return (await started).url
    } finally {
      // 자기 자신일 때만 지운다 — 그 사이 닫혔다 다시 열렸다면 지금 것은 새 start 다
      if (this.starting.get(projectId) === started) this.starting.delete(projectId)
    }
  }

  private async launch(projectId: string, root: string): Promise<SpawnedServer> {
    const start = this.options.start ?? ((path: string) => defaultStart(path, this.options.log))
    const server = await start(root)
    // 기다리는 동안 stop() 이 다녀갔을 수 있다 (탭을 바로 닫은 경우). 그러면 좀비를 남기지 않고
    // 즉시 거둔다 — 표에 넣으면 아무도 안 끄는 프로세스가 된다.
    if (this.starting.get(projectId) === undefined) {
      void server.stop()
      throw new Error('프로젝트가 닫혀 opencode 서버를 거뒀습니다')
    }
    this.servers.set(projectId, server)
    // 표에 넣는 것과 **같은 자리에서** 흔적을 남긴다. 둘이 갈리면 그 틈이 곧 유령이다.
    if (server.pid !== undefined) {
      this.options.pids?.add({
        pid: server.pid,
        url: server.url,
        root,
        bin: server.bin,
        startedAt: Date.now(),
      })
    }
    this.options.log?.(`opencode 서버 기동: ${root} → ${server.url} (pid=${server.pid ?? '?'})`)
    return server
  }

  /**
   * 접었다 다시 띄운다. 「이 프로젝트 서버 다시 시작」의 실체다.
   *
   * **주소가 바뀐다** — 포트를 우리가 고르지 않기 때문이다. 그래서 부르는 쪽은 세션도
   * 다시 만들어야 하고, **MCP 등록도 다시 해야 한다**(등록은 instance 수명이라 새 서버에는
   * 없다). 그 순서는 `SessionBridge.controlServer` 가 쥔다.
   */
  async restart(projectId: string, root: string): Promise<string> {
    await this.stop(projectId)
    return this.urlFor(projectId, root)
  }

  /**
   * 이미 떠 있는 서버 주소만. **띄우지 않는다.**
   *
   * 진단·프로브·MCP 등록처럼 "지금 붙어 있는 곳" 을 묻는 자리가 쓴다. 그 자리들이 서버를
   * 띄우게 하면 안 된다 — 탭을 연 적도 없는 프로젝트의 프로세스가 진단 버튼으로 생긴다.
   */
  urlOf(projectId: string | null | undefined): string | null {
    if (projectId === null || projectId === undefined) return null
    return this.servers.get(projectId)?.url ?? null
  }

  /**
   * 화면에 그대로 내려보낼 지금 상태. 역시 **띄우지 않는다.**
   *
   * `running` 이 거짓이라는 것은 **"우리 표에 없다"** 는 뜻이다. 그 자리에 남의 서버가
   * 떠 있을 수는 있지만 그건 우리가 죽일 수 있는 것이 아니다 — 화면은 그 차이를 말해야 한다
   * (「다시 시작」이 아니라 「서버 시작」).
   *
   * `ours` 는 **표를 믿지 않고 한 겹 더 본다** — 그 PID 가 지금도 우리가 띄운
   * `opencode serve` 로 살아 있나 (`pidStore.owns`). 표에 있어도 프로세스가 죽었거나 그
   * 번호를 남이 물려받았으면 거짓이다. Doctor 사다리 ②가 이 값으로 갈리고(설계 2026-08-16 §1),
   * **모르면 거짓이라 갈아타기로 간다** — 남의 프로세스를 끄는 쪽으로는 틀리지 않는다.
   */
  statusOf(projectId: string | null | undefined): ServerStatusPayload {
    const server = projectId === null || projectId === undefined ? undefined : this.servers.get(projectId)
    if (server === undefined) return { running: false, url: null, pid: null, ours: false }
    const pid = server.pid ?? null
    return { running: true, url: server.url, pid, ours: this.options.pids?.owns(pid) ?? false }
  }

  /**
   * 그 프로젝트의 서버를 거둔다. 안 띄운 프로젝트면 아무 일도 안 한다.
   *
   * **기동 중이면 끝을 보고 거둔다.** 표에서 지우기만 하고 돌아가면 잠시 뒤 뜬 서버를
   * 아무도 안 끄는 상태가 된다 — 앱을 끄는 길에서는 그게 곧 좀비다.
   */
  async stop(projectId: string): Promise<void> {
    const pending = this.starting.get(projectId)
    this.starting.delete(projectId)
    const server = this.servers.get(projectId)
    this.servers.delete(projectId)

    if (server !== undefined) {
      this.options.log?.(`opencode 서버 종료: ${server.url} (pid=${server.pid ?? '?'})`)
      await server.stop()
      // 곱게 거뒀으니 흔적을 지운다. 남기면 다음 실행이 남의 PID 를 들여다본다.
      if (server.pid !== undefined) this.options.pids?.forget(server.pid)
      return
    }
    // 아직 주소도 못 읽은 것. launch() 도 표가 빈 것을 보고 스스로 거두지만,
    // 여기서 한 번 더 기다려야 **끝난 뒤에** 돌아간다 (거절은 이미 거둔 것이다).
    if (pending !== undefined) await pending.then((started) => started.stop(), () => {})
  }

  /** 앱을 끌 때. **우리가 띄운 것만** 사라진다. */
  async stopAll(): Promise<void> {
    const ids = [...this.servers.keys(), ...this.starting.keys()]
    await Promise.all(ids.map((id) => this.stop(id)))
  }
}
