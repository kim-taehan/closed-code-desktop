import { Action, Kind } from '../../shared/protocol/kinds'
import { parseInbound } from '../../shared/protocol/envelope'
import type { StreamEndData } from '../../shared/protocol/chunkTypes'

// 들어온 프레임 하나를 **누구에게 넘길지**만 정한다. 해석은 하지 않는다.
//
// `ChatSession` 에서 떼어냈다. 두 가지를 얻는다:
//   ① 세션 파일이 300줄 상한에 붙어 있어 손댈 자리가 없었다
//   ② **확장 질의를 되찾는 자리가 바로 여기다** — 확장이 채팅으로 물으면 그 턴의
//      `stream_start`/`stream_end` 를 보고 짝을 맞춰야 하는데(`extensions/chatAsk.ts`),
//      그 이음매가 세션 안쪽에 숨어 있으면 걸 곳이 없다
//
// 순수 함수로 둔다 — 상태는 전부 호출자가 들고, 여기서는 부르기만 한다.

export interface ChatFrameHandlers {
  /** 서버가 발급한 chat_id. 이후 요청에 실어 보낸다 (davis 런타임 경로에서만 온다) */
  onChatId(chatId: string): void
  /** 이력 재생 중 되돌아온 사용자 질문 */
  onUserQuery(query: string): void
  onStreamStart(streamId: string): void
  onChunk(data: unknown, streamId?: string): void
  onStreamEnd(data: StreamEndData | undefined, streamId?: string): void
  onError(data: unknown): void
}

/** 채팅 프레임이 아니면 아무 일도 하지 않는다. */
export function dispatchChatFrame(raw: string, handlers: ChatFrameHandlers): void {
  const frame = parseInbound(raw)
  if (!frame || frame.kind !== Kind.CHAT) return

  if (typeof frame.chatId === 'string' && frame.chatId) handlers.onChatId(frame.chatId)

  const streamId = typeof frame.streamId === 'string' ? frame.streamId : undefined

  if (frame.action === Action.CHAT_REQUEST) {
    // 이력 재생 중 runtime 이 사용자 chat_request 를 되돌린다 — 질문 복원
    // (라이브 땐 안 와 중복 없음)
    const query = (frame.data as { query?: unknown } | undefined)?.query
    if (typeof query === 'string' && query) handlers.onUserQuery(query)
    return
  }
  if (frame.action === Action.STREAM_START) {
    if (streamId) handlers.onStreamStart(streamId)
    return
  }
  if (frame.action === Action.STREAM_CHUNK) return handlers.onChunk(frame.data, streamId)
  if (frame.action === Action.STREAM_END) {
    return handlers.onStreamEnd(frame.data as StreamEndData | undefined, streamId)
  }
  if (frame.action === Action.ERROR) return handlers.onError(frame.data)
}
