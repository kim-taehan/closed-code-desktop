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

// opencode 이벤트 → davis 봉투. **부패방지 계층의 심장이다.**
//
// 위층(session/*·chunkRouter·messageStore)은 davis 봉투만 안다. 여기서 번역해 먹이면
// 매핑표(chunkRoutes.ts)·버블 묶기·승인 카드가 그대로 산다. 위층을 고치지 않는 것이 설계 목표다.
//
// 이벤트 하나가 프레임 0~N 개가 된다 (예: step.ended → turn_end + stream_end).

export interface TranslateContext {
  /** 이번 턴의 streamId. 어댑터가 chat_request 때 만들어 턴 끝까지 유지한다. */
  streamId: string
}

export type Frame = Record<string, unknown>

function chunkFrame(data: Record<string, unknown>, streamId: string): Frame {
  return { kind: Kind.CHAT, action: Action.STREAM_CHUNK, data, streamId }
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
  const name = (error as Record<string, unknown>)['name']
  return typeof name === 'string' ? name : '알 수 없는 오류'
}

/** 이벤트 하나를 davis 봉투 0~N 개로 옮긴다. 모르는 이벤트는 조용히 버린다. */
export function translate(event: OpencodeEvent, ctx: TranslateContext): Frame[] {
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
     * 턴 종료 판정. **`session.idle` 에 기대면 안 된다** — 실측상 `/api` 경로에서는
     * idle 이 아예 오지 않고 여기서 끝난다. idle 만 기다리면 진행 표시기가 영원히 돈다.
     */
    case OpencodeEventType.STEP_ENDED: {
      const step = props as unknown as StepEndedProps
      // 도구를 부르려고 끊긴 것이면 다음 step 이 이어진다 — 턴은 아직 안 끝났다.
      if (step.finish === 'tool-calls') return []
      return endTurn(ctx, step.tokens ? { tokenUsage: step.tokens } : {})
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

    case OpencodeEventType.SESSION_ERROR:
      return [
        chunkFrame({ messageType: ChunkType.ERROR, message: errorMessage(props) }, ctx.streamId),
        streamEnd(ctx.streamId, { failed: true }),
      ]

    // 폴백. `/api` 경로에서는 실측상 오지 않지만, 레거시 경로나 취소(interrupt) 뒤에는
    // 이쪽으로 턴이 닫힐 수 있다. 중복 종료는 어댑터가 streamId 를 비워 막는다.
    case OpencodeEventType.SESSION_IDLE:
      return endTurn(ctx)

    default:
      return []
  }
}
