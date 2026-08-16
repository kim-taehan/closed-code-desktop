import type { OpencodeMessage, OpencodeSession } from './historyApi'

// **말 한 번 안 걸린 세션**을 가려낸다 (`chatHistory.ts` 의 목록 번역이 쓴다).
//
// 왜 필요한가: 어댑터는 **핸드셰이크마다 세션을 하나 만든다** (`workspace.ts`). 앱을 켜거나
// 다시 붙기만 해도 대화가 하나 생기고, 아무 말도 안 걸면 제목이 `New session - <ISO>` 인 채로
// 목록에 남는다. 목록이 그것으로 도배되면 진짜 대화를 눈으로 못 찾는다.
//
// **규모는 짐작이 아니다**: 저장소 전수로 세션 2550건 중 **2289건(90%)이 메시지 0건**이다
// (분포는 아래 `looksEmpty`). 여기는 이미 생긴 것을 접을 뿐 **새로 생기는 것을 막지 않는다** —
// 근원을 막으려면 `workspace.ts` 의 세션 생성을 첫 프롬프트까지 미뤄야 하는데, 그 자리는
// 「첫 질문이 버려진 세션으로 나가는」 결함이 났던 곳이다 (`chatHistory.ts` 의 addChat 주석).
//
// ⚠️ **`tokens` 로는 못 거른다.** `tokens.input === 0` 인데 메시지가 있는 세션이 실재한다
// (사용자 서버 실측: 메시지 3건에 `tokens.input=0`). 여기에 tokens 를 쓰면 **진짜 대화가
// 빈 것으로 찍힌다.**
//
// 그래서 **세는 것 말고는 방법이 없다** — 세션마다 `GET /session/:id/message` 를 한 번 더
// 부르는 N+1 이다. 다만 전부 부르지는 않는다: 아래 `looksEmpty` 가 **후보를 좁히고**,
// 후보만 실제로 세어 확인한다.
//
// **후보 판정은 결론이 아니다.** 이 파일의 계약은 한 방향으로만 센다:
//
//   후보 아님 → 확인을 **건너뛴다**. 절대 「빈 대화」로 찍지 않는다 (거짓 딱지가 안 붙는다)
//   후보     → **반드시 세어 본다**. 0건이 실제로 확인된 것만 「빈 대화」다
//
// 이 비대칭이 중요한 이유는 후보 판정이 틀릴 수 있어서다. `time.updated` 는 메시지 없이도
// 움직인다 — **`POST /api/session/:id/model`·`/agent` 가 올린다** (실측: 각각 +666ms·+754ms,
// 메시지는 0건). 우리 어댑터도 그 둘을 부른다(`models.ts`·`agents.ts`). 그때 생기는 어긋남은
// "빈 대화인데 목록에 그냥 보인다" 쪽이라 사용자가 잃는 것이 없다. 반대 방향이면
// **진짜 대화가 숨는다.**
//
// 제목 패턴(`New session - `)으로 가르지 않는다. 사용자가 그 제목 그대로 둔 진짜 대화가
// 있을 수 있고, 그건 **판정이 아니라 짐작**이다.

/**
 * 셀 만한 후보인가. `time.updated === time.created` 이면 만들어진 뒤 아무 일도 없었던 것이다.
 *
 * **저장소 전수로 쟀다** (2026-08-16, 1.18.18 — `~/.local/share/opencode/opencode.db` 를
 * 읽기 전용으로, **세션 2550건**):
 *
 *   delta=0 · 메시지 0건   2289    ← 접히는 것들
 *   delta>0 · 메시지 있음   213    ← 안 접힌다 (맞다)
 *   delta>0 · 메시지 0건     48    ← 안 접힌다 (껍데기인데 보인다 — 안전한 쪽 어긋남)
 *   **delta=0 · 메시지 있음   0**  ← 진짜 대화가 접히는 경우. 이 저장소에는 없다
 *
 * ⚠️ **마지막 줄을 "그러니 세지 말고 시각만 보자" 로 읽지 말 것. 반례가 실재한다.**
 * 옆 저장소(`opencode-local.db`, 지금 서버가 안 쓰는 옛것)에 이런 세션이 있다 —
 * contract-qa 가 찾았고 나도 다시 확인했다:
 *
 *   ses_203ceefa5ffeuY0eTackOMPfkW   delta=0 인데 **메시지 2건** (user 1 · assistant 1)
 *   메시지는 세션 생성 **+15ms·+17ms** 에 들어왔는데 `time_updated` 가 끝내 안 움직였다
 *
 * 그래서 시각은 **후보를 좁히는 데만** 쓰고 접는 것은 센 결과로만 정한다. 이 세션도
 * 후보로는 잡히지만 세어 보면 2건이라 안 접힌다 — **세는 단계가 이 기능을 지탱하는
 * 다리다.** 그 단계를 최적화로 걷어내면 그날 진짜 대화가 사라진다.
 *
 * 여유도 넉넉하지 않다: 메시지가 있는 213건의 delta 최솟값이 **2ms** 다(최상위·비보관으로
 * 좁히면 23ms). 규칙이 서 있는 것은 0이 아니라서지 여유가 있어서가 아니다.
 * 위 48건은 47건이 `agent`/`model` 이 박혀 있다 — `setModel`·`setAgent` 가 메시지 없이
 * `updated` 를 올린 자국이고(실측 +666ms·+754ms), 우리 어댑터도 그 둘을 부른다.
 *
 * DB 로 센 것이 HTTP 로 보는 것과 같은지도 확인했다 — 세션 24건(빈 것 12 · 대화 12,
 * 최대 302 메시지)을 `GET /session/:id/message` 로 다시 세어 **24/24 일치**.
 *
 * 갓 만든 세션은 delta 0 이고, **제목 PATCH 는 delta 를 안 올린다** (0 그대로 — 실측).
 * 시각이 아예 없는 세션은 후보로 본다 — 어차피 아래에서 세어 확인한다.
 */
function looksEmpty(session: OpencodeSession): boolean {
  return (session.time?.updated ?? 0) === (session.time?.created ?? 0)
}

/**
 * 한 번에 띄우는 조회 수.
 *
 * ⚠️ **세는 단계를 줄이는 것이 아니다** — 후보는 여전히 **전부** 세어 본다 (안 그러면
 * `looksEmpty` 의 ⚠️ 절이 말하는 반례에서 진짜 대화가 사라진다). 동시에 띄우는 수만 묶는다.
 *
 * 상한이 없으면 후보 수만큼 한꺼번에 나갔다. 실측 규모가 그걸 정당화하지 않는다:
 * 세션 2550건 중 **후보가 2289건**이었다(위 분포) — 대화 목록을 한 번 여는 데 fetch 2289개가
 * 한 프레임에 뜬다. 증상은 "목록이 안 뜬다" 이고, 원인이 목록 코드가 아니라 여기다.
 *
 * 8 인 근거는 계측이 아니라 **자리**다: 이 조회는 목록을 그리는 길목이라 한 줄씩 하면
 * 2289번 왕복이 되고(느려서 못 쓴다), 동시에 사용자가 아무것도 안 눌렀는데 나가는 요청이라
 * 서버를 두들길 자격도 없다. 재서 고칠 값이면 여기만 고치면 된다.
 */
const MAX_INFLIGHT = 8

/**
 * 메시지가 **0건인 것이 확인된** 세션 id 들.
 *
 * 조회가 실패하면 그 세션은 빼고 넘어간다 — 못 셌다는 이유로 「빈 대화」 딱지를 붙이면,
 * 서버가 잠깐 흔들린 것만으로 진짜 대화가 목록에서 접힌다.
 */
export async function verifyEmptyChats(
  sessions: OpencodeSession[],
  fetchMessages: (sessionId: string) => Promise<OpencodeMessage[]>,
): Promise<Set<string>> {
  const candidates = sessions
    .filter(looksEmpty)
    .map((session) => session.id)
    .filter((id): id is string => typeof id === 'string' && id !== '')

  const empty = new Set<string>()
  let next = 0

  // 일꾼 여럿이 **같은 줄에서 하나씩** 집어 간다. 후보를 미리 토막으로 쪼개 나누지 않는
  // 이유: 세션마다 메시지 수가 크게 달라(최대 302건 실측) 토막마다 걸리는 시간이 갈리고,
  // 그러면 빠른 토막이 끝난 뒤 놀게 된다.
  const worker = async (): Promise<void> => {
    for (let id = candidates[next++]; id !== undefined; id = candidates[next++]) {
      try {
        if ((await fetchMessages(id)).length === 0) empty.add(id)
      } catch {
        // 못 셌다 — 빼고 넘어간다 (위 주석). 「빈 대화」로는 절대 안 찍는다.
      }
    }
  }

  const workers = Math.min(MAX_INFLIGHT, candidates.length)
  await Promise.all(Array.from({ length: workers }, worker))
  return empty
}
