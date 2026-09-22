import { METHOD_AI_CANCEL, METHOD_AI_RUN } from './extensionApiMethods'
import { NOTICE_AI_TEXT } from './rpc'
import { requireString } from './serviceParse'
import { requireEnabled, resolveProject } from './uiDispatch'

// 자식이 부른 `code.ai.run`·`ai.cancel` 을 받는다. `serviceDispatch.ts` 의 두 갈래가 여기로 온다 —
// 저쪽이 300줄 상한에 붙어 있고, 프로젝트 규칙을 웹뷰와 **한 벌로** 나눠 써야 해서다 (`resolveProject`).
//
// 여기는 **opencode 를 모른다.** 세션을 만들고 스트림을 읽는 것은 포트 뒤(`electron/opencode/extensionRun.ts`)다.

/** `ai.run` 한 번. `runId` 는 자식이 지은 것이다 — 끊을 때와 글 조각을 돌려보낼 때 이것으로 찾는다 */
export interface AiRunRequest {
  extension: string
  projectId: string
  runId: string
  prompt: string
}

/** 확장 호스트가 보는 AI 표면 (구현: `ExtensionAiRuns`) */
export interface ExtensionAiPort {
  /** 끝나면 모은 글. 끊겼으면 취소 사유로, 이미 도는 중이면 busy 사유로 거부된다 */
  run(request: AiRunRequest, onText: (text: string) => void): Promise<{ text: string }>
  /** 그 확장의 그 실행을 끊는다. 없거나 남의 것이면 아무 일도 안 한다 */
  cancel(extension: string, runId: string): void
}

/** 배선이 없을 때. 조용히 버리지 않고 사유를 준다 */
export const REFUSE_AI: ExtensionAiPort = {
  run: () => Promise.reject(new Error('AI 세션을 쓸 수 없는 호스트입니다 (배선 없음)')),
  cancel: () => {},
}

/**
 * 켜짐을 보고 → 돌린다. 겉봉은 **부르는 쪽이 한 번 읽은 값**이다 — 판정한 프로젝트와 묻는 프로젝트가
 * 같아야 한다 (하이닉스 H2 결정 K-4, `uiDispatch.ts` 의 `dispatchUiEnabled` 와 같은 자리).
 * 취소는 막지 않는다 — 켜짐이 바뀐 뒤에도 이미 도는 것은 끊을 수 있어야 한다.
 */
export async function dispatchAiEnabled(
  port: ExtensionAiPort,
  method: typeof METHOD_AI_RUN | typeof METHOD_AI_CANCEL,
  params: Record<string, unknown>,
  envelope: string | null,
  notifyChild: (method: string, params: unknown) => void,
  allowedIn: (projectId: string) => Promise<readonly string[] | undefined>,
): Promise<unknown> {
  if (method === METHOD_AI_RUN) await requireEnabled(method, params, envelope, allowedIn)
  return dispatchAi(port, method, params, envelope, notifyChild)
}

/**
 * @param envelope 지금 도는 일의 프로젝트 (`ProjectEnvelope.current`). 없거나 겹치면 null.
 * @param notifyChild 글 조각을 자식에게 내린다. **확장이 `onText` 를 줬을 때만** 쓴다 (`stream`).
 */
export function dispatchAi(
  port: ExtensionAiPort,
  method: typeof METHOD_AI_RUN | typeof METHOD_AI_CANCEL,
  params: Record<string, unknown>,
  envelope: string | null,
  notifyChild: (method: string, params: unknown) => void,
): unknown {
  const extension = requireString(params['extension'], 'extension')
  const runId = requireString(params['runId'], 'runId')
  if (method === METHOD_AI_CANCEL) return port.cancel(extension, runId)
  // **활성 프로젝트로 되돌아가지 않는다** — 사용자가 탭을 옮긴 사이 남의 프로젝트 세션에 묻게 된다
  const projectId = resolveProject(method, params, envelope)
  const prompt = requireString(params['prompt'], 'prompt')
  const onText =
    params['stream'] === true ? (text: string) => notifyChild(NOTICE_AI_TEXT, { runId, text }) : () => {}
  return port.run({ extension, projectId, runId, prompt }, onText)
}
