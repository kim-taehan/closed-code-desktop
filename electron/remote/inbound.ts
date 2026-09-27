import type { InboundCommand, RejectCode } from './frames'

// 휴대폰이 보낸 바이트 → 명령 하나. `mobile/protocol/PROTOCOL.md` §4-2 의 **허용 목록**을 잠그는 자리다.
//
// ## 기본 거부다
//
// 아는 것만 통과하고 나머지는 전부 `not_allowed` 로 거절한다 — **무시하지 않는다** (§4 마지막 줄:
// 「모르는 `t` 는 무시하지 않고 거절한다」). 무시하면 휴대폰이 보낸 것이 먹혔는지 모른 채 기다린다.
//
// 막는 목록(§4-3: `SHELL_RUN`·`PERMISSION_MODE_SET`·`HISTORY_REMOVE`·서버 제어 …)을 여기에 적지
// **않는다.** 적으면 새 채널이 생길 때마다 이 파일을 따라 고쳐야 하고, 한 번 빠뜨리면 열린다.
// 여집합을 세지 않는 것이 fail-closed 다.
//
// ## 오배송을 만들지 않는다
//
// 계획 §4 가 짚은 구멍: desktop 의 명령 길은 전부 **활성 탭**(`sessionHandlers.ts` 의 `active()`)으로
// 간다. 그 길에 원격을 태우면 데스크탑 사용자가 탭을 옮긴 순간 휴대폰의 메시지가 다른 프로젝트로
// 간다. 그래서 프로젝트 소속 명령은 겉봉의 `projectId` 를 **필수**로 요구하고, 이 파일에서
// 나가는 명령에는 「활성」이라는 개념이 아예 없다 (P2 가 세션을 찾을 때 쓸 값이 겉봉뿐이게 한다).

export type ParsedInbound =
  | { ok: true; command: InboundCommand }
  | { ok: false; code: RejectCode; message: string; id?: string; projectId?: string }

/**
 * §4-2 허용 목록에 **있는데** 아직 안 연 것들. 여기 있는 것만 `not_yet` 으로 답한다 —
 * 이 집합은 **문서의 목록에서 P1 셋을 뺀 것**이고, 단계가 열릴 때 그 항목을 지운다.
 *
 * ⚠️ 이것은 §4-3 의 「막는 목록」이 아니다. 저쪽은 **적지 않는다** (머리말) — 여집합을 세면
 * 빠뜨린다. 이 집합에 없는 모르는 `t` 는 그대로 `not_allowed` 로 떨어진다 (fail-closed).
 */
const NOT_YET = new Set(['chat.send', 'cancel', 'approval.respond', 'question.respond', 'plan.respond'])

/** 명령 상관 id 상한 (`schema/inbound.schema.json` commandId) */
const MAX_ID_CHARS = 64
const MAX_DEVICE_NAME_CHARS = 64

export function parseInbound(message: Uint8Array): ParsedInbound {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message))
  } catch {
    return bad('JSON 이 아닙니다')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('객체가 아닙니다')
  const frame = raw as Record<string, unknown>

  // 판이 다르면 휴대폰이 명령을 보내지 않기로 돼 있다 (§5) — 그래도 오면 거절한다
  if (frame['v'] !== 0) return bad(`판이 다릅니다: ${String(frame['v'])}`)
  const t = frame['t']
  if (typeof t !== 'string') return bad('t 가 없습니다')

  const id = frame['id']
  // **모든 명령은 id 를 싣는다** (§4-2). 없으면 `reject` 에 실을 상관 id 도 없다
  if (typeof id !== 'string' || id === '' || id.length > MAX_ID_CHARS) {
    return { ok: false, code: 'bad_frame', message: 'id 가 없거나 모양이 틀렸습니다' }
  }
  const projectId = typeof frame['projectId'] === 'string' ? frame['projectId'] : undefined
  const payload =
    frame['p'] === undefined ? {} : (frame['p'] as Record<string, unknown> | null) ?? undefined
  if (payload === undefined || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'bad_frame', message: 'p 가 객체가 아닙니다', id, ...scope(projectId) }
  }

  switch (t) {
    case 'hello':
      return hello(id, payload, projectId)
    case 'subscribe':
      return subscribe(id, payload, projectId)
    case 'sync':
      if (projectId === undefined) {
        return { ok: false, code: 'bad_frame', message: 'sync 에 projectId 가 없습니다', id }
      }
      return { ok: true, command: { t: 'sync', id, projectId } }
    default:
      // **열린 척하지 않는다.** 다만 「영구히 없는 것」과 「아직 안 연 단계」를 가른다 (§4-2 거절 코드) —
      // 휴대폰이 `not_allowed` 를 받으면 그 화면을 지워도 되지만, `not_yet` 이면 **나중에 열리므로
      // 지우면 안 된다.** 둘을 같은 코드로 답하면 P2·P3 가 열릴 때 앱이 되살려야 한다.
      return NOT_YET.has(t)
        ? {
            ok: false,
            code: 'not_yet',
            message: `아직 열리지 않은 단계입니다: ${t}`,
            id,
            ...scope(projectId),
          }
        : {
            ok: false,
            code: 'not_allowed',
            message: `허용 목록에 없습니다: ${t}`,
            id,
            ...scope(projectId),
          }
  }
}

function hello(
  id: string,
  payload: Record<string, unknown>,
  projectId: string | undefined,
): ParsedInbound {
  const name = payload['deviceName']
  if (payload['protocol'] !== 0) {
    return { ok: false, code: 'bad_frame', message: 'protocol 이 0 이 아닙니다', id, ...scope(projectId) }
  }
  if (typeof name !== 'string' || name === '' || name.length > MAX_DEVICE_NAME_CHARS) {
    return { ok: false, code: 'bad_frame', message: 'deviceName 이 없습니다', id, ...scope(projectId) }
  }
  return { ok: true, command: { t: 'hello', id, p: { protocol: 0, deviceName: name } } }
}

function subscribe(
  id: string,
  payload: Record<string, unknown>,
  projectId: string | undefined,
): ParsedInbound {
  const ids = payload['projectIds']
  if (!Array.isArray(ids) || ids.some((value) => typeof value !== 'string' || value === '')) {
    return { ok: false, code: 'bad_frame', message: 'projectIds 가 없습니다', id, ...scope(projectId) }
  }
  // 빈 배열은 「아무것도 안 받음」이다 (§4-2) — 오류가 아니다
  return { ok: true, command: { t: 'subscribe', id, p: { projectIds: [...new Set(ids as string[])] } } }
}

function scope(projectId: string | undefined): { projectId?: string } {
  return projectId === undefined ? {} : { projectId }
}

/** 겉봉조차 못 읽었다 — 상관 id 가 없으니 `reject` 에도 안 싣는다 (§4-1 `reject` 의 `id` 는 선택) */
function bad(message: string): ParsedInbound {
  return { ok: false, code: 'bad_frame', message }
}
