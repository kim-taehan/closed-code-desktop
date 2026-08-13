import type { ChatImage, ContextFile } from '../protocol/chatImage'
import type { AttachmentSummary, ChatMessage, TurnMeta } from './messageTypes'
import type { AgentTask } from './agentTask'

// 대화 한 건에 얽힌 IPC 페이로드 — 스냅샷·전송·승인.
//
// channels.ts 에서 갈라냈다 (300줄 상한). 선례: fsPayloads·gitPayloads·projectPayloads.

/** 화면이 그리는 상태 전부. main 이 조립해 통째로 넘긴다. */
export interface ChatSnapshotPayload {
  messages: ChatMessage[]
  turnMetas: TurnMeta[]
  agentTasks: AgentTask[]
}

/**
 * 지금 편집기에서 보고 있는 파일. "이 함수 고쳐줘" 를 성립시키는 근거다
 * (chat_request.data.activeEditor → domains/chat.py:56 `active_editor_file`).
 *
 * **여기서는 우리 이름(`startLine`/`endLine`)을 쓴다.** runtime 의 wire 키
 * (`start_offset`/`end_offset`)로 바꾸는 곳은 `electron/session/chatFrames.ts` 한 곳뿐이다 —
 * 이름이 offset 이지만 값은 라인 번호라는 함정을 IPC 계층까지 퍼뜨리지 않는다.
 */
export interface ActiveEditorRef {
  /**
   * renderer 는 **프로젝트 루트 상대경로**로 넣는다.
   * 절대경로 변환과 `git:` 가짜 탭 제외는 main 이 한다 (`electron/session/editorContext.ts`).
   */
  filePath: string
  /** 1-based 라인 번호. 한쪽만 있을 수 없다 — runtime 이 둘 다 필수로 받는다 */
  selection?: { startLine: number; endLine: number }
}

export interface ChatSendPayload {
  query: string
  /** 붙인 이미지. runtime 계약대로 base64 + mediaType (shared/protocol/chatImage.ts) */
  images?: ChatImage[]
  /** 붙인 파일. 경로만 보낸다 — 에이전트가 직접 읽는다 */
  files?: ContextFile[]
  /** 대화에 남길 첨부 요약. 내용은 담지 않는다 */
  attachments?: AttachmentSummary[]
  /** 요청별 모델 오버라이드 (DC-1322). trim 후 truthy 만 프레임에 실린다. */
  model?: string
  /** 지금 보고 있는 파일과 선택 영역. 없으면 필드 자체가 나가지 않는다. */
  activeEditor?: ActiveEditorRef
  /**
   * 미저장 편집이 있는 파일들 (DC-603). runtime 이 이 턴 동안 직접 쓰기를 거부한다 —
   * 컨텍스트가 아니라 **안전장치**다.
   *
   * **빈 배열도 보낸다.** `[]` 는 "dirty 없음" 의 명시 신호라 생략과 뜻이 다르다.
   * 나머지 필드와 생략 규칙이 반대이므로 "일관성" 을 이유로 바꾸지 말 것.
   */
  dirtyFiles?: string[]
  /**
   * 최근에 저장한 파일들 — runtime 이 `<auto_context>` 로 프롬프트에 넣는다
   * (message_builder.py:145-160, 20개에서 절단).
   *
   * 경로만 보낸다. activeEditor 와 겹치는 것은 main 이 걸러낸다 — 같은 파일을 두 번
   * 말할 이유가 없다.
   */
  autoContext?: string[]
  /**
   * 확장이 `chat.ask` 로 보낸 요청이라는 표시 (설계 2026-08-13).
   *
   * **프레임에는 실리지 않는다** — runtime 이 알 필요가 없다. main 이 이 값을 보고
   * "다음에 열리는 턴이 그 확장의 턴" 이라고 장부에 적어 둔다 (`extensions/chatAsk.ts`).
   * 확장 요청도 사용자 입력과 **같은 큐**를 타기 때문에 그 짝을 맞출 열쇠가 필요하다.
   */
  extensionRequestId?: string
}

/**
 * 요청 한 건에 딸린 컨텍스트 전부 — `query` 를 뺀 `ChatSendPayload`.
 *
 * `send()` 의 positional 인자를 더 늘리지 않으려고 한 덩어리로 나른다.
 * IPC 페이로드와 같은 타입을 쓰므로 renderer→main→프레임 사이에 형태가 갈릴 수 없다.
 */
export type ChatSendContext = Omit<ChatSendPayload, 'query'>

/** 승인 범위. 없으면 이번 한 번만. */
export type ApprovalFollowUp = 'session_allow' | 'local_allow'

export interface ApprovalRespondPayload {
  requestId: string
  approved: boolean
  followUp?: ApprovalFollowUp
}
