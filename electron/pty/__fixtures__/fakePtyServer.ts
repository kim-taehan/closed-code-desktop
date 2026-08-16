// pty 시험용 가짜 서버 — `multiplex.test.ts` 와 `runPane.test.ts` 가 함께 쓴다.
//
// **두 벌이던 것을 합쳤다.** `runPane.test.ts` 가 스스로 *"가짜를 고칠 때는 둘 다 고쳐야
// 한다"* 고 적어 뒀는데, 그건 기억에 기대는 규칙이라 지켜지지 않는다. 한쪽만 고치면
// **두 시험이 서로 다른 서버를 상대로 초록을 낸다** — 어느 쪽이 실물인지 아무도 모른다.
//
// 실물 계약 셋이 이 가짜의 뼈대다 (`ptyPool.ts` 머리말의 실측):
// 1. **열리기 전에는 못 쓴다.** `write` 가 open 전에 false 를 돌려준다 — 여기서 그냥 받아
//    주면 「맡아 뒀다 열릴 때 넣는다」 규칙이 없어도 초록이 난다.
// 2. **제목이 그대로 왕복한다.** 되찾기가 제목 완전 일치로 도는 근거다.
// 3. **`DELETE` 는 그 하나만 거둔다.** `remove` 가 `alive` 에서 그 하나만 지운다.
//
// ⚠️ 합치면서 **어느 쪽도 느슨해지지 않았다.** 갈래가 갈리던 자리는 `exits` 하나로 옮겼고
// (`get` 이 종료 코드를 주는 pty — 시험이 채운다), 나머지 차이는 **한쪽이 안 재던 것**이라
// 양쪽에 켜도 판정이 안 바뀐다. `created`·`closed`·`removed` 기록과 `remove` 의 `alive`
// 삭제가 그것이고, 셋 다 실물 쪽이 그렇게 하므로 켜는 편이 오히려 실물에 가깝다.

export interface FakeSocket {
  readonly sent: string[]
  fireOpen(): void
  fireData(chunk: string): void
  fireClose(): void
}

export interface FakePty {
  id: string
  title: string
  status: string
}

/** 소켓 url → 그 소켓. 칸 하나에 소켓 하나다 */
export const sockets = new Map<string, FakeSocket>()
/** `close()` 가 불린 소켓 url */
export const closed: string[] = []
/** 서버에 살아 있는 pty (제목 → 하나). 되찾기 경로가 여기서 나온다 */
export const alive = new Map<string, FakePty>()
/** `create` 된 제목. **겹쳐 띄우면 여기 둘이 쌓인다** */
export const created: string[] = []
/** `DELETE` 로 실제 거둬진 ptyId */
export const removed: string[] = []
/** `get` 이 종료 코드를 줄 pty (ptyId → exitCode). 안 넣으면 `null` — 아직 돌고 있다는 뜻이다 */
export const exits = new Map<string, number>()

/** 시험 하나가 끝나면 전부 비운다. **`beforeEach` 에서 부른다** — 안 부르면 앞 시험이 샌다 */
export function resetFakePtyServer(): void {
  sockets.clear()
  closed.length = 0
  alive.clear()
  created.length = 0
  removed.length = 0
  exits.clear()
}

/** `vi.mock('./socket')` 에 끼울 클래스 */
export class FakePtySocket implements FakeSocket {
  opened = false
  readonly sent: string[] = []
  private openHandler: () => void = () => {}
  private dataHandler: (chunk: string) => void = () => {}
  private closeHandler: () => void = () => {}

  constructor(private readonly options: { url: string }) {
    sockets.set(options.url, this)
  }
  onControl(): void {}
  onError(): void {}
  onOpen(handler: () => void): void {
    this.openHandler = handler
  }
  onData(handler: (chunk: string) => void): void {
    this.dataHandler = handler
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler
  }
  open(): void {}
  fireOpen(): void {
    this.opened = true
    this.openHandler()
  }
  fireData(chunk: string): void {
    this.dataHandler(chunk)
  }
  fireClose(): void {
    this.closeHandler()
  }
  /** 계약 1 — 열리기 전에는 못 쓴다 */
  write(data: string): boolean {
    if (!this.opened) return false
    this.sent.push(data)
    return true
  }
  close(): void {
    closed.push(this.options.url)
  }
}

/** `vi.mock('./client')` 에 끼울 클래스 (`...actual` 위에 얹는다) */
export class FakePtyClient {
  readonly headers = {}
  list(): Promise<unknown[]> {
    return Promise.resolve([...alive.values()])
  }
  /** 계약 2 — 제목이 곧 이름이고, 그대로 왕복한다 */
  create(_directory: string, input: { title: string }): Promise<FakePty> {
    created.push(input.title)
    const pty = { id: `pty_${input.title}`, title: input.title, status: 'running' }
    alive.set(input.title, pty)
    return Promise.resolve(pty)
  }
  socketUrl(_directory: string, ptyId: string): string {
    return `ws://fake/${ptyId}`
  }
  get(_directory: string, ptyId: string): Promise<{ exitCode: number } | null> {
    const exitCode = exits.get(ptyId)
    return Promise.resolve(exitCode === undefined ? null : { exitCode })
  }
  resize(): Promise<void> {
    return Promise.resolve()
  }
  /** 계약 3 — 그 하나만 거둔다. 옆 pty 는 `running` 으로 남는다 */
  remove(_directory: string, ptyId: string): Promise<void> {
    removed.push(ptyId)
    for (const [title, pty] of alive) if (pty.id === ptyId) alive.delete(title)
    return Promise.resolve()
  }
}
