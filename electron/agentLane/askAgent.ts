import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import { WsConnection } from '../ws/connection'
import { Handshake } from '../session/handshake'
import { chatRequestFrame } from '../session/chatFrames'
import { toWebSocketUrl, type RuntimeEndpoint } from '../runtime/locator'
import { report, toolLine, type AgentActivity } from './agentActivity'

// 확장이 코드 어시스턴트에게 물을 때 쓰는 **전용 레인**.
//
// ## 왜 사용자 세션을 안 쓰나
//
// `ChatSession` 은 들어오는 아무 프레임의 `chatId` 로 자기 것을 갈아끼운다
// (`chatSession.ts:211`). 확장 질의와 사용자 대화가 한 객체를 쓰면 서로의 chatId 를
// 덮어써 **사용자 대화가 확장 쪽으로 이어진다.** 게다가 청크가 renderer 로 흘러가
// 사용자 화면에 확장의 분석 과정이 그대로 찍힌다.
//
// 그래서 **자기 소켓**을 연다. `chatSession.ts`(299줄, 이 레포에서 가장 민감한 파일)를
// 건드리지 않고, 확장 질의는 사용자 화면에 한 글자도 남기지 않는다.
//
// ## 왜 확장이 직접 열지 않나
//
// 확장이 소켓을 열려면 **라이선스 키**를 받아야 한다. 그것은 설치된 모든 확장에 키를
// 내주는 것이라, 배포처로 남의 확장을 받기 시작하는 순간 그대로 위험이 된다.
// 여기서는 키가 main 밖으로 나가지 않는다 — 확장이 보는 것은 `davis.agent.ask(prompt)`
// 하나뿐이다.
//
// ## 읽기 전용
//
// 핸드셰이크 직후 `set_permission_mode { mode: 'plan' }` 을 건다. 권한 모드는
// **세션 스코프**라(runtime `workspace_service.py`) 이 소켓에만 걸리고, 그래서
// 확장이 시킨 분석이 사용자의 파일을 고치는 일이 원천적으로 없다. 사용자 세션의
// 권한 모드는 이 소켓과 무관하게 그대로다.

/** 연결에 필요한 것 전부. `ProjectSession` 이 이미 알고 있는 값들이다. */
export interface AgentLaneConfig {
  /** `RuntimeEndpoint` 그대로다 — `toWebSocketUrl` 이 `source` 까지 요구한다. */
  endpoint: RuntimeEndpoint
  workspacePath: string
  projectName?: string
}

/**
 * 세션이 쥔 값에서 레인 설정을 뽑는다.
 *
 * `ProjectSession` 안에 두지 않은 이유는 저쪽이 300줄 상한에 닿아서이고, 두고 보니
 * 자리도 여기가 맞다 — **레인이 무엇을 필요로 하는지는 레인이 안다.**
 * 인자를 구조로 받아 `ProjectSessionConfig` 를 import 하지 않는다 (순환 참조가 된다).
 */
export function laneConfigOf(
  endpoint: RuntimeEndpoint,
  config: { workspacePath: string; projectName?: string },
): AgentLaneConfig {
  return {
    endpoint,
    workspacePath: config.workspacePath,
    ...(config.projectName ? { projectName: config.projectName } : {}),
  }
}

/**
 * 활성 프로젝트의 레인으로 묻는다. 레인이 없으면 **사유와 함께 거절한다.**
 *
 * 빈 문자열을 돌려주면 확장은 "에이전트가 아무것도 못 찾았다" 로 읽고 빈 산출물을 낸다 —
 * 사용자에게는 연결이 안 됐다는 사실이 어디에도 안 남는다.
 */
export function askViaLane(
  lane: AgentLaneConfig | null,
  prompt: string,
  options: AskOptions = {},
): Promise<string> {
  if (!lane) {
    return Promise.reject(
      new Error('코드 어시스턴트에 연결돼 있지 않습니다 — 프로젝트를 열고 연결을 확인하세요'),
    )
  }
  return askAgent(lane, prompt, options)
}

export interface AskOptions {
  /** 답이 이 시간 안에 안 오면 포기한다. 분석 질의는 길어서 채팅 기본값보다 넉넉하다. */
  timeoutMs?: number
  /**
   * 중단 신호. 켜지면 **소켓을 끊어** 이 질문을 그 자리에서 실패시킨다.
   *
   * 깃발만 두고 다음 질문 전에 확인하는 방식으로는 부족하다 — 질의 하나가 수 분이라
   * 「중단」을 눌러도 그 한 번이 끝날 때까지 아무 일도 안 일어난다.
   */
  signal?: AbortSignal
  /**
   * 어시스턴트가 **답하는 도중에** 무엇을 하고 있는지. 답과 별개로 흘러간다.
   *
   * 안 주면 예전과 똑같다 — 청크를 그냥 버린다. 이 기능은 통째로 선택이다.
   */
  onActivity?: (activity: AgentActivity) => void
}

/**
 * 중단으로 끝났음을 **부르는 쪽이 알아볼 수 있게** 하는 표시.
 *
 * RPC 를 건너면 오류는 문자열만 남는다. 확장이 「중단인가 그냥 실패인가」를 갈라야
 * 나머지 묶음을 계속 돌지 멈출지 정할 수 있어, 사람이 읽는 문장 안에 표식을 박아 둔다.
 */
export const CANCELLED = '[중단]'

/**
 * 답을 기다리는 한도.
 *
 * 300초에서 올렸다. 실측(테스트 시나리오 확장, Spring 프로젝트): 대상 하나를 쓰는 질의가
 * 2분 29초 · 3분 22초였고 **하나는 300초에 걸려 5분을 쓰고 0건으로 버려졌다.** 확장이
 * 질의를 겹쳐 돌리기 시작하면(`extensions/test-scenario` 의 `LANES`) 큐가 밀려 개별
 * 질의는 더 길어지므로, 이 값이 그대로면 빨라진 만큼 실패가 늘어난다.
 *
 * 넉넉히 두는 쪽이 싸다 — 여기 걸린 질의는 **그때까지 쓴 토큰과 시간이 통째로 버려지고**,
 * 사용자에게 남는 것은 붉은 줄 하나뿐이다. 진짜로 멈춘 경우는 사용자가 「중단」으로
 * 끊는다(`options.signal`). 이 한도는 그 손잡이가 없을 때의 마지막 그물이다.
 */
const DEFAULT_TIMEOUT_MS = 600_000

/** 소켓마다 달라야 하는 값. 같은 csid 로 둘을 열면 runtime 이 앞엣것을 끊는다. */
let laneSeq = 0

/**
 * 질문 하나를 보내고 **최종 답 텍스트**를 돌려준다.
 *
 * 한 번 물을 때마다 소켓을 열고 닫는다. 붙여 두지 않는 이유는 상태가 생기기 때문이다 —
 * 붙여 두면 "지금 이 레인이 살아 있나" 를 확장·호스트 양쪽이 알아야 하고, 재연결·수명이
 * 사용자 세션과 얽힌다. 분석 질의는 드물게 일어나므로 그 값을 치를 이유가 없다.
 *
 * ⚠️ **연결이 하나 늘어난다.** 라이선스 기기 수에 어떻게 잡히는지는 아직 실측하지 않았다.
 */
export async function askAgent(
  config: AgentLaneConfig,
  prompt: string,
  options: AskOptions = {},
): Promise<string> {
  // 이미 끊긴 뒤에 부르면 소켓을 열지도 않는다 — 중단해 놓고 새 연결을 만들 이유가 없다
  if (options.signal?.aborted) throw new Error(`${CANCELLED} 사용자가 중단했습니다`)

  laneSeq += 1
  const csid = `desktop-ext-${process.pid}-${laneSeq}`
  const connection = new WsConnection({
    url: toWebSocketUrl(config.endpoint, csid),
    // **재연결하지 않는다.** 한 질문에 한 소켓이라 끊기면 그 질문은 실패로 끝나야 한다 —
    // 다시 붙어 봐야 runtime 쪽 세션이 이미 사라져 답이 오지 않는다.
    autoReconnect: false,
  })

  const handshake = new Handshake(connection, {
    workspacePath: config.workspacePath,
    ...(config.projectName ? { projectName: config.projectName } : {}),
  })

  // 중단이 오면 **소켓을 끊는다.** 그러면 `collectAnswer` 의 close 갈래가 타면서
  // 이 질문이 그 자리에서 실패한다 — 답을 기다리며 수 분을 더 서 있지 않는다.
  const onAbort = () => connection.close(4001, 'cancelled by user')
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const ready = handshake.run()
    ready.catch(() => {})
    await connection.connect()
    await ready

    // 읽기 전용을 **먼저** 건다. chat_request 뒤에 걸면 그 사이에 에이전트가 이미
    // 편집 도구를 잡을 수 있다.
    connection.send(
      serializeEnvelope(createEnvelope(Kind.WORKSPACE, Action.SET_PERMISSION_MODE, { mode: 'plan' })),
    )

    const answer = collectAnswer(connection, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.onActivity)
    connection.send(chatRequestFrame(prompt, {}, { chatId: null }))
    return await answer
  } catch (error) {
    // 끊어서 실패한 것이면 **중단이라고 말한다.** 「연결이 끊겼습니다」로 두면 사용자가
    // 자기가 누른 결과를 장애로 읽는다.
    if (options.signal?.aborted) throw new Error(`${CANCELLED} 사용자가 중단했습니다`)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    // 성공이든 실패든 반드시 닫는다 — 안 닫으면 질문할 때마다 소켓이 쌓인다
    connection.dispose()
  }
}

/**
 * 답 텍스트를 모은다.
 *
 * **도구 호출·사고 과정은 버린다.** 확장이 원하는 것은 결론이고, 중간 과정을 섞으면
 * 확장이 그걸 파싱해야 한다. 텍스트 청크만 이어 붙인다.
 *
 * 끝나는 자리는 **봉투의 `action: stream_end`** 다 — `messageType` 이 아니다
 * (`chatSession.ts:229` 와 같은 판정). 청크는 `action: stream_chunk` 안에 실려 오고
 * 그 안의 `messageType` 이 종류를 가른다. 둘을 헷갈리면 턴이 영영 안 끝난다.
 *
 * 턴 종료 경로가 여럿인 것은 사용자 세션의 사정이고(취소·HIL·소켓 끊김), 이 레인에는
 * 취소도 HIL 도 없다 — 읽기 전용이라 승인이 안 뜨고, 사람이 보고 있지 않아 물어볼
 * 상대도 없다.
 */
function collectAnswer(
  connection: WsConnection,
  timeoutMs: number,
  onActivity?: (activity: AgentActivity) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parts: string[] = []
    let done = false

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`에이전트가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다`)))
    }, timeoutMs)

    function finish(settle: () => void): void {
      if (done) return
      done = true
      clearTimeout(timer)
      unsubscribeMessage()
      unsubscribeClose()
      settle()
    }

    const unsubscribeMessage = connection.onMessage((raw) => {
      const frame = parseInbound(raw)
      if (!frame || frame.kind !== Kind.CHAT) return

      if (frame.action === Action.STREAM_END) {
        finish(() => resolve(parts.join('')))
        return
      }
      if (frame.action !== Action.STREAM_CHUNK) return

      const data = (frame.data ?? {}) as Record<string, unknown>
      if (data['messageType'] === ChunkType.TEXT && typeof data['message'] === 'string') {
        parts.push(data['message'])
        // **답을 모으는 일과 별개다.** 텍스트가 흐르기 시작한 것 자체가 「살아 있다」는
        // 소식이라, 모으기와 같은 자리에서 알린다.
        report(onActivity, 'text', data['message'])
        return
      }
      // 아래 둘은 **답에 안 섞는다** — 확장이 원하는 것은 결론이다 (이 함수 머리말).
      // 그렇다고 버리면 수 분짜리 질의 동안 화면이 조용해 멈춘 것으로 읽힌다.
      if (data['messageType'] === ChunkType.THINKING && typeof data['message'] === 'string') {
        report(onActivity, 'thinking', data['message'])
        return
      }
      if (data['messageType'] === ChunkType.TOOL_CALL) {
        report(onActivity, 'tool', toolLine(data))
        return
      }
      // 에러는 끝까지 기다리지 않고 그 자리에서 올린다 — 안 그러면 타임아웃까지 매달린다
      if (data['messageType'] === ChunkType.ERROR) {
        const reason = typeof data['message'] === 'string' ? data['message'] : '알 수 없는 오류'
        finish(() => reject(new Error(`에이전트 오류: ${reason}`)))
      }
    })

    // 소켓이 먼저 끊기면 stream_end 가 영영 안 온다.
    //
    // **닫힌 사유를 함께 올린다.** 실측에서 이 오류가 떴는데 코드도 이유도 안 남아
    // runtime 이 거절한 것인지·네트워크가 끊긴 것인지·상대가 죽은 것인지 가릴 수 없었다.
    // 1006 은 상대가 인사 없이 사라진 것이고, 1000/1001 은 상대가 정상적으로 닫은 것이다.
    const unsubscribeClose = connection.onClose((info) => {
      const detail = info.reason ? `${info.code} ${info.reason}` : String(info.code)
      finish(() => reject(new Error(`에이전트 연결이 끊겼습니다 (close ${detail})`)))
    })
  })
}

// 활동 조각의 모양은 이 레인의 공개 계약이다 (`AskOptions.onActivity`)
export type { AgentActivity }
