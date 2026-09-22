import { OpencodeEventType, type OpencodeEvent } from './events'
import { httpFailure } from './httpError'
import { abortTurn, replyQuestionLegacy, sendPrompt, type PostJson } from './legacyChat'
import { normalizeLegacyEvent } from './legacyEvents'
import { SseStream } from './sse'
import { errorMessage } from './translate'
import type { AiRunRequest, ExtensionAiPort } from '../extensions/aiDispatch'
import type { ExtensionSessionStore } from './extensionSessions'

// **확장 전용 AI 세션** — `code.ai.run` 의 opencode 쪽 (확장 재설계 §2-3, 결정 F2·F4~F7).
//
// 사용자 채팅(`transport.ts`)과 **같은 서버·다른 세션**이다. 사용자 대화에 턴을 만들지 않고,
// 사용자 질문과 큐를 다투지 않는다 — 한 서버에 두 세션의 `prompt_async` 를 연달아 넣어도 둘 다
// 바로 204 이고 이벤트가 번갈아 온다 (4단계 사전 실측).
//
// ## 격리는 두 방향이다
//
// `/event` 는 한 인스턴스(= 디렉토리)의 세션 전부를 한 스트림에 싣는다. 확장 세션은 사용자 채팅과 **같은
// 디렉토리**에 서므로 확장 세션의 이벤트가 사용자 채팅 스트림에도, 사용자 세션의 이벤트가 여기에도 흘러든다.
// (「서버 전역」이라 적힌 자리가 여럿인데 정확히는 인스턴스 단위다 — 아래 `run` 의 `?directory=` 주석.)
//   - 사용자 채팅 쪽: `sessionFilter.ts` 의 `admits` 가 버린다 (확장 세션 id 는 그 창의 세션이 아니다).
//     **거기는 고치지 않았다** — `extensionIsolation.test.ts` 가 실측 이벤트로 잠근다.
//   - 이쪽: 아래 `onEvent` 첫 줄이 **제 세션 id 가 실린 것만** 받는다. `admits` 와 달리 sessionID 가
//     없는 것도 버린다(fail-closed) — 이쪽이 필요한 것(글·승인·질문·오류·idle)은 전부 sessionID 를
//     싣는다 (실측 1.18.18, 사용자 채팅 쪽이 fail-open 인 근거와 같은 캡처).
//
// ## 세대는 사용자 채팅과 같다 — 레거시
//
// 프롬프트·중단·이벤트 스트림·질문 거절은 `legacyChat.ts` 의 함수를 그대로 쓴다 (다섯이 한 세트,
// 그 머리말). 이벤트 이름은 `normalizeLegacyEvent` 로 되옮겨 읽는다 — 레거시 이름을 여기서 따로
// 읽으면 번역 규칙이 두 벌이 된다 (`legacyEvents.ts` 머리말의 「되옮기는 쪽을 고른 이유」).
// 두 자리만 레거시 세트 밖이다 — 세션 생성(`POST /session`, 권한 규칙을 실을 곳이 여기뿐이다)과
// 승인 거절(`POST /permission/:id/reply {reply}`, 2026-09-22 실측으로 풀리는 것을 확인했다).

/**
 * 확장 세션의 권한 규칙 (U-B 실측). **순서가 뜻이다 — 뒤 규칙이 이긴다.**
 *
 * 전부 막고(`*`) → 읽기 셋만 열고 → `.env` 읽기를 다시 막는다. `edit`·`bash` 만 막으면 에이전트
 * 기본값의 `ask`(`.env` 읽기 등)가 남아 승인 요청이 뜬다. 이 규칙으로는 승인 요청 0건, `bash`·
 * `write`·`question`·`task` 전부 막힘, task 하위 에이전트에도 물려진다 (실측). 내장 `plan` 에이전트는
 * bash 를 허용해 읽기 전용이 아니라 쓰지 않는다.
 */
export const EXTENSION_SESSION_PERMISSION = [
  { permission: '*', pattern: '*', action: 'deny' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'glob', pattern: '*', action: 'allow' },
  { permission: 'grep', pattern: '*', action: 'allow' },
  { permission: 'read', pattern: '*.env', action: 'deny' },
] as const

/** 확장이 `signal` 로 끊었을 때 `ai.run` 이 거부되는 사유 */
export const AI_RUN_CANCELLED = 'ai.run: 취소했습니다'

export interface ExtensionRunDeps {
  /** (확장 × 프로젝트) → 세션 id 장부. 이력에서 숨기는 것도 같은 장부다 (`extensionSessions.ts`) */
  sessions: Pick<ExtensionSessionStore, 'get' | 'set'>
  /** 그 프로젝트의 서버 주소와 루트. 서버가 없으면 띄운다 (`serverPool.urlFor`) — 모르는 프로젝트면 던진다 */
  server(projectId: string): Promise<{ url: string; directory: string }>
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export class ExtensionAiRuns implements ExtensionAiPort {
  /** 도는 (확장 × 프로젝트). **세션 하나에 하나만** 돈다 (F6) */
  private readonly busy = new Set<string>()
  /** runId → 끊는 손잡이. 확장 이름을 같이 쥐어 남의 실행을 못 끊게 한다 */
  private readonly live = new Map<string, { extension: string; cancel: () => void }>()

  constructor(private readonly deps: ExtensionRunDeps) {}

  async run(request: AiRunRequest, onText: (text: string) => void): Promise<{ text: string }> {
    const key = JSON.stringify([request.extension, request.projectId])
    // 같은 세션에 두 턴을 겹쳐 넣으면 글이 섞이고 idle 하나에 둘이 풀린다. 기다리게 하지 않고 거부한다 —
    // 줄을 세우면 확장이 모르는 사이 앞 요청의 결과를 뒤 요청이 기다린다
    if (this.busy.has(key)) {
      throw new Error(`ai.run: busy — ${request.extension} 확장이 이 프로젝트에서 묻던 것이 아직 끝나지 않았습니다`)
    }
    this.busy.add(key)
    const turn = new ExtensionTurn(this.deps, request, onText)
    this.live.set(request.runId, { extension: request.extension, cancel: () => turn.cancel() })
    try {
      return await turn.run()
    } finally {
      this.busy.delete(key)
      this.live.delete(request.runId)
    }
  }

  cancel(extension: string, runId: string): void {
    const entry = this.live.get(runId)
    if (entry !== undefined && entry.extension === extension) entry.cancel()
  }
}

/** `ai.run` 한 번의 수명. 세션 확보 → 스트림 열기 → 프롬프트 → idle 까지 */
class ExtensionTurn {
  private readonly fetchImpl: typeof fetch
  private post: PostJson | null = null
  private sessionId: string | null = null
  private prompted = false
  private cancelled = false
  /** 끊기면 거부되는 약속. 각 단계를 이것과 겨루게 해 어느 단계에서 끊겨도 곧바로 빠져나온다 */
  private readonly stopped: Promise<never>
  private stop: (error: Error) => void = () => {}

  constructor(
    private readonly deps: ExtensionRunDeps,
    private readonly request: AiRunRequest,
    private readonly onText: (text: string) => void,
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.stopped = new Promise<never>((_, reject) => {
      this.stop = reject
    })
    this.stopped.catch(() => {})
  }

  async run(): Promise<{ text: string }> {
    const { url, directory } = await this.step(this.deps.server(this.request.projectId))
    const post = poster(url, this.fetchImpl)
    this.post = post
    const sessionId = await this.step(this.session(url, directory, post))
    this.sessionId = sessionId
    // **`?directory=` 를 싣는다.** `/event` 는 서버 전역이 아니라 **인스턴스(디렉토리) 단위**다 — 빼면 서버
    // cwd 의 인스턴스만 온다 (2026-09-22 실측: 같은 턴을 `/event` 는 0건, `/event?directory=` 는 25건).
    // 우리 서버는 프로젝트 루트를 cwd 로 뜨므로(`serverPool.ts`) 지금은 둘이 같지만, 세션을 세운 곳을
    // 그대로 적는 편이 그 조건에 기대지 않는다
    const events = `${url}/event?directory=${encodeURIComponent(directory)}`
    const stream = new SseStream({ url: events, fetchImpl: this.fetchImpl, autoReconnect: false })
    try {
      const connected = new Promise<void>((resolve, reject) => {
        stream.onEvent((event) => {
          if (event.type === OpencodeEventType.SERVER_CONNECTED) resolve()
        })
        stream.onError(reject)
      })
      const finished = this.watch(stream, sessionId, post)
      finished.catch(() => {})
      stream.start()
      // **스트림이 붙은 뒤에 묻는다.** 먼저 물으면 짧은 답의 글·idle 이 구독 전에 지나간다
      await this.step(connected)
      if (this.cancelled) throw new Error(AI_RUN_CANCELLED)
      this.prompted = true
      await this.step(sendPrompt(post, sessionId, this.request.prompt))
      return await this.step(finished)
    } finally {
      stream.close()
    }
  }

  /**
   * 끊는다 (F7). 프롬프트를 이미 보냈으면 **사용자 채팅의 중단과 같은 길**(`abortTurn` — `chatRequest.ts`
   * 의 `interruptTurn` 이 부르는 것)로 턴을 끊고 나서 거부한다. 끊지 않고 거부만 하면 세션이 돌던 턴을
   * 계속 돌려 다음 `ai.run` 이 그 뒷부분을 받는다.
   *
   * idle 을 기다리지 않는다 — 접수 직후의 abort 는 이벤트를 하나도 안 낼 수 있다 (`chatRequest.ts` 실측).
   */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const { post, sessionId } = this
    const aborted = this.prompted && post !== null && sessionId !== null ? abortTurn(post, sessionId) : Promise.resolve()
    void aborted
      .catch((error: unknown) => this.deps.log?.(`[ai.run] 중단 실패: ${String(error)}`))
      .then(() => this.stop(new Error(AI_RUN_CANCELLED)))
  }

  private step<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.stopped])
  }

  /**
   * 장부의 세션을 쓴다. 없거나 서버가 모르면(404 — opencode 저장소를 지운 경우) **새로 만든다.**
   * 모른다는 것을 프롬프트에서 알면(`prompt_async` 404) 확장은 그 프로젝트에서 영영 못 묻는다.
   */
  private async session(url: string, directory: string, post: PostJson): Promise<string> {
    const { extension, projectId } = this.request
    const known = this.deps.sessions.get(extension, projectId)
    if (known !== undefined) {
      const path = `/session/${encodeURIComponent(known)}`
      const response = await this.fetchImpl(`${url}${path}`)
      if (response.ok) return known
      if (response.status !== 404) throw new Error(await httpFailure(path, response))
    }
    // `parentID` 는 싣지 않는다 (U-A 안 B) — 숨김은 장부가 한다
    const created = (await post(`/session?directory=${encodeURIComponent(directory)}`, {
      title: `ext:${extension}`,
      permission: EXTENSION_SESSION_PERMISSION,
    })) as { id?: unknown } | undefined
    const id = created?.id
    if (typeof id !== 'string' || id === '') throw new Error('ai.run: opencode 세션 생성 응답에 id 가 없습니다')
    this.deps.sessions.set(extension, projectId, id)
    return id
  }

  /** 제 세션의 이벤트만 읽어 글을 모으고, 승인·질문은 곧바로 거절하고, idle 에서 끝낸다 */
  private watch(stream: SseStream, sessionId: string, post: PostJson): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      let text = ''
      let part: unknown
      let failure: string | null = null
      stream.onEvent((raw) => {
        // **이쪽 격리.** 사용자 세션·다른 확장 세션의 것은 여기서 전부 버린다 (머리말)
        if (sessionOf(raw) !== sessionId) return
        const event = normalizeLegacyEvent(raw)
        if (event === null) return
        const props = event.properties as Record<string, unknown>
        switch (event.type) {
          case OpencodeEventType.TEXT_DELTA: {
            const delta = props['delta']
            if (typeof delta !== 'string' || delta === '') return
            // 글 파트가 바뀌면(도구를 부르고 다시 쓴 답) 빈 줄로 가른다. 조각에도 같이 싣는다 —
            // 확장이 `onText` 로 이어 붙인 것과 최종 `text` 가 같아야 한다
            const piece = text !== '' && props['textID'] !== part ? `\n\n${delta}` : delta
            part = props['textID']
            text += piece
            this.onText(piece)
            return
          }
          // 권한 규칙이 막아 오지 않아야 한다. **그래도 오면 곧바로 거절한다** (F5) — 답하지 않으면
          // 세션이 busy 로 묶이고, 받아 줄 사람도 없다 (확장 세션의 카드는 어느 화면에도 안 뜬다)
          case OpencodeEventType.PERMISSION_ASKED:
            void post(`/permission/${String(props['id'])}/reply`, { reply: 'reject' }).catch((error: unknown) =>
              this.deps.log?.(`[ai.run] 승인 거절 실패: ${String(error)}`),
            )
            return
          case OpencodeEventType.QUESTION_ASKED:
            void replyQuestionLegacy(post, String(props['id']), null).catch((error: unknown) =>
              this.deps.log?.(`[ai.run] 질문 거절 실패: ${String(error)}`),
            )
            return
          // 오류 뒤에 idle 이 온다 (실측). 오류는 적어 두고 idle 에서 거부한다
          case OpencodeEventType.SESSION_ERROR: {
            const error = props['error'] as Record<string, unknown> | undefined
            failure = error?.['name'] === 'MessageAbortedError' ? AI_RUN_CANCELLED : `ai.run: ${errorMessage(props)}`
            return
          }
          // 한 턴에 idle 이 두 번 올 수 있다 (`translate.ts` 실측) — 첫 것에서 끝나고 뒤엣것은 무시된다
          case OpencodeEventType.SESSION_IDLE:
            if (!this.prompted) return
            if (failure !== null) reject(new Error(failure))
            else resolve({ text })
            return
          default:
            return
        }
      })
      // 턴 도중 끊긴 스트림은 되살리지 않는다 — 그 사이 지나간 idle 을 영영 못 받아 확장이 매달린다
      stream.onClose(() => reject(new Error('ai.run: opencode 이벤트 스트림이 끊겼습니다')))
      stream.onError((error) => reject(error))
    })
  }
}

function sessionOf(event: OpencodeEvent): unknown {
  return (event.properties as Record<string, unknown> | undefined)?.['sessionID']
}

/** 레거시 경로는 `{data}` 로 감싸지 않는다 (`client.ts` 의 `request`). 인증은 우리가 띄운 서버라 없다 */
function poster(url: string, fetchImpl: typeof fetch): PostJson {
  return async (path, body) => {
    const response = await fetchImpl(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await httpFailure(path, response))
    const text = await response.text()
    return text ? (JSON.parse(text) as unknown) : undefined
  }
}
