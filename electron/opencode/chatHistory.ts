import { Action, Kind } from '../../shared/protocol/kinds'
import { verifyEmptyChats } from './emptyChats'
import type { OpencodeSession } from './historyApi'
import { replayFrames } from './historyReplay'
import type { Frame } from './translate'
import type { OpencodeClient } from './client'

// 대화 이력의 번역 — davis `chat_history` 봉투 ↔ opencode 세션.
//
// 커넥터 다이얼로그(`mcpConfig.ts`)와 **같은 병이고 같은 처방이다**: 위층
// (`session/chatHistory.ts`·`HistoryList.tsx`)은 davis 시절 그대로 `kind=chat_history` 로
// 묻는데 어댑터에 답하는 코드가 없어서 목록이 영영 비고 "저장된 대화가 없습니다" 가 떴다.
// 고치는 것은 여기 한 곳이고 `session/*` 과 렌더러는 손대지 않는다 (부패방지 계층).
//
// ⚠️ **payload 는 snake_case 다.** 이 도메인에는 camelCase 별칭이 없어 camelCase 로 실으면
// **조용히 무시된다** — 목록이 빈 채로 뜨고 오류는 없다 (`shared/protocol/chatHistory.ts`
// 머리말이 정본이고, 그 파일의 `toHistoryEntry` 가 `chat_id` 없는 항목을 그냥 버린다).
//
// ⚠️ **시각은 ISO 문자열이어야 한다.** opencode 는 `time.created/updated` 를 **epoch ms 숫자**로
// 주는데, 화면은 `Date.parse(iso)` 로 읽는다 (`HistoryList.tsx` 의 `formatDate`). 숫자를
// 문자열로만 바꿔 실으면 `Date.parse("1786778241150")` 가 NaN 이라 **날짜만 조용히 사라진다.**
//
// **davis 개념 하나가 여기 없다: `message_count`.** `GET /session` 이 턴 수를 주지 않는다
// (`tokens`·`cost` 는 준다). 지어내지 않고 뺀다 — `ChatHistoryEntry.messageCount` 가
// optional 이고 화면도 없으면 그 자리를 비운다.
//
// **예외가 하나 생겼다: 0.** 말 한 번 안 걸린 세션에는 `message_count: 0` 을 싣는다
// (2026-08-16). 실제로 세어 확인한 것만이고, 판정 규칙과 그 비대칭은 `emptyChats.ts` 가
// 정본이다. 화면은 그 0 을 근거로 껍데기 대화를 접는다 — **제목으로 짐작하지 않는다.**
// 0 이 아닌 세션의 턴 수는 여전히 안 싣는다 (세려면 대화 전체를 받아야 하고, 그건 비싸다).

/** `chatHistory.ts` 가 쓰는 클라이언트 표면. 넷 다 레거시 세대다 (`historyApi.ts`). */
type HistoryClient = Pick<
  OpencodeClient,
  'listSessions' | 'sessionMessages' | 'deleteSession' | 'renameSession' | 'createSession'
>

export interface HistoryDeps {
  client: HistoryClient
  /** 이 세션이 선 프로젝트. **목록 질의에서 빼면 남의 프로젝트 대화가 뜬다** (`historyApi.ts`). */
  directory: string | null
  /**
   * 아직 아무 말도 안 걸린 세션이 이미 있으면 그 id. 없으면 null.
   *
   * `chat_history_add` 가 세션을 **또** 만들지 말아야 하는 자리가 있어서 받는다 (아래 `addChat`).
   */
  emptySession: string | null
}

/**
 * `chat_history` 봉투 하나를 처리한다.
 *
 * **돌려주는 것은 「이제부터 이 opencode 세션이다」** 이고, 바뀌지 않으면 null 이다.
 * 이력을 열거나 새 대화를 시작하면 **다음 프롬프트가 갈 곳이 바뀐다** — davis 는 `chat_id` 를
 * 요청마다 실어 runtime 이 갈랐지만, opencode 에서 대화의 정체는 세션 그 자체라 어댑터가
 * 붙잡고 있는 `sessionId` 를 갈아야 한다. 안 갈면 **과거 대화를 열어 놓고 이어 말했는데
 * 답이 원래 세션에 쌓인다** — 화면에는 아무 일도 안 일어난 것처럼 보인다.
 */
export async function chatHistoryFrame(
  deps: HistoryDeps,
  action: string,
  data: Record<string, unknown>,
  emit: (frame: Frame) => void,
): Promise<string | null> {
  if (action === Action.CHAT_HISTORY_LIST) {
    emit(await listFrame(deps, data))
    return null
  }
  if (action === Action.CHAT_HISTORY_ADD) return await addChat(deps, emit)
  if (action === Action.CHAT_HISTORY_LOAD) return await loadChat(deps, data, emit)
  if (action === Action.CHAT_HISTORY_REMOVE) return await removeChat(deps, data, emit)
  if (action === Action.CHAT_HISTORY_RENAME) return await renameChat(deps, data, emit)
  return null
}

/**
 * 목록 — 검색어가 실려 있으면 그대로 서버에 넘긴다.
 *
 * **거르기를 여기서 짜지 않는다.** `GET /session` 이 `search=` 를 서버에서 처리하고
 * (contract-qa 실측 — `search=인사` 로 1건), 그 파라미터의 성질은 `historyApi.ts` 에
 * 실측대로 적혀 있다. 클라이언트에서 다시 거르면 서버와 판정이 갈려, 같은 낱말로
 * 검색했는데 화면과 서버 응답이 다른 자리가 생긴다.
 */
async function listFrame(deps: HistoryDeps, data: Record<string, unknown>): Promise<Frame> {
  const search = typeof data['search'] === 'string' ? data['search'] : ''
  const sessions = await deps.client.listSessions(deps.directory, search || undefined)
  // 말 한 번 안 걸린 세션은 **세어서** 가려낸다 (`emptyChats.ts` — 후보만 센다)
  const empty = await verifyEmptyChats(sessions, (id) => deps.client.sessionMessages(id))
  return {
    kind: Kind.CHAT_HISTORY,
    action: Action.CHAT_HISTORY_LIST,
    // 순서는 opencode 가 준 그대로다 — 최근 것이 먼저 온다 (실측). 다시 정렬하지 않는다.
    data: { chats: sessions.map((session) => toChat(session, empty)) },
  }
}

/** epoch ms → ISO. 값이 없으면 그 키를 아예 빼서 화면이 빈 날짜를 그리지 않게 한다. */
function isoAt(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined
}

function toChat(session: OpencodeSession, empty: Set<string>): Record<string, unknown> {
  const created = isoAt(session.time?.created)
  const updated = isoAt(session.time?.updated)
  return {
    chat_id: session.id ?? '',
    // 제목이 비면 위층이 `대화 {id앞8자}` 로 채운다 (`toHistoryEntry`) — 여기서 짓지 않는다
    ...(session.title ? { title: session.title } : {}),
    ...(created ? { created_at: created } : {}),
    ...(updated ? { updated_at: updated } : {}),
    // 0 만 싣는다 — 세어 확인한 것이고, 나머지는 「모른다」로 남는다 (머리말)
    ...(session.id && empty.has(session.id) ? { message_count: 0 } : {}),
  }
}

/**
 * 새 대화 — opencode 세션을 새로 만든다.
 *
 * davis 는 runtime 이 `chat_id` 만 발급하고 대화는 같은 연결 위에 있었다. opencode 에서
 * 그에 대응하는 것은 **세션 생성**이다. 이 자리가 비어 있으면 「새 대화」를 눌러도 세션이
 * 그대로라 **앞 대화에 계속 이어 붙는다** — 화면만 비워지고 모델은 앞 이야기를 기억한다.
 *
 * ⚠️ **비어 있는 세션이 이미 있으면 그걸 준다. 또 만들면 붙어 있던 세션을 버리게 된다.**
 * davis 에서 `chat_history_add` 는 id 하나 받아 오는 값싼 일이라 위층이 **붙자마자** 부른다
 * (`session/sessionReady.ts` 의 `primeOnFirstReady`). opencode 에서는 그 직전에 핸드셰이크가
 * 이미 새 세션을 만들어 뒀다 (`workspace.ts`) — 여기서 무조건 만들면 **연결마다 세션이 둘씩
 * 생기고, 어댑터는 나중 것으로 갈아탄다.** 그런데 그 갈아타기는 `createSession` 응답을
 * 기다리는 동안 일어나서, 그 사이에 보낸 첫 질문은 **먼저 만든 세션으로 나간다.**
 * 그러면 답이 오는 이벤트의 sessionID 가 우리 것과 달라 `transport.ts` 의 격리 필터가
 * 전부 버린다 — **화면이 영원히 답을 못 받는다.** (`multiSession.test.ts` 가 이걸 잡았다.
 * 증상은 "다른 프로젝트 이벤트가 샌다" 의 정확히 반대편, "내 이벤트가 나한테 안 온다" 였다.)
 *
 * 모델·에이전트를 안 싣는다: 세션이 만들어질 때 프로젝트 설정이 정한 기본이 걸리고,
 * 오버라이드는 보내기 직전에 `models.ts` 가 다시 건다 (`transport.ts` 의 `onChatRequest`).
 */
async function addChat(deps: HistoryDeps, emit: (frame: Frame) => void): Promise<string | null> {
  const reused = deps.emptySession
  // ⚠️ **지금은 닿지 않는 가지다. 닿으면 「새 대화」 버튼이 에러 없이 죽는다.**
  // 봉투를 아무것도 안 내므로 위층 `requestNewChat()` 은 응답을 영영 못 받는다.
  // 안 닿는 근거는 **순서 하나뿐이다**: `directory` 는 `onWorkspaceSync` 만이 채우는데,
  // 그 프레임(`WORKSPACE_STATE=READY`)이 나가야 핸드셰이크가 ready 가 되고, 그제서야
  // `primeOnFirstReady` 가 이걸 부른다 (contract-qa 가 사슬 전체를 밟아 확인했다).
  // **프라이밍 순서를 건드리는 사람은 이 줄을 먼저 보라** — 조용히 죽는 부류다.
  if (!reused && !deps.directory) return null
  const chatId = reused ?? (await deps.client.createSession({ directory: deps.directory ?? '' })).id
  emit({
    kind: Kind.CHAT_HISTORY,
    action: Action.CHAT_HISTORY_ADD,
    data: { chat_id: chatId, state: reused ? 'ready' : 'created', message: '' },
  })
  return chatId
}

/**
 * 과거 대화 열기 — 되짓기(`historyReplay.ts`)는 저쪽이 하고 여기는 순서를 지킨다.
 *
 * **`chat_history_load_complete` 를 반드시, 마지막에 낸다.** 위층은 그 봉투로 두 가지를
 * 푼다: 로딩 표시(`loadingChatId`)와 **재생 중 인터럽트 억제**(`ReplayGate` — 죽은 승인·질문
 * 카드를 올리지 않는 장치, DC-866). 안 내면 로딩이 영영 돌고 그 다음 라이브 대화의 승인
 * 카드까지 삼켜진다. 실패해도 내야 하므로 오류 봉투와 함께 낸다 (`errorFrames`).
 */
async function loadChat(
  deps: HistoryDeps,
  data: Record<string, unknown>,
  emit: (frame: Frame) => void,
): Promise<string | null> {
  const chatId = typeof data['chat_id'] === 'string' ? data['chat_id'] : ''
  if (!chatId) return null
  try {
    for (const frame of replayFrames(chatId, await deps.client.sessionMessages(chatId))) emit(frame)
  } catch (error) {
    emit(errorFrame(error))
  }
  emit({
    kind: Kind.CHAT_HISTORY,
    action: Action.CHAT_HISTORY_LOAD_COMPLETE,
    data: { chat_id: chatId, state: 'loaded', message: '' },
  })
  // 연 대화가 곧 지금 대화다 — 이어 말하면 이 세션에 붙는다 (위 반환값 주석)
  return chatId
}

/**
 * 대화 삭제 (목록의 × 버튼).
 *
 * 지운 것이 **지금 열려 있는 대화일 수도 있다.** 그때 세션 id 를 그대로 두면 다음 프롬프트가
 * 없어진 세션으로 나가 404 가 된다 — 여기서는 판단할 근거(현재 세션 id)가 없으므로
 * 어댑터가 가른다 (`transport.ts` 의 CHAT_HISTORY 분기).
 */
async function removeChat(
  deps: HistoryDeps,
  data: Record<string, unknown>,
  emit: (frame: Frame) => void,
): Promise<string | null> {
  const chatId = typeof data['chat_id'] === 'string' ? data['chat_id'] : ''
  if (!chatId) return null
  await deps.client.deleteSession(chatId, deps.directory)
  // 위층은 이 봉투를 받으면 목록을 다시 물어 온다 (`session/chatHistory.ts`) — 그쪽이 정본이다
  emit({
    kind: Kind.CHAT_HISTORY,
    action: Action.CHAT_HISTORY_REMOVE,
    data: { chat_id: chatId, state: 'removed', message: '' },
  })
  return null
}

/** 제목 변경 (`/rename`). 화면은 이미 낙관적으로 바꿔 뒀고, 여기 응답이 정본으로 덮는다. */
async function renameChat(
  deps: HistoryDeps,
  data: Record<string, unknown>,
  emit: (frame: Frame) => void,
): Promise<string | null> {
  const chatId = typeof data['chat_id'] === 'string' ? data['chat_id'] : ''
  const title = typeof data['title'] === 'string' ? data['title'] : ''
  if (!chatId || !title) return null
  await deps.client.renameSession(chatId, deps.directory, title)
  emit({ kind: Kind.CHAT_HISTORY, action: Action.CHAT_HISTORY_TITLE, data: { chat_id: chatId, title } })
  return null
}

/** 이력 오류는 `chat_history` 봉투로 낸다 — 위층이 그걸 받아야 로딩이 풀린다. */
function errorFrame(error: unknown): Frame {
  return {
    kind: Kind.CHAT_HISTORY,
    action: Action.ERROR,
    data: { code: 'HISTORY_FAILED', message: error instanceof Error ? error.message : String(error) },
  }
}
