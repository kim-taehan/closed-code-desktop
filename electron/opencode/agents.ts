import { PermissionMode } from '../../shared/protocol/kinds'
import type { OpencodeClient } from './client'

// 권한 모드 → opencode 에이전트 (ADR-011 §4 ↔ opencode primary agent).
//
// davis 는 세 모드를 런타임에 보냈고 런타임이 도구 승인 규칙을 갈아 끼웠다.
// opencode 에는 그런 전역 모드가 없다 — 대신 **에이전트**가 그 자리를 맡는다.
// 실측(1.17.18, `GET /agent`)으로 확인한 primary·비hidden 에이전트는 둘뿐이다:
//
//   build — "The default agent. Executes tools based on configured permissions."
//   plan  — "Plan mode. Disallows all edit tools."
//
// 뜻이 davis 의 default·plan 과 그대로 겹친다. **acceptEdits(편집 도구 자동 승인)는
// 대응이 없다** — opencode 에서 그건 에이전트가 아니라 서버 설정 파일의 permission 규칙이라
// 데스크탑이 세션 단위로 켤 수 없다. 그래서 모드 목록에서 아예 뺐다
// (`shared/protocol/kinds.ts` — 고를 수 없는 것을 보여주지 않는다).
//
// ⚠️ **opencode 는 없는 에이전트 이름도 204 로 받아 세션에 그대로 저장한다** (실측).
// 검증해 주지 않으므로 아는 이름만 보낸다 — 오타 하나로 세션이 존재하지 않는 에이전트를
// 물고 돌게 되고, 증상은 한참 뒤 턴이 이상하게 도는 것으로만 나타난다.

const AGENT_OF: Record<PermissionMode, string> = {
  [PermissionMode.DEFAULT]: 'build',
  [PermissionMode.PLAN]: 'plan',
}

/** 아는 모드인가. 프레임으로 들어온 값이라 믿지 않고 좁힌다. */
function isMode(value: unknown): value is PermissionMode {
  return value === PermissionMode.DEFAULT || value === PermissionMode.PLAN
}

/**
 * 요청한 모드를 세션에 건다. **실제로 걸린 모드를 돌려준다.**
 *
 * 모르는 모드면 아무것도 보내지 않고 `current` 를 그대로 돌려준다 — 부르는 쪽이 그 값을
 * `permission_mode_changed` 로 되돌려 보내므로, 화면이 낙관적으로 바꿔 둔 토글이
 * 원래 자리로 정정된다 (`session/permissionMode.ts` 의 확정 경로). 조용히 성공한 척하면
 * **plan 인 줄 알고 편집을 맡기는** 상황이 생긴다 — 그게 이 함수가 있는 이유다.
 */
export async function applyPermissionMode(
  client: Pick<OpencodeClient, 'setAgent'>,
  sessionId: string,
  requested: unknown,
  current: PermissionMode,
): Promise<PermissionMode> {
  if (!isMode(requested)) return current
  await client.setAgent(sessionId, AGENT_OF[requested])
  return requested
}
