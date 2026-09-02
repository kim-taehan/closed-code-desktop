import { Action, Kind } from '../../shared/protocol/kinds'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import {
  OpencodeEventType,
  type OpencodeEvent,
  type PermissionAskedProps,
  type QuestionAskedProps,
  type StepEndedProps,
  type StepStartedProps,
  type TextDeltaProps,
  type ToolInputStartedProps,
  type ToolResultProps,
} from './events'
import { normalizeLegacyEvent } from './legacyEvents'

// opencode 이벤트 → davis 봉투. **부패방지 계층의 심장이다.**
//
// 위층(session/*·chunkRouter·messageStore)은 davis 봉투만 안다. 여기서 번역해 먹이면
// 매핑표(chunkRoutes.ts)·버블 묶기·승인 카드가 그대로 산다. 위층을 고치지 않는 것이 설계 목표다.
//
// 이벤트 하나가 프레임 0~N 개가 된다 (예: step.ended → turn_end + stream_end).

export interface TranslateContext {
  /** 이번 턴의 streamId. 어댑터가 chat_request 때 만들어 턴 끝까지 유지한다. */
  streamId: string
  /**
   * 이 턴에 중단을 요청해 뒀는가.
   *
   * opencode 는 중단된 턴을 **실패(`step.failed`)로 알린다** — 사용자가 끊은 것과
   * 프로바이더가 터진 것을 이벤트만으로는 가를 수 없다. 가르는 근거는 "우리가 방금
   * interrupt 를 보냈다" 는 사실뿐이라 어댑터가 여기에 실어 준다 (`transport.ts`).
   */
  cancelling?: boolean
}

export type Frame = Record<string, unknown>

function chunkFrame(data: Record<string, unknown>, streamId: string): Frame {
  return { kind: Kind.CHAT, action: Action.STREAM_CHUNK, data, streamId }
}

/**
 * 화면에 남길 **오류** 프레임인가.
 *
 * `transport.ts` 는 턴이 없는 동안 온 스트림 프레임을 버리는데, 그때 이것만 통과시킨다 —
 * 닫을 턴이 없어도 오류는 사용자가 봐야 한다. 모양(`STREAM_CHUNK` 안의 `messageType`)을
 * 아는 곳이 여기라 판별도 여기 둔다.
 */
export function isErrorFrame(frame: Frame): boolean {
  return (frame['data'] as Record<string, unknown> | undefined)?.['messageType'] === ChunkType.ERROR
}

function streamEnd(streamId: string, data: Record<string, unknown>): Frame {
  return { kind: Kind.CHAT, action: Action.STREAM_END, data, streamId }
}

/** 턴을 닫는 프레임 쌍. opencode 는 turn_end 청크를 따로 내지 않으므로 여기서 만든다. */
function endTurn(ctx: TranslateContext, data: Record<string, unknown> = {}): Frame[] {
  return [
    chunkFrame({ messageType: ChunkType.TURN_END, turnId: ctx.streamId, terminal: true }, ctx.streamId),
    streamEnd(ctx.streamId, { terminal: true, ...data }),
  ]
}

/**
 * 텍스트 버블 묶기 키.
 *
 * `textID` 는 **메시지 안에서만 유일하다** — 실측상 매 메시지가 `text-0` 부터 다시 센다.
 * 그래서 assistantMessageID 와 합쳐야 한다. textID 만 쓰면 한 턴에 assistant 메시지가
 * 둘 이상일 때(도구 호출 후 이어지는 답변) 서로 다른 답이 한 버블로 붙는다.
 */
function segmentId(props: TextDeltaProps): string {
  return `${props.assistantMessageID ?? 'msg'}:${props.textID ?? 'text'}`
}

function translateToolResult(props: ToolResultProps, ctx: TranslateContext, success: boolean): Frame[] {
  return [
    chunkFrame(
      {
        messageType: ChunkType.TOOL_RESULT,
        toolCallId: props.callID,
        ...(props.tool ? { toolName: props.tool } : {}),
        success,
        ...(success
          ? { result: props.output ?? props.structured }
          : { error: typeof props.error === 'string' ? props.error : JSON.stringify(props.error ?? '도구 실패') }),
      },
      ctx.streamId,
    ),
  ]
}

function errorMessage(props: Record<string, unknown>): string {
  const error = props['error']
  if (error === null || typeof error !== 'object') {
    return typeof error === 'string' ? error : '알 수 없는 오류'
  }
  const data = (error as Record<string, unknown>)['data']
  if (data !== null && typeof data === 'object') {
    const message = (data as Record<string, unknown>)['message']
    if (typeof message === 'string') return message
  }
  // `step.failed` 는 한 겹 얕다 — `{type, message}` 로 온다 (1.18.18 실측).
  // `session.error` 의 `{data:{message}}` 와 모양이 달라 둘 다 본다.
  const flat = (error as Record<string, unknown>)['message']
  if (typeof flat === 'string') return flat
  const name = (error as Record<string, unknown>)['name']
  return typeof name === 'string' ? name : '알 수 없는 오류'
}

/**
 * 이벤트 하나를 davis 봉투 0~N 개로 옮긴다. 모르는 이벤트는 조용히 버린다.
 *
 * 들어오는 것은 레거시 계열(`message.part.*`)이지만 **여기서는 신규 이름만 다룬다** —
 * 이름 되옮기기는 `legacyEvents.ts` 가 먼저 하고, 이 파일은 매핑의 정본으로 남는다.
 * 번역기를 둘로 늘리면 청크 규칙이 두 벌이 되어 한쪽만 고치는 사고가 난다.
 */
export function translate(raw: OpencodeEvent, ctx: TranslateContext): Frame[] {
  const event = normalizeLegacyEvent(raw)
  if (!event) return []
  const props = event.properties as Record<string, unknown>

  switch (event.type) {
    case OpencodeEventType.SERVER_CONNECTED:
      return [{ kind: Kind.SYSTEM, action: Action.CONNECTED, data: {} }]

    case OpencodeEventType.STEP_STARTED: {
      const step = props as unknown as StepStartedProps
      return [
        chunkFrame(
          { messageType: ChunkType.TURN_START, turnId: step.assistantMessageID ?? ctx.streamId },
          ctx.streamId,
        ),
      ]
    }

    /**
     * 턴 종료 판정.
     *
     * ⚠️ **"`session.idle` 에 기대면 안 된다" 는 조건부였다.** 그 지시문은 프롬프트를
     * **`/api` 로 넣던 시절**의 실측이다 — 그때는 idle 이 아예 오지 않고 여기서 끝나서,
     * idle 만 기다리면 진행 표시기가 영원히 돌았다.
     *
     * 지금(레거시 세대)은 `session.idle` 이 **실제로 온다.** 그래도 여기서 닫는 것은
     * 그대로 두는데, 이유가 바뀌었다: 레거시는 `step-finish` 와 `session.idle` 이 **둘 다**
     * 오므로 먼저 오는 이쪽이 턴을 닫고, 뒤따르는 idle 은 어댑터가 `streamId` 를 비워
     * 막는다 (`transport.ts` 의 STREAM_END 처리).
     */
    case OpencodeEventType.STEP_ENDED: {
      const step = props as unknown as StepEndedProps
      // 도구를 부르려고 끊긴 것이면 다음 step 이 이어진다 — 턴은 아직 안 끝났다.
      if (step.finish === 'tool-calls') return []
      return endTurn(ctx, step.tokens ? { tokenUsage: step.tokens } : {})
    }

    /**
     * 실패로 끝난 step — **중단의 종료 신호이기도 하다.**
     *
     * 실측(1.18.18, 2026-08-14): 턴 도중 `POST …/interrupt` 를 넣으면 204 뒤에
     * `text.ended` + `step.failed{error:{message:"Provider turn interrupted"}}` 만 오고
     * `step.ended` 는 끝내 안 온다. 여기가 비어 있던 동안 취소한 턴을 닫는 것은
     * TurnGate 의 5초 강제 종단뿐이었고, 그 5초가 "중단이 무시됐다" 의 정체다.
     *
     * 우리가 요청한 중단은 **실패가 아니다** — `failed` 를 실으면 사용자가 스스로 끊은
     * 자리에 "요청을 처리하지 못했습니다" 가 뜬다 (turnGate.end).
     */
    case OpencodeEventType.STEP_FAILED: {
      if (ctx.cancelling) return endTurn(ctx)
      return [
        chunkFrame({ messageType: ChunkType.ERROR, message: errorMessage(props) }, ctx.streamId),
        ...endTurn(ctx, { failed: true }),
      ]
    }

    case OpencodeEventType.TEXT_DELTA: {
      const text = props as unknown as TextDeltaProps
      if (!text.delta) return []
      return [
        chunkFrame(
          { messageType: ChunkType.TEXT, message: text.delta, segmentId: segmentId(text) },
          ctx.streamId,
        ),
      ]
    }

    case OpencodeEventType.REASONING_DELTA: {
      const text = props as unknown as TextDeltaProps
      if (!text.delta) return []
      // ThinkingChunk 에는 segmentId 가 없다 (chunkTypes.ts) — streamId 로만 묶인다.
      return [chunkFrame({ messageType: ChunkType.THINKING, message: text.delta }, ctx.streamId)]
    }

    /**
     * 도구 호출은 `tool.input.started` 에서 낸다 — 이 시점에 이미 이름을 안다.
     * `tool.called`(인자 확정)까지 기다리면 인자 스트리밍 동안 화면이 비어 있다.
     */
    case OpencodeEventType.TOOL_INPUT_STARTED: {
      const tool = props as unknown as ToolInputStartedProps
      return [
        chunkFrame(
          { messageType: ChunkType.TOOL_CALL, toolName: tool.name, toolCallId: tool.callID },
          ctx.streamId,
        ),
      ]
    }

    case OpencodeEventType.TOOL_SUCCESS:
      return translateToolResult(props as unknown as ToolResultProps, ctx, true)

    case OpencodeEventType.TOOL_FAILED:
      return translateToolResult(props as unknown as ToolResultProps, ctx, false)

    case OpencodeEventType.PERMISSION_ASKED:
    case OpencodeEventType.PERMISSION_V2_ASKED: {
      const permission = props as unknown as PermissionAskedProps
      return [
        chunkFrame(
          {
            messageType: ChunkType.TOOL_APPROVAL_REQUEST,
            requestId: permission.id,
            toolName: permission.action ?? '알 수 없는 도구',
            ...(permission.title ? { displayName: permission.title } : {}),
            ...(permission.resources?.length ? { args: { resources: permission.resources } } : {}),
          },
          ctx.streamId,
        ),
      ]
    }

    case OpencodeEventType.QUESTION_ASKED:
    case OpencodeEventType.QUESTION_V2_ASKED: {
      const question = props as unknown as QuestionAskedProps
      return [
        chunkFrame(
          {
            messageType: ChunkType.USER_QUESTION,
            questionId: question.id,
            question: question.question ?? question.text ?? '',
          },
          ctx.streamId,
        ),
      ]
    }

    /**
     * ⚠️ **레거시에서는 사용자 취소가 이 분기로 들어온다.**
     *
     * 실측(1.18.18): `POST /session/:id/abort` 뒤에 이 셋이 온다 —
     *   `session.error{error:{name:"MessageAbortedError", data:{message:"Aborted"}}}`
     *   → `session.status{idle}` → `session.idle`
     *
     * 그대로 옮기면 사용자가 스스로 끊은 자리에 **"Aborted" 라는 빨간 오류**가 뜬다.
     * 여기서는 아무것도 내지 않고 뒤따르는 `session.idle` 이 턴을 닫게 둔다 — 신규 쪽
     * `step.failed` 가 `ctx.cancelling` 으로 가르던 것과 같은 판단이고, 다만 레거시는
     * 이름이 실려 와서 **우리가 끊었는지 기억할 필요가 없다.**
     * (`events.ts` 가 신규 쪽에 적어 둔 "중단으로 끝난 턴을 실패로 단정하지 말 것" 이
     * 레거시에선 이 자리로 옮겨온다.)
     */
    case OpencodeEventType.SESSION_ERROR: {
      const error = props['error']
      const name = error !== null && typeof error === 'object' ? (error as Record<string, unknown>)['name'] : null
      if (name === 'MessageAbortedError') return []
      return [
        chunkFrame({ messageType: ChunkType.ERROR, message: errorMessage(props) }, ctx.streamId),
        streamEnd(ctx.streamId, { failed: true }),
      ]
    }

    // ⚠️ **폴백이 아니다 — 취소된 턴의 유일한 종결자다.**
    //
    // 예전엔 폴백이었다(`/api` 경로에서는 실측상 오지 않았다). 레거시로 옮긴 뒤로는
    // 정상 턴에서도 오고, 무엇보다 **사용자 취소는 여기서만 닫힌다**: abort 뒤에는
    // `session.error{MessageAbortedError}` → `session.status{idle}` → `session.idle` 만
    // 오고 `step-finish` 는 끝내 안 온다. 위 SESSION_ERROR 분기가 그 오류를 일부러
    // 안 내보내므로, 이 분기를 지우면 **취소한 턴이 영영 안 닫힌다** (진행 표시기가
    // 5초 강제 종단까지 돈다 — 사용자에겐 "중단이 무시됐다" 로 보인다).
    //
    // 정상 턴에서는 `step-finish` 가 먼저 닫고 이건 뒤늦게 온다. 중복 종료는 어댑터가
    // streamId 를 비워 막는다 (`transport.ts` 의 onEvent).
    //
    // ⚠️ **그 방어는 회귀 그물이 아니라 실제로 밟힌다** — 한 턴에서 `session.idle` 이
    // **두 번** 오는 것을 실측했다(`session.status{idle}` 도 두 번). `step-finish` 까지
    // 세면 한 턴의 종료 신호가 셋이다. 저 가드를 지우면 stream_end 가 그만큼 나간다.
    case OpencodeEventType.SESSION_IDLE:
      return endTurn(ctx)

    default:
      return []
  }
}
