import { Action, Kind } from '../../shared/protocol/kinds'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import type { OpencodeMessage } from './historyApi'
import { stripPromptContext } from './promptContext'
import type { Frame } from './translate'

// 지난 대화를 davis 프레임으로 **되짓는다** (`chat_history_load` 의 몸통).
//
// davis runtime 은 이력을 지난 프레임 그대로 다시 흘려보냈다 — `session/chatHistory.ts`
// 머리말의 "runtime 이 지난 프레임을 다시 흘려보낸다" 가 그것이고, 화면·라우터는 라이브와
// 같은 길을 탄다. opencode 에는 그 재전송이 없고 **완성된 메시지 목록**만 있어서
// (`GET /session/:id/message` — 세대 실측은 `historyApi.ts`), 프레임을 여기서 다시 만든다.
//
// **라이브 매핑(`translate.ts`)과 같은 청크로 떨어져야 한다.** 해석기는 ChunkRouter 하나뿐이라
// 여기서만 다른 모양을 내면 **같은 대화가 재생될 때만 다르게 그려진다** — 라이브에서는
// 멀쩡한데 이력으로 열면 어긋나는, 재현 조건이 좁아 늦게 잡히는 부류다.
//
//   part.text       → TEXT       (라이브의 `text.delta` 들을 합쳐 놓은 것)
//   part.reasoning  → THINKING
//   part.tool       → TOOL_CALL + TOOL_RESULT
//   part.step-start → 버린다 (턴 경계는 아래 규칙으로 다시 세운다)
//   part.step-finish→ `reason` 만 본다 (아래)
//
// **턴 경계를 다시 세워야 한다.** opencode 는 step 마다 assistant 메시지를 따로 남겨서,
// 사용자 질문 하나에 assistant 메시지가 여럿이다 (실측: 도구를 부른 대화는 6~8개). 그대로
// 스트림을 하나씩 열면 화면에 턴이 여덟 개로 쪼개져 보인다. 라이브가 `step.ended` 의
// `finish==='tool-calls'` 를 "아직 안 끝났다" 로 읽는 것과 **같은 근거**를 여기서도 쓴다 —
// 재생에서는 그 값이 `step-finish` part 의 `reason` 에 남아 있다.
//
// ⚠️ **`user` 는 청크가 아니라 `chat_request` 봉투로 되돌린다.** davis runtime 이 재생 때
// 사용자 질문을 그렇게 돌려줬고 위층이 그 자리를 그대로 열어 두고 있다
// (`session/frameDispatch.ts` 의 `onUserQuery` — "라이브 땐 안 와 중복 없음").

/** 재생 프레임에는 어느 대화인지가 실린다 — 위층이 `chat_id` 를 그 자리에서 잡는다. */
interface ReplayContext {
  chatId: string
  streamId: string
}

function chunk(data: Record<string, unknown>, ctx: ReplayContext): Frame {
  return { kind: Kind.CHAT, action: Action.STREAM_CHUNK, data, streamId: ctx.streamId, chatId: ctx.chatId }
}

function textOf(part: Record<string, unknown>): string {
  return typeof part['text'] === 'string' ? part['text'] : ''
}

/**
 * 도구 한 건 → 호출 + 결과.
 *
 * 라이브는 `tool.input.started` 에서 호출을, `tool.success`/`tool.failed` 에서 결과를 냈다.
 * 재생에는 그 두 순간이 `state.status` 하나로 접혀 있다 — 갈래마다 키가 다르다
 * (`/doc` 의 `ToolState*`, contract-qa 가 실측한 분포는 completed 34 · error 1 · running 1):
 *
 *   completed → `output`          error → `error`          pending·running → 둘 다 없다
 *
 * ⚠️ **결과가 없는 도구도 반드시 닫는다.** 여기에는 원래 "끝나지 않은 도구는 결과를 내지
 * 않는다 — 없는 결과를 지어내면 실패한 적 없는 도구가 실패로 보인다" 고 적혀 있었다.
 * **그 판단이 틀렸다** (2026-08-15, contract-qa 지적 → 렌더러에서 확인). 결과가 없으면
 * `toolStatusOf` 가 `'running'` 을 주고(`ToolIcon.tsx:58`), `ToolCallRow` 의 경과시간이
 * **1초마다 도는 타이머를 영영 돌린다** (`useToolElapsed` — `hasResult` 가 false 인 동안).
 * 게다가 그 시계는 **재생한 시각부터** 세서, 작년에 끝난 대화에 "3초… 4초…" 가 올라간다.
 * `running` 상태는 실제로 영속돼 있다(중단된 세션에 남는다) — 안 닫으면 이력을 열 때마다
 * 끝나지 않는 스피너가 뜬다. 지어낸 실패보다 이쪽이 나쁘다.
 *
 * 그래서 사실대로 닫는다: 성공했다고 하지 않고, 무엇이 일어났는지를 문구로 남긴다.
 *
 * **`toolArgs` 는 라이브에 없고 여기에만 있다.** 라이브는 이름을 아는 즉시(인자 스트리밍
 * 전에) 호출을 내보내느라 인자를 못 싣는다 (`translate.ts` 의 TOOL_INPUT_STARTED). 재생에는
 * `state.input` 이 이미 있고 청크 계약에도 자리가 있어(`ToolCallChunk.toolArgs`) 그대로 싣는다 —
 * 이 어긋남은 **재생이 라이브보다 더 보여주는** 쪽이라, 도구 행이 이름만 남는 것보다 낫다.
 */
function toolFrames(part: Record<string, unknown>, ctx: ReplayContext): Frame[] {
  const state = (part['state'] ?? {}) as Record<string, unknown>
  const callId = typeof part['callID'] === 'string' ? part['callID'] : undefined
  const toolName = typeof part['tool'] === 'string' ? part['tool'] : '알 수 없는 도구'
  const input = state['input']
  const frames = [
    chunk(
      {
        messageType: ChunkType.TOOL_CALL,
        toolName,
        ...(callId ? { toolCallId: callId } : {}),
        ...(input !== undefined ? { toolArgs: input } : {}),
      },
      ctx,
    ),
  ]

  const success = state['status'] === 'completed'
  frames.push(
    chunk(
      {
        messageType: ChunkType.TOOL_RESULT,
        toolName,
        ...(callId ? { toolCallId: callId } : {}),
        success,
        ...(success ? { result: state['output'] } : { error: toolError(state) }),
      },
      ctx,
    ),
  )
  return frames
}

/** 실패 문구. 끝나지 않은 채 저장된 도구는 실패한 것이 아니라 **결과가 없는** 것이다. */
function toolError(state: Record<string, unknown>): string {
  if (typeof state['error'] === 'string' && state['error'] !== '') return state['error']
  if (state['status'] === 'pending' || state['status'] === 'running') {
    return '결과가 기록되기 전에 대화가 끝났습니다'
  }
  return '도구 실패'
}

/**
 * assistant 메시지 하나의 본문 청크들.
 *
 * ⚠️ **`segmentId` 에 messageID 를 함께 넣는다.** part id 만 쓰면 될 것 같지만, 버블 묶기
 * 규칙을 라이브(`translate.ts` 의 `segmentId`)와 맞춰 두는 편이 안전하다 — 저쪽이 그렇게
 * 하는 이유(메시지마다 `text-0` 부터 다시 센다)가 여기서도 그대로다.
 */
function bodyFrames(message: OpencodeMessage, ctx: ReplayContext): Frame[] {
  const messageId = message.info?.id ?? 'msg'
  const frames: Frame[] = []

  for (const part of message.parts ?? []) {
    if (part['type'] === 'text') {
      const text = textOf(part)
      if (!text) continue
      const partId = typeof part['id'] === 'string' ? part['id'] : 'text'
      frames.push(chunk({ messageType: ChunkType.TEXT, message: text, segmentId: `${messageId}:${partId}` }, ctx))
      continue
    }
    if (part['type'] === 'reasoning') {
      const text = textOf(part)
      // ThinkingChunk 에는 segmentId 가 없다 (chunkTypes.ts) — 라이브와 같게 둔다
      if (text) frames.push(chunk({ messageType: ChunkType.THINKING, message: text }, ctx))
      continue
    }
    if (part['type'] === 'tool') frames.push(...toolFrames(part, ctx))
  }

  // ⚠️ **중단으로 끝난 메시지는 오류가 아니다.** 라이브에서 `MessageAbortedError` 를
  // 일부러 안 내보내는 것과 같은 판단이다 (`translate.ts` 의 SESSION_ERROR 분기) —
  // 그대로 옮기면 사용자가 스스로 끊은 자리에 이력을 열 때마다 빨간 오류가 다시 뜬다.
  const error = message.info?.error
  if (error && error.name !== 'MessageAbortedError') {
    const detail = error.data?.message ?? error.name ?? '알 수 없는 오류'
    frames.push(chunk({ messageType: ChunkType.ERROR, message: detail }, ctx))
  }
  return frames
}

/** 이 메시지에서 턴이 끝났는가. 도구를 부르려고 끊긴 것이면 다음 메시지가 이어진다. */
function endsTurn(message: OpencodeMessage): boolean {
  const finish = (message.parts ?? []).filter((part) => part['type'] === 'step-finish').at(-1)
  // step-finish 가 아예 없으면(중단·크래시) 그 자리에서 끝난 것으로 본다 — 안 그러면
  // 그 뒤 사용자 질문까지 한 스트림에 묶여 턴 경계가 사라진다.
  return finish === undefined || finish['reason'] !== 'tool-calls'
}

/**
 * 대화 한 건을 davis 프레임 목록으로 옮긴다. **순수 함수다** — 이 파일은 HTTP 를 모른다.
 *
 * `streamId` 는 재생분끼리만 구분되면 되므로 대화 id 에 번호를 붙여 짓는다. 라이브 턴의
 * `streamId`(randomUUID)와 섞일 일이 없고, 값이 결정적이라 테스트가 프레임을 그대로 겨눈다.
 */
export function replayFrames(chatId: string, messages: OpencodeMessage[]): Frame[] {
  const frames: Frame[] = []
  let open: ReplayContext | null = null
  let openTurnId = ''
  let streamCount = 0

  const closeStream = (): void => {
    if (!open) return
    // turnId 는 **마지막으로 연 턴**이다. 라이브(`translate.ts` 의 `endTurn`)는 이 자리에
    // streamId 를 싣는데, 그쪽은 종료 이벤트에 assistant 메시지 id 가 없어서다. 재생은
    // 알고 있으므로 짝을 맞춘다 — 안 맞추면 `turnMeta` 가 열린 턴을 놓지 못한다(`onTurnEnd`).
    frames.push(chunk({ messageType: ChunkType.TURN_END, turnId: openTurnId, terminal: true }, open))
    frames.push({
      kind: Kind.CHAT,
      action: Action.STREAM_END,
      data: { terminal: true },
      streamId: open.streamId,
      chatId,
    })
    open = null
  }

  for (const message of messages) {
    if (message.info?.role === 'user') {
      closeStream()
      // 우리가 붙인 꼬리표는 떼고 되돌린다 — 사용자가 친 말만 말풍선에 남는다
      const query = stripPromptContext(
        (message.parts ?? [])
          .filter((part) => part['type'] === 'text')
          .map(textOf)
          .filter((text) => text !== '')
          .join('\n'),
      )
      if (query) {
        frames.push({ kind: Kind.CHAT, action: Action.CHAT_REQUEST, data: { query }, chatId })
      }
      continue
    }
    if (message.info?.role !== 'assistant') continue

    if (!open) {
      streamCount += 1
      open = { chatId, streamId: `${chatId}:replay-${streamCount}` }
      frames.push({ kind: Kind.CHAT, action: Action.STREAM_START, data: {}, streamId: open.streamId, chatId })
    }
    openTurnId = message.info.id ?? open.streamId
    frames.push(chunk({ messageType: ChunkType.TURN_START, turnId: openTurnId }, open))
    frames.push(...bodyFrames(message, open))
    if (endsTurn(message)) closeStream()
  }

  // 마지막 턴이 안 닫힌 채 끝날 수 있다 (대화가 진행 중에 끊긴 경우). 열어 둔 채 넘기면
  // 화면이 그 대화를 **지금 응답 중**으로 읽어 전송이 잠긴다 (`turnGate.isOpen`).
  closeStream()
  return frames
}
