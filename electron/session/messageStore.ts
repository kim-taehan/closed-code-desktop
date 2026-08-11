import { randomUUID } from 'node:crypto'
import { MessageKind, type AttachmentSummary, type ChatMessage } from '../../shared/ipc/messageTypes'
import type { SemanticType } from '../../shared/protocol/chunkTypes'
import { findErrorMessage } from '../../shared/protocol/errorMessages'
import { foldToolResult, type ToolResultChunkData } from './toolCallFold'

// 메시지 배열 조립만 책임진다. 어떤 청크를 어떻게 다룰지는 chunkRouter 가 정한다.
//
// 텍스트 버블 경계는 (streamId, segmentId) 튜플이다 —
// 같은 튜플이면 이어붙이고, 바뀌면 새 버블을 연다 (설계 §5.1).

export interface TextAppendInput {
  text: string
  streamId?: string
  segmentId?: string
  semanticType?: SemanticType
  turnId?: string
}

export interface ToolCallInput {
  toolName: string
  toolCallId?: string
  toolArgs?: unknown
  streamId?: string
  turnId?: string
}

export interface ErrorInput {
  message: string
  code?: string
  turnId?: string
}

export class MessageStore {
  private items: ChatMessage[] = []

  get messages(): readonly ChatMessage[] {
    return this.items
  }

  snapshot(): ChatMessage[] {
    return [...this.items]
  }

  reset(): void {
    this.items = []
  }

  /** 시스템 안내 한 줄 (모델 변경 구분선 등). 턴에 속하지 않는다. */
  addSystem(content: string): void {
    this.items = [
      ...this.items,
      { id: randomUUID(), author: 'assistant', kind: MessageKind.SYSTEM, content },
    ]
  }

  addUserMessage(content: string, attachments: AttachmentSummary[] = []): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      author: 'user',
      kind: MessageKind.TEXT,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
    this.items = [...this.items, message]
    return message
  }

  /**
   * 텍스트 청크를 붙인다.
   * 마지막 메시지가 같은 (streamId, segmentId) 의 TEXT 면 이어붙이고, 아니면 새 버블을 연다.
   */
  appendText(input: TextAppendInput): void {
    const last = this.items[this.items.length - 1]

    if (
      last &&
      last.author === 'assistant' &&
      last.kind === MessageKind.TEXT &&
      last.streamId === input.streamId &&
      last.segmentId === input.segmentId
    ) {
      const merged: ChatMessage = { ...last, content: last.content + input.text }
      // 나중에 온 semanticType 이 있으면 채워 넣는다 (없던 값만)
      if (input.semanticType !== undefined && merged.semanticType === undefined) {
        merged.semanticType = input.semanticType
      }
      this.items = [...this.items.slice(0, -1), merged]
      return
    }

    this.items = [...this.items, this.buildAssistant(MessageKind.TEXT, input.text, input)]
  }

  /**
   * 추론(thinking) 청크를 붙인다 (DC-1029/1030).
   *
   * 런타임이 버블 묶기를 IDE 몫으로 남겼고 segmentId 도 주지 않으므로
   * **streamId 만으로** 이어붙인다. 답변(TEXT)이 오면 kind 가 달라
   * 자연히 새 버블이 열리며 추론 블록이 닫힌다 (domains/chat.py:146).
   */
  appendThinking(input: TextAppendInput): void {
    const last = this.items[this.items.length - 1]

    if (
      last &&
      last.author === 'assistant' &&
      last.kind === MessageKind.THINKING &&
      last.streamId === input.streamId
    ) {
      this.items = [...this.items.slice(0, -1), { ...last, content: last.content + input.text }]
      return
    }

    this.items = [...this.items, this.buildAssistant(MessageKind.THINKING, input.text, input)]
  }

  addToolCall(input: ToolCallInput): void {
    const message = this.buildAssistant(MessageKind.TOOL_CALL, '', input)
    message.toolName = input.toolName
    message.timestamp = new Date().toISOString()
    if (input.toolCallId !== undefined) message.toolCallId = input.toolCallId
    if (input.toolArgs !== undefined) message.toolArgs = input.toolArgs
    this.items = [...this.items, message]
  }

  /** tool_result 는 새 메시지를 만들지 않는다. 짝이 없으면 폐기한다 (설계 §5.2). */
  applyToolResult(data: ToolResultChunkData, streamId?: string): boolean {
    const outcome = foldToolResult(this.items, data, streamId)
    this.items = outcome.messages
    return outcome.folded
  }

  /**
   * 마지막 메시지를 셸 결과로 표시한다.
   *
   * 원문을 함께 남기는 이유는 **runtime 이 이 대화를 모르기 때문**이다 —
   * 이어서 물으려면 명령과 출력을 다시 실어 보내야 한다.
   */
  markLastAsShell(command: string, output: string): void {
    const last = this.items[this.items.length - 1]
    if (!last) return
    this.items = [...this.items.slice(0, -1), { ...last, shell: { command, output } }]
  }

  /**
   * 에러 한 줄.
   *
   * 코드가 카탈로그(24종)에 있으면 **사용자 문구로 바꿔 넣는다** — 코드값을 그대로 보이면
   * `OPENAI_BADREQUEST` 같은 내부 식별자가 사용자 앞에 뜬다. 세 IDE 도 코드는 감추고
   * title/message 만 보여준다 (vscode `ErrorMessage/index.tsx:18-20`).
   * 카탈로그에 없는 코드는 **기존 그대로** — 런타임이 준 원문이 진단에 더 쓸모 있다.
   */
  addError(input: ErrorInput): void {
    const known = findErrorMessage(input.code)
    const content = known
      ? `${known.title}\n${known.message}`
      : input.code
        ? `${input.message} (${input.code})`
        : input.message
    // 심각도도 함께 싣는다 — 전부 같은 빨강으로 그리면 "잠시 후 다시 시도" 같은 안내가
    // 치명적 오류처럼 보인다. 카탈로그에 없는 코드는 심각도를 모르므로 error 로 둔다
    // (모르는 것을 가볍게 보이는 쪽이 더 위험하다).
    const message = { ...this.buildAssistant(MessageKind.ERROR, content, input), severity: known?.severity ?? 'error' }
    this.items = [...this.items, message]
  }

  /** 마지막 메시지가 에러인가. 실패로 끝난 턴에 에러가 이미 있는지 판단할 때 쓴다. */
  lastIsError(): boolean {
    return this.items[this.items.length - 1]?.kind === MessageKind.ERROR
  }

  /**
   * type_revision — 기존 텍스트 버블의 semanticType 만 바꾼다. DOM 은 만들지 않는다.
   * **뒤에서부터** 찾는다. segmentId 가 턴을 가로질러 충돌할 수 있기 때문이다.
   */
  reviseSemanticType(segmentId: string, semanticType: SemanticType): boolean {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const message = this.items[index]!
      if (message.kind !== MessageKind.TEXT || message.segmentId !== segmentId) continue
      if (message.semanticType === semanticType) return false

      const next = [...this.items]
      next[index] = { ...message, semanticType }
      this.items = next
      return true
    }
    return false
  }

  /** 활성 턴의 마지막 assistant 메시지를 중단으로 표시한다 */
  markInterrupted(turnId: string | null): boolean {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const message = this.items[index]!
      if (message.author !== 'assistant') continue
      if (turnId !== null && message.turnId !== turnId) continue

      const next = [...this.items]
      next[index] = { ...message, interrupted: true }
      this.items = next
      return true
    }
    return false
  }

  private buildAssistant(
    kind: MessageKind,
    content: string,
    source: { streamId?: string; segmentId?: string; semanticType?: SemanticType; turnId?: string },
  ): ChatMessage {
    const message: ChatMessage = { id: randomUUID(), author: 'assistant', kind, content }
    if (source.turnId !== undefined) message.turnId = source.turnId
    if (source.streamId !== undefined) message.streamId = source.streamId
    if (source.segmentId !== undefined) message.segmentId = source.segmentId
    if (source.semanticType !== undefined) message.semanticType = source.semanticType
    return message
  }
}
