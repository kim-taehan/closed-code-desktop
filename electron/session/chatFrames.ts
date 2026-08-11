import { createEnvelope, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import type { ActiveEditorRef, ChatSendContext } from '../../shared/ipc/chatPayloads'

// IDE → runtime 으로 나가는 chat 프레임을 만든다.
//
// 순수 함수로 떼어 둔 이유는 **무엇을 보내는가** 와 **언제 보내는가** 가
// 서로 다른 관심사이기 때문이다. 여기는 계약(필드 이름·위치)만 안다.

export interface FrameContext {
  chatId: string | null
  streamId: string | null
}

/**
 * activeEditor 를 runtime 형태로 바꾼다 (`domains/chat.py:7-16` EditorRef/Selection).
 * **wire 키를 아는 유일한 곳이다** — 위쪽(IPC·renderer)은 우리 이름만 쓴다.
 *
 * 함정 셋:
 *
 *  1. **`selection` 의 wire 키만 snake_case 다.** `Selection` 의 alias 가 필드명과 같아
 *     (`start_offset = Field(..., alias="start_offset")`) camelCase 도메인 안의 snake_case
 *     섬이 된다. `envelope.ts` 의 허용 목록에 등재돼 있어야 `serializeEnvelope()` 가 던지지 않는다.
 *
 *  2. **이름이 offset 이지만 값은 1-based 라인 번호다.** runtime 이 직접 부인한다 —
 *     `agent/message_builder.py:18-32` docstring: "필드명은 'offset'이지만 실제 값은
 *     IDE에서 line 번호로 전달된다. LLM이 character 위치로 오해하지 않도록 XML 직렬화
 *     단계에서만 start_line/end_line 명명으로 노출한다". vscode `EditorInfoCollector.ts:7`
 *     `SELECTION_OFFSET_MODE = 'line'`, intellij `EditorInfoExtractor.java:105` 도 같다.
 *     **문자 오프셋으로 "고치지" 말 것** — 이름만 보고 고치면 LLM 이 엉뚱한 곳을 본다.
 *
 *  3. `start_offset`/`end_offset` 은 **둘 다 필수**(`ge=0`)다. 한쪽만 실으면 프레임 검증에
 *     걸리므로, 선택 영역이 없으면 `selection` 키 자체를 생략한다.
 */
function wireEditorRef(editor: ActiveEditorRef): Record<string, unknown> {
  const selection = editor.selection
  return {
    filePath: editor.filePath,
    ...(selection ? { selection: { start_offset: selection.startLine, end_offset: selection.endLine } } : {}),
  }
}

/** chat_request. data.query 만 필수다 (domains/chat.py:46-92) */
export function chatRequestFrame(
  query: string,
  context: ChatSendContext,
  envelope: Pick<FrameContext, 'chatId'>,
): string {
  const images = context.images ?? []
  const files = context.files ?? []
  return serializeEnvelope(
    createEnvelope(
      Kind.CHAT,
      Action.CHAT_REQUEST,
      {
        query,
        // 빈 배열은 아예 넣지 않는다 — 안 붙인 것과 붙였다 뺀 것을 구분할 이유가 없다
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { contextFiles: files } : {}),
        // 요청별 모델 오버라이드 (DC-1320/1322). trim 후 truthy 만 싣고 아니면 **생략**
        // — 필드 유무가 하위호환 규칙이다. runtime 은 세션에 기억하지 않는다 (매 요청 재전송).
        ...(context.model?.trim() ? { model: context.model.trim() } : {}),
        // 보고 있는 파일이 없으면 필드 자체를 생략한다 (vscode MessageFactory.ts:79-86 과 같음)
        ...(context.activeEditor ? { activeEditor: wireEditorRef(context.activeEditor) } : {}),
        // ⚠️ dirtyFiles 만 생략 규칙이 **반대**다 — 빈 배열도 그대로 보낸다.
        // `[]` 는 "dirty 없음" 의 명시 신호이고, 생략은 "IDE 가 알려주지 않음" 이라 뜻이 다르다
        // (DC-603, vscode MessageFactory.ts:143-145 `if (dirtyFiles !== undefined)`).
        // 나머지 필드와 "일관성" 을 맞춘다며 생략으로 바꾸지 말 것.
        ...(context.dirtyFiles !== undefined ? { dirtyFiles: context.dirtyFiles } : {}),
        // autoContext 는 EditorRef 배열이다 — 경로 문자열이 아니라 `{ filePath, type }`
        // (runtime ChatData.auto_context: List[EditorRef], domains/chat.py:53).
        // 비면 생략한다 (dirtyFiles 와 달리 "없음" 을 알릴 이유가 없다).
        ...(context.autoContext?.length
          ? { autoContext: context.autoContext.map((filePath) => ({ filePath, type: 'file' as const })) }
          : {}),
      },
      envelope.chatId ? { chatId: envelope.chatId } : {},
    ),
  )
}

/**
 * stream_cancel.
 *
 * streamId 는 **data 가 아니라 봉투에** 실어야 한다 — runtime 이 env.streamId 를 읽는다.
 */
export function cancelFrame(context: FrameContext): string {
  return serializeEnvelope(
    createEnvelope(
      Kind.CHAT,
      Action.STREAM_CANCEL,
      {},
      {
        ...(context.streamId ? { streamId: context.streamId } : {}),
        ...(context.chatId ? { chatId: context.chatId } : {}),
      },
    ),
  )
}

/**
 * 승인 범위 (chat_service.py:888-923).
 *   session_allow — 이 대화 동안 이 도구 자동 승인
 *   local_allow   — 이 PC 이 프로젝트에서 항상 (런타임이 파일에 저장)
 * 없으면 이번 한 번만.
 */
export type ApprovalFollowUp = 'session_allow' | 'local_allow'

/** 승인 응답. 보내지 않으면 턴이 그 자리에서 멈춘다 (chat_service.py:888-932) */
export function approvalFrame(
  requestId: string,
  approved: boolean,
  context: Pick<FrameContext, 'chatId'>,
  followUp?: ApprovalFollowUp,
): string {
  return serializeEnvelope(
    createEnvelope(
      Kind.CHAT,
      Action.TOOL_APPROVAL_RESPONSE,
      { requestId, approved, ...(followUp ? { followUp } : {}) },
      context.chatId ? { chatId: context.chatId } : {},
    ),
  )
}

/** ask_user 답. answer=null 은 취소다 (domains/chat.py:76-77) */
export function userAnswerFrame(
  questionId: string,
  answer: string | null,
  context: Pick<FrameContext, 'chatId'>,
): string {
  return serializeEnvelope(
    createEnvelope(
      Kind.CHAT,
      Action.USER_ANSWER,
      { questionId, answer },
      context.chatId ? { chatId: context.chatId } : {},
    ),
  )
}

/** 계획 승인/거부 응답 (domains/chat.py:90-92) */
export function planResponseFrame(
  planId: string,
  approved: boolean,
  comment: string | undefined,
  context: Pick<FrameContext, 'chatId'>,
): string {
  return serializeEnvelope(
    createEnvelope(
      Kind.CHAT,
      Action.PLAN_APPROVAL_RESPONSE,
      { planId, planApproved: approved, ...(comment ? { planComment: comment } : {}) },
      context.chatId ? { chatId: context.chatId } : {},
    ),
  )
}
