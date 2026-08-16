import WebSocket from 'ws'

// pty 하나에 붙는 WebSocket. **원시 바이트를 그대로 나른다.**
//
// ⚠️ 실측(1.17.18)으로 알아낸 것 셋. 문서를 믿고 짜면 전부 밟는다.
//
// 1. **JSON 봉투가 아니다.** 처음에 `{type:'input',data:…}` 로 보냈더니 그 JSON 문자열이
//    셸에 **그대로 타이핑됐다.** 보낼 것은 사용자가 누른 키 바이트뿐이다.
// 2. **제어 프레임은 바이너리이고 첫 바이트가 0x00 이다** (`\x00{"cursor":0}`).
//    터미널 바이트는 전부 텍스트 프레임으로 온다. 이 둘을 안 가르면 화면 맨 앞에
//    `{"cursor":0}` 이 찍힌다.
// 3. **프로세스 종료는 제어 프레임이 아니라 WS close(1000)** 다. `exit 7` 을 치면
//    close code 는 그냥 1000 이고 종료 코드는 `GET /api/pty/{id}` 의 `exitCode` 에 있다.
//
// **자동 재연결을 하지 않는다.** close 의 가장 흔한 원인이 "셸이 끝났다" 이고, 그때 다시
// 붙어 봐야 404 이거나 이미 죽은 pty 에 붙는다. 다시 열지 말지는 수명을 쥔
// `drawerBridge.ts` 가 pty 상태를 확인하고 정한다 — 여기서 혼자 되붙으면 종료가 화면에
// 안 보이는 채로 조용히 재시도만 돈다.

export interface PtySocketOptions {
  url: string
  /** HTTP 와 **같은 헤더**를 실어야 한다 (`opencodeAuthHeaders`). 없으면 401 로 끊긴다. */
  headers?: Record<string, string>
  /** 테스트가 가짜 소켓을 끼우는 자리 */
  create?: (url: string, headers: Record<string, string>) => PtyLikeSocket
}

/** `ws` 중 우리가 쓰는 만큼만. 가짜를 만들기 쉬우라고 좁혀 뒀다 (ISP). */
export interface PtyLikeSocket {
  on(event: 'open', handler: () => void): void
  on(event: 'message', handler: (data: unknown, isBinary: boolean) => void): void
  on(event: 'close', handler: (code: number, reason: Buffer) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  send(data: string): void
  /**
   * 정상 종료만 있다. `ws` 의 `terminate()`(강제 끊기)는 **여기 없다** —
   * 부르는 자리가 없어서다. 드로어를 접는 것은 `close()` 로 충분하고, 서버가 응답을
   * 안 하는 경우를 다루는 경로도 아직 없다. 필요해지면 그때 넣는다.
   */
  close(): void
}

export interface PtyCloseInfo {
  code: number
  reason: string
}

export class PtySocket {
  private socket: PtyLikeSocket | null = null
  private closedByUs = false
  /** 핸드셰이크가 끝났는가. `write` 가 이걸 안 보면 던진다 (실측 — `open` 절 참조) */
  private opened = false

  private dataHandler: (chunk: string) => void = () => {}
  private controlHandler: (payload: unknown) => void = () => {}
  private openHandler: () => void = () => {}
  private closeHandler: (info: PtyCloseInfo) => void = () => {}
  private errorHandler: (error: Error) => void = () => {}

  constructor(private readonly options: PtySocketOptions) {}

  onData(handler: (chunk: string) => void): void {
    this.dataHandler = handler
  }
  /**
   * 이제 써도 된다는 신호. **사람이 아니라 프로그램이 채워 넣을 때 필요하다** —
   * 사람의 키는 늦게 오지만(`write` 가 버려도 손해가 없다), 에이전트가 채우는 명령은
   * 소켓이 열리기 **전에** 도착한다 (`drawerBridge.fill`).
   */
  onOpen(handler: () => void): void {
    this.openHandler = handler
  }
  /** 0x00 을 앞세운 제어 프레임. 지금 오는 것은 `{cursor}` 하나다. */
  onControl(handler: (payload: unknown) => void): void {
    this.controlHandler = handler
  }
  onClose(handler: (info: PtyCloseInfo) => void): void {
    this.closeHandler = handler
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler
  }

  /**
   * 붙는다. **돌아왔다고 쓸 수 있는 것이 아니다** — 그때 소켓은 아직 CONNECTING 이다.
   *
   * 실측(1.18.18, 실서버 pty): 만들자마자 `send` 하면 `ws` 가 그 자리에서 던진다 —
   * `WebSocket is not open: readyState 0 (CONNECTING)`. 이 예외는 IPC 리스너
   * (`ipcMain.on(PTY_INPUT)`) 안에서 나므로 아무에게도 안 보이고, 보낸 글자만 사라진다.
   * 그래서 열림을 여기서 기록하고 `write` 가 확인한다.
   */
  open(): void {
    if (this.socket !== null) return
    this.closedByUs = false
    const headers = this.options.headers ?? {}
    const socket = this.options.create
      ? this.options.create(this.options.url, headers)
      : (new WebSocket(this.options.url, { headers }) as unknown as PtyLikeSocket)
    this.socket = socket

    socket.on('open', () => {
      this.opened = true
      this.openHandler()
    })
    socket.on('message', (data, isBinary) => this.onMessage(data, isBinary))
    socket.on('error', (error) => this.errorHandler(error))
    socket.on('close', (code, reason) => {
      this.socket = null
      this.opened = false
      // 우리가 접은 것(드로어 닫기)은 화면에 "셸이 끝났다" 로 보이면 안 된다
      if (this.closedByUs) return
      this.closeHandler({ code, reason: String(reason ?? '') })
    })
  }

  /**
   * 사용자가 누른 키를 그대로 보낸다. 아직 안 열렸으면 버린다 — 큐를 만들면 순서가 꼬인다.
   *
   * **"안 열렸다" 는 소켓이 없는 것만이 아니다.** 붙는 중(CONNECTING)에도 못 쓴다 —
   * 그냥 넘기면 `ws` 가 던진다 (`open` 절의 실측). 못 썼다는 것은 `false` 로만 말하고
   * 여기서 던지지 않는다: 부르는 자리가 키 입력이라 예외로 올릴 것이 없다.
   */
  write(data: string): boolean {
    if (this.socket === null || !this.opened) return false
    this.socket.send(data)
    return true
  }

  /** 드로어를 접을 때. **pty 는 죽이지 않는다** — 다시 펴면 스크롤백째 돌아와야 한다. */
  close(): void {
    const socket = this.socket
    this.socket = null
    this.opened = false
    if (socket === null) return
    this.closedByUs = true
    socket.close()
  }

  private onMessage(data: unknown, isBinary: boolean): void {
    // 바이너리 = 제어 프레임. 첫 바이트 0x00 을 떼고 나머지를 JSON 으로 읽는다.
    if (isBinary) {
      const bytes = toBuffer(data)
      if (bytes === null || bytes[0] !== 0x00) return
      try {
        this.controlHandler(JSON.parse(bytes.subarray(1).toString('utf8')))
      } catch {
        // 모르는 제어 프레임은 버린다. 터미널 바이트로 흘리면 화면에 쓰레기가 찍힌다.
      }
      return
    }
    this.dataHandler(toText(data))
  }
}

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[])
  return null
}

/** `ws` 는 텍스트도 Buffer 로 줄 수 있다 (`binaryType` 기본값). 둘 다 받는다. */
function toText(data: unknown): string {
  const buffer = toBuffer(data)
  return buffer === null ? String(data) : buffer.toString('utf8')
}
