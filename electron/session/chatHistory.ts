import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import {
  parseHistoryList,
  parseHistoryState,
  type ChatHistoryEntry,
} from '../../shared/protocol/chatHistory'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 채팅 이력 (domains/chat_history.py).
//
// ⚠️ 이 도메인은 요청·응답 모두 **snake_case 가 정본이다.** chat 도메인과 반대다.
//
// 이력 로드는 runtime 이 지난 프레임을 **다시 흘려보내는** 방식이다.
// 그래서 로딩 중에는 그 프레임들이 라이브 응답처럼 보인다 —
// 로딩 상태를 따로 들고 있어야 화면이 "지금 대화 중"으로 착각하지 않는다.

export interface ChatHistoryState {
  entries: ChatHistoryEntry[]
  /** 지금 이력을 불러오는 중인가 */
  loading: boolean
  /** 불러온(또는 불러오는) 대화 */
  loadingChatId: string | null
  /** 지금 화면에 열려 있는 대화 (제목 헤더용). 발급 전이면 null. */
  current: { chatId: string; title: string } | null
}

export class ChatHistoryController {
  private entries: ChatHistoryEntry[] = []
  private loadingChatId: string | null = null
  /** 지금 열려 있는 대화 — 헤더/이력에 같은 제목을 보이려고 여기서 정본으로 든다. */
  private currentChatId: string | null = null
  private currentTitle = ''
  private unsubscribe: Unsubscribe | null = null

  private readonly stateHandlers = new HandlerSet<[ChatHistoryState]>()
  /** 이력 재생이 끝났음을 알린다 — 화면이 스크롤을 맞추는 시점 */
  private readonly loadCompleteHandlers = new HandlerSet<[string]>()
  /** 새 대화 chat_id 가 발급됐음을 알린다 (chat_history_add 응답). ChatSession 이 그 id 로 보낸다. */
  private readonly newChatHandlers = new HandlerSet<[string]>()

  constructor(private readonly transport: Transport) {}

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.transport.onMessage((raw) => this.handleMessage(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.stateHandlers.clear()
    this.loadCompleteHandlers.clear()
    this.newChatHandlers.clear()
  }

  get state(): ChatHistoryState {
    return {
      entries: this.entries,
      loading: this.loadingChatId !== null,
      loadingChatId: this.loadingChatId,
      current: this.currentChatId ? { chatId: this.currentChatId, title: this.currentTitle } : null,
    }
  }

  onStateChange(handler: (state: ChatHistoryState) => void): Unsubscribe {
    return this.stateHandlers.add(handler)
  }

  onLoadComplete(handler: (chatId: string) => void): Unsubscribe {
    return this.loadCompleteHandlers.add(handler)
  }

  /** 새 chat_id 가 발급되면 알린다. */
  onNewChatId(handler: (chatId: string) => void): Unsubscribe {
    return this.newChatHandlers.add(handler)
  }

  /** 새 대화 chat_id 발급을 요청한다 (chat_history_add). 응답이 오면 onNewChatId 로 흐른다. */
  requestNewChat(): boolean {
    return this.send(Action.CHAT_HISTORY_ADD, {})
  }

  /**
   * 목록을 다시 받아 온다. `search` 를 주면 **거르기는 서버가 한다.**
   *
   * ⚠️ **이 인자는 davis 계약에 없던 것이다** (2026-08-16에 더했다). 이 레포의 전제는
   * "어댑터가 번역하고 `session/*` 은 안 고친다" 인데, 검색어만은 그 규칙으로 못 푼다 —
   * 값이 **화면에서 나서** 어댑터까지 가야 하고, 어댑터가 위층에서 받는 것은 이 봉투뿐이라
   * 실을 자리가 여기 말고 없다. 대신 **더하기만 한다**: 기존 action 에 선택 키 하나이고,
   * davis runtime 은 모르는 키를 그냥 버렸을 것이라 옛 계약을 깨지 않는다.
   * 무엇을 어떻게 거르는지는 opencode 의 `search=` 실측이 정본이다
   * (`electron/opencode/historyApi.ts` — **제목만** 본다).
   */
  requestList(search?: string): boolean {
    return this.send(Action.CHAT_HISTORY_LIST, search ? { search } : {})
  }

  load(chatId: string): boolean {
    this.loadingChatId = chatId
    // 불러온 대화가 곧 현재 대화 — 제목도 목록에서 가져와 헤더에 맞춘다
    this.currentChatId = chatId
    this.currentTitle = this.entries.find((entry) => entry.chatId === chatId)?.title ?? ''
    this.emit()
    return this.send(Action.CHAT_HISTORY_LOAD, { chat_id: chatId })
  }

  /** 현재 대화 제목 변경 (/rename). 헤더·이력에 즉시 반영하고 런타임에도 보낸다. */
  renameCurrent(title: string): boolean {
    if (!this.currentChatId || !title.trim()) return false
    this.currentTitle = title.trim()
    this.setEntryTitle(this.currentChatId, this.currentTitle)
    this.emit()
    return this.rename(this.currentChatId, this.currentTitle)
  }

  remove(chatId: string): boolean {
    return this.send(Action.CHAT_HISTORY_REMOVE, { chat_id: chatId })
  }

  rename(chatId: string, title: string): boolean {
    return this.send(Action.CHAT_HISTORY_RENAME, { chat_id: chatId, title })
  }

  private send(action: string, data: Record<string, unknown>): boolean {
    const envelope = createEnvelope(Kind.CHAT_HISTORY, action as never, data)
    return this.transport.send(serializeEnvelope(envelope))
  }

  private handleMessage(raw: string): void {
    const frame = parseInbound(raw)
    if (!frame || frame.kind !== Kind.CHAT_HISTORY) return

    if (frame.action === Action.CHAT_HISTORY_LIST) {
      this.entries = parseHistoryList(frame.data)
      this.emit()
      return
    }

    if (frame.action === Action.CHAT_HISTORY_LOAD_COMPLETE) {
      const result = parseHistoryState(frame.data)
      const chatId = result?.chatId ?? this.loadingChatId
      this.loadingChatId = null
      this.emit()
      if (chatId) this.loadCompleteHandlers.emit(chatId)
      return
    }

    // 새 대화 발급 — chat_id 를 잡아 현재 대화로 삼고 ChatSession 에도 알린다 (VS Code 방식)
    if (frame.action === Action.CHAT_HISTORY_ADD) {
      const result = parseHistoryState(frame.data)
      if (result?.chatId) {
        this.currentChatId = result.chatId
        this.currentTitle = ''
        this.newChatHandlers.emit(result.chatId)
        this.emit()
      }
      this.requestList()
      return
    }

    // 삭제 후에는 목록이 달라졌으므로 다시 받아온다
    if (frame.action === Action.CHAT_HISTORY_REMOVE) {
      this.requestList()
      return
    }

    if (frame.action === Action.CHAT_HISTORY_TITLE) {
      this.applyTitle(frame.data)
      return
    }

    // 로딩 중 오류가 나면 영원히 로딩 상태로 남지 않게 푼다
    if (frame.action === Action.ERROR && this.loadingChatId !== null) {
      this.loadingChatId = null
      this.emit()
    }
  }

  private applyTitle(data: unknown): void {
    if (data === null || typeof data !== 'object') return
    const record = data as Record<string, unknown>
    const chatId = record['chat_id']
    const title = record['title']
    if (typeof chatId !== 'string' || typeof title !== 'string') return
    // 현재 대화면 헤더 제목도, 목록에 있으면 그 항목도 함께 갱신한다
    if (chatId === this.currentChatId) this.currentTitle = title
    this.setEntryTitle(chatId, title)
    this.emit()
  }

  /** 목록에 그 대화가 있으면 제목을 바꾼다 (없으면 그냥 둔다 — 헤더는 currentTitle 로 보인다). */
  private setEntryTitle(chatId: string, title: string): void {
    const index = this.entries.findIndex((entry) => entry.chatId === chatId)
    if (index < 0) return
    const next = [...this.entries]
    next[index] = { ...next[index]!, title }
    this.entries = next
  }

  private emit(): void {
    this.stateHandlers.emit(this.state)
  }
}
