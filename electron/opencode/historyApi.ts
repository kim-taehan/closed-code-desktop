// 대화 이력 표면 (목록·내용·삭제·제목).
//
// `client.ts` 에서 갈라냈다 (300줄 상한 — `mcpApi.ts`·`legacyChat.ts` 와 같은 사유).
// 봉투 번역은 `chatHistory.ts`, 프레임 되짓기는 `historyReplay.ts` 가 정본이다.
//
// ⚠️ **넷 다 레거시 세대다. 이번엔 고른 것이 아니라 그쪽에만 있다** (2026-08-15 실측,
// 1.18.18 — 채팅 계열이 레거시인 것은 골라서 그런 것이다, `legacyChat.ts` 머리말):
//
//   GET    /session?directory=       배열 그대로 32건 — 제목·시각·토큰까지
//   GET    /session/:id/message      `[{info, parts}]` 대화 전체 (21KB)
//   DELETE /session/:id              신규(`/api/session/:id`)에는 **DELETE 자체가 없다**
//   PATCH  /session/:id              제목 변경. 신규에는 없다 (`/doc` 162경로 전수 확인)
//
// 신규 쪽이 같은 이름으로 **다른 것을 준다.** 목록은 `{data, cursor}` 로 감싸 페이지를
// 나누고, 내용은 대화가 아니라 이벤트 로그다 — 같은 시각·같은 세션에서 잰 값:
//
//   GET /api/session/:id/message  → `{"data":[{"type":"model-switched",…}], "cursor":…}` (395B)
//   GET /api/session/:id/history  → `{"data":[{"type":"session.next.model.switched",…}]}` (359B)
//
// 이름만 보고 신규로 옮기면 **목록은 되는데 대화가 빈 채로 열린다.** 증상이 "이력이 안
// 열린다" 가 아니라 "열었는데 아무것도 없다" 라 원인을 서버에서 찾게 된다.
//
// ⚠️ **`GET /session` 에서 `?directory=` 를 빼면 서버가 아는 세션이 전부 온다** — 다른
// 프로젝트 것까지. 실측: 없이 부르면 32건(전부 `atworks-renew-ui`), `directory=closed-code`
// 로 부르면 0건. `/event` 가 서버 전역인 것과 같은 성질이고(`transport.ts` 의 sessionID
// 필터), 여기서 막는 것은 이 질의 하나뿐이다. 빼면 **남의 프로젝트 대화 목록이 뜬다.**

/** `client.ts` 의 private `get` 을 빌려 온다 (`mcpApi.ts` 와 같은 방식). */
export type Getter = <T>(path: string) => Promise<T>
/** DELETE·PATCH 용. `post` 로는 못 부른다 — 이 표면에만 필요해 `client.ts` 가 따로 연다. */
export type Requester = <T>(method: string, path: string, body?: unknown) => Promise<T>

/** `GET /session` 항목 중 목록이 쓰는 것. `time` 은 **epoch ms 다** (ISO 문자열 아님). */
export interface OpencodeSession {
  id?: string
  title?: string
  directory?: string
  time?: { created?: number; updated?: number }
}

/** `GET /session/:id/message` 의 한 건. `parts` 해석은 `historyReplay.ts` 가 한다. */
export interface OpencodeMessage {
  info?: {
    id?: string
    role?: string
    /** 중단·실패로 끝난 메시지에만. `{name, data:{message}}` (실측) */
    error?: { name?: string; data?: { message?: string } }
  }
  parts?: Record<string, unknown>[]
}

function sessionPath(suffix: string, directory: string | null): string {
  return `/session${suffix}${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`
}

/**
 * 이 프로젝트의 대화 목록. **`directory` 를 빼지 말 것** (머리말 — 남의 목록이 온다).
 *
 * `search` 는 **서버가 거른다** — 클라이언트에서 다시 거르지 않는다. 실측한 성질
 * (2026-08-16, 1.18.18, 세션 4건을 심어 놓고 질의를 바꿔 가며 잼):
 *
 *   대상   **제목뿐이다.** 같은 세션의 user 메시지에 든 낱말("오소리감투")로는 0건이고,
 *          그 세션 제목의 조각("New")으로는 1건이다 — **본문은 안 뒤진다.**
 *   대소문자 무시 — `hello`·`HELLO`·`Hello` 가 전부 "인사 Hello World" 를 맞힌다
 *   모양   **이어진 부분문자열**이다 (낱말로 쪼개지 않는다). "Hello World" 는 맞히고
 *          "프로젝트 Report" 는 0건 — 둘 다 같은 제목 안에 있지만 뒤엣것은 안 이어져 있다
 *   빈 값  거르지 않는다 (= 전체). 그래서 아래에서 빈 문자열이면 인자를 아예 안 싣는다
 *   ⚠️ **`%`·`_` 가 이스케이프 없이 새어 SQL LIKE 와일드카드가 된다** — `search=%` 하나로
 *      전부 오고 `H_llo` 가 "Hello" 를 맞힌다. **여기서 막지 않는다**: LIKE 의 ESCAPE 절을
 *      우리가 정할 수 없어 올바로 이스케이프할 방법이 없고, 서버가 고쳐지면 두 번
 *      이스케이프된 값을 보내게 된다. 사용자가 `%` 를 치면 전부 보이는 것이 지금의 진실이다
 *
 * `?directory=` 와 **함께** 쓴다 — search 만 싣고 directory 를 빼면 남의 프로젝트 대화가
 * 검색 결과로 뜬다 (머리말의 격리 규칙은 검색에도 그대로다).
 */
export async function listSessions(
  get: Getter,
  directory: string | null,
  search?: string,
): Promise<OpencodeSession[]> {
  const params = new URLSearchParams()
  if (directory) params.set('directory', directory)
  if (search) params.set('search', search)
  const query = params.toString()
  const sessions = await get<OpencodeSession[]>(`/session${query ? `?${query}` : ''}`)
  return Array.isArray(sessions) ? sessions : []
}

/**
 * 대화 한 건의 전체 내용.
 *
 * `?directory=` 를 안 싣는다 — 세션 id 하나로 찾는 표면이고, 애초에 목록에서 이미
 * 이 프로젝트 것만 골라 왔다.
 */
export async function sessionMessages(get: Getter, sessionId: string): Promise<OpencodeMessage[]> {
  const messages = await get<OpencodeMessage[]>(`/session/${encodeURIComponent(sessionId)}/message`)
  return Array.isArray(messages) ? messages : []
}

/** 대화를 지운다 (목록의 × 버튼). */
export async function deleteSession(
  request: Requester,
  sessionId: string,
  directory: string | null,
): Promise<void> {
  await request('DELETE', sessionPath(`/${encodeURIComponent(sessionId)}`, directory))
}

/**
 * 대화 제목을 바꾼다 — `PATCH /session/:id`. 본문은 `{title}` 하나면 된다 (`/doc` 의 `session.update`).
 *
 * **`/rename` 엔드포인트가 아니다.** davis 에는 그 이름의 문이 따로 있었고 주석이 그대로
 * 따라왔다 — opencode 는 세션 갱신 하나로 받는다.
 */
export async function renameSession(
  request: Requester,
  sessionId: string,
  directory: string | null,
  title: string,
): Promise<void> {
  await request('PATCH', sessionPath(`/${encodeURIComponent(sessionId)}`, directory), { title })
}
