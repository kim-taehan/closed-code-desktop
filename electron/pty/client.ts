import { opencodeAuthHeaders } from '../opencode/client'

// opencode 의 pty API HTTP 클라이언트.
//
// **셸은 우리가 띄우지 않는다.** davis 공여(develop-desktop)는 `node-pty` 로 직접 spawn 했지만
// opencode 서버가 pty 를 이미 굴린다. 그래서 네이티브 모듈(`node-pty`·`electron-rebuild`·
// arm64/x64 재빌드)이 통째로 없다 — 이 계층은 순수 HTTP 다.
//
// `electron/opencode/` 와 **형제 계층**이지 그 아래가 아니다. 셸 드로어는 세션·턴·승인·
// 이벤트 어느 것과도 무관하고 대화에 남지도 않아, davis 봉투(`kind`/`action`)를 씌울 일이 없다.
//
// ⚠️ 실측(1.17.18)으로 알아낸 것 셋:
//
// 1. **`location[directory]` 를 안 실으면 서버의 `process.cwd()` 로 떨어진다.**
//    확인: 질의 없이 `GET /api/pty` 를 하면 `location.directory` 가 **서버를 띄운 폴더**로 온다.
//    그러면 A 프로젝트의 드로어가 엉뚱한 곳의 pty 를 보게 된다.
// 2. **`args` 를 보내면 안 된다.** 서버가 로그인 셸 인자(`-l`)를 스스로 붙인다 —
//    `args:["-l"]` 을 주면 `["-l","-l"]` 이 된다. 안 주면 `["-l"]` 이다.
// 3. **크기 변경은 WS 가 아니라 `PUT /api/pty/{id}`** 의 `{size:{rows,cols}}` 다.

/**
 * 서버가 받아 주는 크기인가. `PUT` 스키마가 `exclusiveMinimum: 0` 이라 **0 이면 400** 이다
 * (실측 — 생 `PUT {size:{rows:0,cols:80}}` 로 확인).
 *
 * **지금의 유일한 생산자(addon-fit)로는 여기 안 걸린다.** 설치본 소스를 펴 보면
 * `proposeDimensions` 가 셀 크기가 0 이면 `undefined` 를 주고, 아니면
 * `{cols: Math.max(2, …), rows: Math.max(1, …)}` 로 **스스로 클램프한다.**
 * 접혀서 `display:none` 이 되면 폭·높이가 **함께** NaN 이 되므로 `rows` 만 0/NaN 인
 * 경우도 없고, 그건 `DrawerTerminal` 의 `Number.isNaN(cols) || cols < MIN_COLS` 가 잡는다.
 *
 * 그래도 여기 두는 이유: **서버에 실제로 나가는 자리가 여기 하나**이고, `drawerBridge` 는
 * resize 실패를 `.catch(() => {})` 로 삼킨다(크기 조절 때문에 드로어를 죽이지 않으려고).
 * 즉 addon-fit 말고 다른 호출자가 생기는 순간 **400 이 조용히 사라진다.** 그 자리를 막는다.
 */
export function isSendableSize(size: { rows: number; cols: number }): boolean {
  return Number.isInteger(size.rows) && Number.isInteger(size.cols) && size.rows > 0 && size.cols > 0
}

/** `GET /api/pty` 등이 돌려주는 pty 하나 (opencode 스키마 `Pty`) */
export interface PtySession {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: 'running' | 'exited'
  pid: number
  /** 끝난 뒤에만 있다. 종료는 WS close 로 오고 코드는 여기서 읽는다 (실측). */
  exitCode?: number
}

export interface PtyClientOptions {
  baseUrl: string
  /** OPENCODE_SERVER_PASSWORD 를 켰을 때만. HTTP 와 WS 가 같은 헤더를 쓴다. */
  password?: string
  fetchImpl?: typeof fetch
}

export class PtyClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: PtyClientOptions) {
    // 끝의 / 를 떼어 둔다 — 붙어 있으면 `//api/...` 가 되어 404 가 난다 (opencode/client.ts 와 같은 이유)
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...opencodeAuthHeaders(this.options.password) }
  }

  /**
   * 프로젝트 신원을 질의로 접는 **유일한 자리.**
   *
   * OpenAPI 는 `location` 을 deepObject 로 적어 두는데, 실제로 서버가 읽는 이름은
   * `location[directory]` 다. 대괄호를 인코딩해야 하므로 URLSearchParams 로 만든다
   * (`%5B`/`%5D`). 손으로 이어 붙이면 `location[directory]` 가 그대로 나가 서버가 못 읽는다.
   *
   * URLSearchParams 는 공백을 `%20` 이 아니라 `+` 로 쓴다. **틀린 것이 아니다** —
   * 실측: `/…/live space` 를 `+` 로도 `%20` 으로도 보내 봤고 서버가 둘 다 같은 경로로
   * 읽었다. 폴더 이름에 공백이 있으면 눈에 띄는 자리라 근거를 남긴다.
   */
  private query(directory: string, extra: Record<string, string> = {}): string {
    return new URLSearchParams({ 'location[directory]': directory, ...extra }).toString()
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      throw new Error(`opencode ${method} ${path} 실패: HTTP ${response.status} ${await response.text()}`)
    }
    const text = await response.text()
    if (!text) return {} as T
    // `/api/*` 응답은 `{location, data}` 로 감싸여 온다. 한 겹 벗긴다.
    const parsed = JSON.parse(text) as { data?: T }
    return (parsed.data ?? parsed) as T
  }

  /**
   * 셸을 하나 띄운다. **`args` 를 넘기지 않는다** (머리말 2번).
   *
   * `command` 를 비우면 서버가 사용자 기본 셸을 고른다 — `GET /pty/shells` 가 따로 있지만
   * 고르는 일을 우리가 할 이유가 없다. 공여의 `shell.ts`(실행파일 탐색 32줄)가 통째로 없어지는 자리다.
   */
  async create(directory: string, input: { title?: string; env?: Record<string, string> } = {}): Promise<PtySession> {
    return this.call<PtySession>('POST', `/api/pty?${this.query(directory)}`, {
      cwd: directory,
      ...(input.title !== undefined ? { title: input.title } : {}),
      // 포장한 앱은 $LANG 이 없어 C 로케일로 도는 일이 있었다 (공여 실측). 서버 쪽 환경이라
      // 우리 문제는 아니지만, 필요하면 여기로 실어 보낸다.
      ...(input.env !== undefined ? { env: input.env } : {}),
    })
  }

  /** 그 디렉토리의 pty 만 온다 — 다른 프로젝트 것은 목록에 없다 (실측). */
  async list(directory: string): Promise<PtySession[]> {
    return this.call<PtySession[]>('GET', `/api/pty?${this.query(directory)}`)
  }

  /**
   * 하나만 읽는다. 없으면 `null` — 끝난 셸의 `exitCode` 를 가져오는 자리다.
   *
   * **틀린 디렉토리로 물으면 404 다** (실측). 즉 opencode 도 격리를 걸어 준다.
   */
  async get(directory: string, ptyId: string): Promise<PtySession | null> {
    try {
      return await this.call<PtySession>('GET', `/api/pty/${ptyId}?${this.query(directory)}`)
    } catch {
      return null
    }
  }

  /**
   * 크기 변경. WS 로 보내는 길은 없다 (머리말 3번).
   *
   * ⚠️ **못 보낼 크기는 아예 안 보낸다** — 판단과 그 근거는 전부 `isSendableSize` 에 있다.
   * 여기서 다시 적지 않는다: 같은 사실을 두 벌로 적었다가 한쪽만 갱신돼 **한 파일 안의 두
   * 주석이 정반대를 말하는** 상태를 실제로 만들었다 (contract-qa 가 잡았다).
   *
   * 던지지 않고 조용히 돌아간다 — 보낼 것이 없을 뿐 실패가 아니다. 여기서 던지면
   * 드로어를 접을 때마다 오류가 뜬다.
   */
  async resize(directory: string, ptyId: string, size: { rows: number; cols: number }): Promise<void> {
    if (!isSendableSize(size)) return
    await this.call('PUT', `/api/pty/${ptyId}?${this.query(directory)}`, { size })
  }

  async remove(directory: string, ptyId: string): Promise<void> {
    await this.call('DELETE', `/api/pty/${ptyId}?${this.query(directory)}`)
  }

  /**
   * WebSocket 주소.
   *
   * `cursor=0` 은 **처음부터 다시 보내 달라**는 뜻이다. 서버가 스크롤백을 들고 재생해 주므로
   * (실측: 끊었다 다시 붙으면 앞서 친 명령과 출력이 그대로 온다) 드로어를 접었다 펴도,
   * 앱을 껐다 켜도 내용이 남는다. 공여(앱이 죽으면 사라짐)보다 나은 자리다.
   */
  socketUrl(directory: string, ptyId: string, cursor = 0): string {
    const ws = this.baseUrl.replace(/^http/, 'ws')
    return `${ws}/api/pty/${ptyId}/connect?${this.query(directory, { cursor: String(cursor) })}`
  }
}
