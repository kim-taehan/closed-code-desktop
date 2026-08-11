import { randomUUID } from 'node:crypto'

// main ↔ 확장 호스트(utilityProcess) 사이의 메시지 봉투와 타입 가드.
//
// shared/protocol/envelope.ts 의 관례를 따른다 — 봉투 + "던지지 않고 null" 파서.
// 다만 이 메시지는 **runtime 으로 가지 않는다**. envelope.ts:21-35 의 snake_case 금지
// 규칙은 여기에 적용되지 않으며, 키는 camelCase 로 통일한다.
//
// 부모(host.ts)와 자식(hostEntry.ts)이 함께 import 한다 →
// **electron 을 import 하지 않는다** (자식에는 electron 모듈이 없다).

/** 자식 → 부모. 엔트리가 떴다는 첫 신호 — 부모가 기동 완료를 아는 유일한 창구다. */
export const NOTICE_READY = 'host.ready'

/**
 * 부모 → 자식. 유예 종료 요청.
 *
 * utilityProcess.kill() 에는 시그널 인자가 없어(electron.d.ts:14174)
 * RuntimeProcess 의 SIGTERM→SIGKILL 2단 종료를 API 로 흉내낼 수 없다. 그래서 자작한다.
 */
export const NOTICE_SHUTDOWN = 'host.shutdown'

/** 부모 → 자식. 왕복이 살아 있는지 확인한다. 결과는 `{ pid }`. */
export const METHOD_PING = 'host.ping'

/**
 * 부모 → 자식. 실을 확장 목록을 넘긴다. 결과는 `{ loaded, failed }`.
 *
 * 훑기(registry)는 부모가 한다 — 자식이 따로 훑으면 목록이 둘이 되어
 * 화면에 뜨는 것과 실제로 실린 것이 어긋난다.
 */
export const METHOD_LOAD_EXTENSIONS = 'host.loadExtensions'

/** 부모 → 자식. `contributes.commands` 의 명령 하나를 실행한다. */
export const METHOD_RUN_COMMAND = 'host.runCommand'

/**
 * 부모 → 자식. **저장된 것을 지금 프로젝트 기준으로 다시 그리라**고 시킨다.
 *
 * 확장의 `activate` 는 앱이 뜰 때 한 번만 돈다. 그때 그린 것은 **그 순간의 활성 프로젝트**
 * 것이고, 사용자가 프로젝트 탭을 옮기면 화면은 비워지는데 다시 채울 사람이 없다
 * (`useExtensionTree.ts` 가 프로젝트가 바뀌면 비운다). 게다가 활성화 시점의 그리기는
 * **화면이 붙기 전에** 끝날 수 있어 그 한 번마저 놓친다 — 밀어 넣기는 재생되지 않는다.
 *
 * 그래서 **화면이 붙은 뒤에 화면이 요청한다** (`requestHistoryList` 와 같은 방식).
 * 확장은 `activate` 가 돌려주는 `redraw` 로 이 요청을 받는다.
 */
export const METHOD_REDRAW = 'host.redraw'

/**
 * 부모 → 자식. **편집기에서 보고 있는 파일이 바뀌었다.**
 *
 * `METHOD_REDRAW` 를 재활용하지 않는다. 「다시 그려라」와 「보는 것이 바뀌었다」는 다른
 * 사실이고, 섞으면 확장이 **왜 불렸는지 모른 채** 매번 전부 다시 그린다 — 파일을 옮길
 * 때마다 무거운 재조회가 도는 확장이 나온다.
 *
 * **선례 셋이 다 가진 것이다** (VS Code `onDidChangeActiveTextEditor` · Eclipse
 * `ISelectionListener` · IntelliJ `FileEditorManagerListener`). 표준 §1 의 비교표에
 * 이 칸이 없는데, 빠뜨린 것이지 일부러 뺀 것이 아니다.
 *
 * `activationEvents`(교훈 1 이 없앤 것)와 다르다 — 저건 **언제 로드할까**이고 이건
 * **로드된 뒤 상태 알림**이다. 확장은 여전히 자기 명령이 불릴 때 깨어난다.
 */
export const METHOD_ACTIVE_FILE = 'host.activeFile'

/**
 * 부모 → 자식. **어시스턴트가 지금 무엇을 하고 있나** (`{ extension, kind, text }`).
 *
 * `davis.agent.ask` 는 최종 답만 돌려준다. 그런데 질의 하나가 수십 초~수 분이라 그동안
 * 확장이 화면에 말할 것이 없어 **멈춘 것처럼 보인다** (실측 불만: *"채팅 진행중인 내용도
 * 보여주면 안될까 멈춘것 같아"*). 레인에는 `thinking`·`tool_call` 청크가 이미 들어오는데
 * 텍스트만 남기고 버리고 있었다 (`agentLane/askAgent.ts`).
 *
 * **응답이 아니라 통지다.** 답을 기다리는 그 호출과 짝지으면 왕복 하나에 응답이 여럿이
 * 되어 `PendingRequests` 의 계약이 깨진다. 대신 **확장 이름**으로 배달한다.
 *
 * ponytail: 한 확장이 `ask` 를 **동시에 둘** 걸면 두 질의의 활동이 한 곳으로 섞인다.
 * 지금 확장들은 전부 `await` 로 하나씩 물으므로 그 경우가 없다. 생기면 호출 id 를 실어
 * 가른다 (`RpcRequest.id` 가 이미 있다).
 */
export const NOTICE_AGENT_ACTIVITY = 'host.agentActivity'

/** 응답을 기다리는 호출. 양방향으로 흐른다 (부모→자식: 명령 / 자식→부모: 확장 API). */
export interface RpcRequest {
  kind: 'request'
  id: string
  method: string
  params?: unknown
}

/** 요청의 짝. `id` 로만 맞춘다. */
export type RpcResponse =
  | { kind: 'response'; id: string; ok: true; result?: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }

/** 응답이 없는 단방향 통지. 수명 신호(ready·shutdown)가 여기 든다. */
export interface RpcNotice {
  kind: 'notice'
  method: string
  params?: unknown
}

export type RpcMessage = RpcRequest | RpcResponse | RpcNotice

export function createRequest(method: string, params?: unknown): RpcRequest {
  return { kind: 'request', id: randomUUID(), method, ...(params !== undefined ? { params } : {}) }
}

export function createNotice(method: string, params?: unknown): RpcNotice {
  return { kind: 'notice', method, ...(params !== undefined ? { params } : {}) }
}

export function okResponse(id: string, result?: unknown): RpcResponse {
  return { kind: 'response', id, ok: true, ...(result !== undefined ? { result } : {}) }
}

export function errorResponse(id: string, error: string): RpcResponse {
  return { kind: 'response', id, ok: false, error }
}

/** 형태가 아니면 null 을 돌려주고 던지지 않는다 (envelope.ts:116-130 과 같은 관례). */
export function parseRpcMessage(value: unknown): RpcMessage | null {
  const source = asRecord(value)

  if (source['kind'] === 'request') {
    const id = source['id']
    const method = source['method']
    if (typeof id !== 'string' || typeof method !== 'string') return null
    return { kind: 'request', id, method, ...(source['params'] !== undefined ? { params: source['params'] } : {}) }
  }

  if (source['kind'] === 'response') {
    const id = source['id']
    if (typeof id !== 'string') return null
    if (source['ok'] === true) {
      return { kind: 'response', id, ok: true, ...(source['result'] !== undefined ? { result: source['result'] } : {}) }
    }
    // ok 가 true 가 아니면 전부 실패로 본다. 망가진 응답을 통과시키면 부모의 await 가
    // 성공으로 풀려 더 나쁘다 — 시끄러운 실패가 낫다.
    const error = source['error']
    return { kind: 'response', id, ok: false, error: typeof error === 'string' ? error : '알 수 없는 오류' }
  }

  if (source['kind'] === 'notice') {
    const method = source['method']
    if (typeof method !== 'string') return null
    return { kind: 'notice', method, ...(source['params'] !== undefined ? { params: source['params'] } : {}) }
  }

  return null
}

/**
 * 자식이 부모에게서 받은 메시지를 푼다.
 *
 * **부모/자식의 수신 모양이 다르다** (spike 실측, `_workspace/42` §영향 2):
 * 부모는 `child.on('message', msg)` 로 **평평하게** 받고,
 * 자식은 `port.on('message', event)` 로 **`event.data`** 에 싸서 받는다.
 * 이 비대칭을 아는 곳은 이 파일 하나여야 한다 — 밖으로 새면 양쪽에서 계속 틀린다.
 */
export function parseFromParent(messageEvent: { data: unknown }): RpcMessage | null {
  return parseRpcMessage(messageEvent.data)
}

/** 부모가 자식에게서 받은 메시지를 푼다. 껍질이 없다 (위 비대칭). */
export function parseFromChild(message: unknown): RpcMessage | null {
  return parseRpcMessage(message)
}

/**
 * 보낸 요청을 id 로 붙잡아 두고 응답이 오면 푼다.
 *
 * 상대가 죽으면 남은 요청을 전부 거부해야 한다 — 안 그러면 await 가 영원히 걸린다.
 */
export class PendingRequests {
  private readonly waiting = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  track(id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
    })
  }

  /** 응답을 짝지어 푼다. 짝이 없으면 false — 늦게 온 응답은 부르는 쪽이 판단한다. */
  settle(response: RpcResponse): boolean {
    const entry = this.waiting.get(response.id)
    if (!entry) return false
    this.waiting.delete(response.id)
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(response.error))
    return true
  }

  /** 남은 요청을 전부 거부한다. 호스트가 죽었거나 정리될 때 부른다. */
  rejectAll(reason: string): void {
    const entries = [...this.waiting.values()]
    this.waiting.clear()
    for (const entry of entries) entry.reject(new Error(reason))
  }
}

// 이 레포는 asRecord 를 공용으로 두지 않고 쓰는 파일마다 비공개로 둔다
// (mcpConfig.ts:92 · licenseCheck.ts:115 · skillList.ts:138). 그 관례를 따른다.
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
