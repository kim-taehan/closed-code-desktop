import type { ErrorSeverity } from '../../shared/protocol/errorMessages'
import type { MessageKind } from '../../shared/ipc/messageTypes'
import type { ConnectionState, HandshakeStage } from '../../shared/ipc/sessionTypes'
import type { TurnEvent } from '../../shared/ipc/turnEvent'

// `mobile/protocol/PROTOCOL.md` §4 「앱 프레임」을 TS 로 옮긴 것. **정본은 저쪽이다** (계획 §7) —
// 모바일이 RN 이라 `.d.ts` 를 쓸 수도 있었지만, 언어 중립을 유지하려고 계약은 문서 +
// JSON Schema(`mobile/protocol/schema/`) + 골든 픽스처로 두고 여기는 그 **사본**이다.
//
// 사본이 어긋나는 것을 막는 것은 타입체크가 아니라 픽스처다 (`mobile/protocol/fixtures/README.md`).
// 지금 픽스처가 비어 있는 이유도 거기 적혀 있다 — 손으로 쓴 픽스처는 desktop 이 실제로 내는
// 모양이 아니라 우리가 기대하는 모양을 잠근다.
//
// ## 아래 타입이 상위 타입을 그대로 쓰지 않는 자리
//
// - `turn` 은 `TurnEvent` 에서 **`type: 'text'` 를 뺀다.** 그 글은 `messageId` 가 없어 휴대폰이
//   어느 버블에 붙일지 모른다 (§4-1 의 「왜 `turn` 에서 `text` 를 빼고 `delta` 를 따로 두나」).
// - `session` 은 `endpoint`·`locateFailure` 를 안 싣는다. `projects` 는 `root`(절대경로)를 안 싣는다.
//   휴대폰에 PC 의 파일 경로를 흘리지 않는다 (§4-1 표의 근거 칸).
// - `ProjectedMessage` 는 `toolResult`·`toolArgs`·`attachments`·`shell` 을 뺀다. 도구 결과 원본은
//   대화 한 건에서 가장 큰 덩어리이고(§2: BLE 로 스냅숏을 그대로 못 보낸다), `toolArgs` 는
//   승인 카드에 필요해서 `pending` 에만 실린다.

export const PROTOCOL_VERSION = 0

/** 열린 프로젝트 하나 (§4-1 `projects`) */
export interface RemoteProject {
  projectId: string
  name: string
  stage: HandshakeStage
}

/** 휴대폰이 받는 턴 이벤트 — `text` 만 빠진다 */
export type RemoteTurnEvent = Exclude<TurnEvent, { type: 'text' }>

/** 한 메시지 본문에 **덧붙일** 글 (§4-1 `delta`). 처음 보는 `messageId` 면 새 메시지다 */
export interface RemoteDelta {
  messageId: string
  turnId?: string
  author?: 'user' | 'assistant'
  kind: MessageKind
  append: string
}

/** `ChatMessage` 의 투영 (§4-1 투영 규칙) */
export interface ProjectedMessage {
  id: string
  author: 'user' | 'assistant'
  kind: MessageKind
  content: string
  /** 메시지당 상한에서 잘렸다 */
  contentTruncated?: boolean
  turnId?: string
  toolName?: string
  toolCallId?: string
  interrupted?: boolean
  severity?: ErrorSeverity
}

/** 지금 답을 기다리는 것 하나 (§4-1 `pending`). `turnEvent.ts` 의 세 모양에서 `type` → `kind` */
export type PendingInterrupt =
  | {
      kind: 'approval'
      turnId: string
      requestId: string
      toolName: string
      /** 인자 전체 — 자르지 않는다. 휴대폰 승인은 PC 에서의 원격 명령 실행이다 (계획 §3) */
      args?: unknown
      reason?: string
      displayName?: string
    }
  | { kind: 'question'; turnId: string; questionId: string; question: string; options?: string[] }
  | {
      kind: 'plan'
      turnId: string
      planId: string
      summary: string
      filesToChange?: string[]
      estimatedSteps?: number
    }

/** 거절 사유 (§4-2 「거절 코드」) */
export type RejectCode =
  /** 허용 목록에 **아예 없는** `t` — 영구히 안 열린다 (§4-3) */
  | 'not_allowed'
  /**
   * 허용 목록엔 있으나(§4-2) **그 착지 단계가 아직 안 열렸다.** `not_allowed` 와 가르는 이유:
   * 휴대폰이 이 코드를 받으면 **나중에 열릴 수 있다**는 뜻이라 그 기능 화면을 영구히 지우지 않는다.
   * 지금은 `chat.send`·`cancel`(P2)·응답 셋(P3)이 여기로 온다.
   */
  | 'not_yet'
  | 'bad_frame'
  | 'unknown_project'
  | 'unknown_request'
  | 'approvals_disabled'
  | 'not_ready'

export type OutboundFrame =
  | {
      v: 0
      t: 'hello'
      p: { protocol: 0; approvalsAllowed: boolean; maxMessageBytes: number }
    }
  | { v: 0; t: 'projects'; p: { projects: RemoteProject[] } }
  | {
      v: 0
      t: 'session'
      projectId: string
      p: { stage: HandshakeStage; connection?: ConnectionState }
    }
  | { v: 0; t: 'turn'; projectId: string; p: RemoteTurnEvent }
  | { v: 0; t: 'delta'; projectId: string; p: RemoteDelta }
  | {
      v: 0
      t: 'snapshot'
      projectId: string
      p: { messages: ProjectedMessage[]; truncated: boolean }
    }
  | { v: 0; t: 'pending'; projectId: string; p: { items: PendingInterrupt[] } }
  | { v: 0; t: 'ack'; id: string; projectId?: string }
  | { v: 0; t: 'reject'; id?: string; projectId?: string; p: { code: RejectCode; message?: string } }

/**
 * 휴대폰이 보낼 수 있는 것 — **허용 목록** (§4-2). 목록 밖은 전부 `not_allowed`, 목록 안이지만
 * 아직 안 연 단계는 `not_yet` 이다 (기본 거부).
 *
 * 여기 셋은 P1 몫이다. `chat.send`·`cancel`(P2)과 응답 셋(P3)은 문서의 목록에는 있지만
 * **아직 이 타입에 없다** — 없는 것을 열어 두면 「거절한다」가 「조용히 무시한다」가 된다.
 */
export type InboundCommand =
  | { t: 'hello'; id: string; p: { protocol: 0; deviceName: string } }
  | { t: 'subscribe'; id: string; p: { projectIds: string[] } }
  | { t: 'sync'; id: string; projectId: string }
