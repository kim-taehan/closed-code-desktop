import { checkUiMessage } from '../../shared/extensions/uiMessage'
import { METHOD_UI_OPEN, METHOD_UI_POST } from './extensionApiMethods'
import { requireString } from './serviceParse'
import type { UiPorts } from './uiRouter'

// 자식이 부른 `code.ui.post`·`code.ui.open` 을 받는다. `serviceDispatch.ts` 의 두 갈래가 여기로 온다 —
// 저쪽이 300줄 상한에 붙어 있고, 두 갈래가 **같은 프로젝트 규칙**을 나눠 써서 한곳에 뒀다.

/** 웹뷰 포트를 배선하지 않았을 때. 조용히 버리지 않고 사유를 준다 */
export const REFUSE_UI: UiPorts = {
  post: () => {
    throw new Error('웹뷰 탭을 다룰 수 없는 호스트입니다 (배선 없음)')
  },
  open: () => Promise.reject(new Error('웹뷰 탭을 다룰 수 없는 호스트입니다 (배선 없음)')),
}

/**
 * @param envelope 지금 도는 일의 프로젝트 (`ProjectEnvelope.current`). 없거나 겹치면 null.
 *
 * **프로젝트는 겉봉이 먼저가 아니라 확장이 적은 것이 먼저다.** 확장은 `onMessage` 로 받은
 * `projectId` 를 그대로 돌려줄 때만 적는다 — 그것은 겉봉보다 정확하다 (겉봉은 서로 다른
 * 프로젝트의 일이 겹치면 null 이 된다, `projectEnvelope.ts` 의 ponytail).
 *
 * 둘 다 없으면 **던진다.** 활성 프로젝트로 되돌아가지 않는다 (E3) — 사용자가 탭을 옮긴 사이
 * 남의 프로젝트 탭에 뜬다. 확장은 사유를 받고 `target.projectId` 를 적으면 된다.
 */
export function dispatchUi(
  ports: UiPorts,
  method: typeof METHOD_UI_POST | typeof METHOD_UI_OPEN,
  params: Record<string, unknown>,
  envelope: string | null,
): unknown {
  const extension = requireString(params['extension'], 'extension')
  const viewId = requireString(params['viewId'], 'viewId')
  const named = params['projectId']
  const projectId = typeof named === 'string' && named !== '' ? named : envelope
  if (projectId === null) {
    throw new Error(`${method}: 어느 프로젝트의 탭인지 모릅니다 — 명령·onMessage 안에서 부르거나 projectId 를 적으세요`)
  }
  if (method === METHOD_UI_OPEN) return ports.open(extension, viewId, projectId)
  // 자식도 보내기 전에 봤다. **프로세스 경계라 다시 본다** — 자식은 확장 코드와 한 프로세스다
  const checked = checkUiMessage(params['message'])
  if (!checked.ok) throw new Error(`${method}: ${checked.reason}`)
  return ports.post(extension, viewId, params['message'], projectId)
}
