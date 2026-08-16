import type { OpencodeMessage, OpencodeSession } from './historyApi'

// **말 한 번 안 걸린 세션**을 가려낸다 (`chatHistory.ts` 의 목록 번역이 쓴다).
//
// 왜 필요한가: 어댑터는 **핸드셰이크마다 세션을 하나 만든다** (`workspace.ts`). 앱을 켜거나
// 다시 붙기만 해도 대화가 하나 생기고, 아무 말도 안 걸면 제목이 `New session - <ISO>` 인 채로
// 목록에 남는다. 실측: 한 프로젝트에서 **32건 중 26건**이 그런 껍데기였다. 목록이 그것으로
// 도배되면 진짜 대화를 눈으로 못 찾는다.
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
 * 실측 근거 (2026-08-16, 1.18.18):
 *
 *   사용자 서버 8건 — 메시지 있는 4건은 delta 가 147273~1910158ms, 없는 4건은 **전부 0**
 *   갓 만든 세션은 delta 0 이고, **제목 PATCH 는 delta 를 안 올린다** (0 그대로)
 *
 * 시각이 아예 없는 세션은 후보로 본다 — 어차피 아래에서 세어 확인한다.
 */
function looksEmpty(session: OpencodeSession): boolean {
  return (session.time?.updated ?? 0) === (session.time?.created ?? 0)
}

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

  const counted = await Promise.all(
    candidates.map(async (id) => {
      try {
        return (await fetchMessages(id)).length === 0 ? id : null
      } catch {
        return null
      }
    }),
  )
  return new Set(counted.filter((id): id is string => id !== null))
}
