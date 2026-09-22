import {
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_READ_FILE,
  METHOD_STORAGE_GET,
  METHOD_STORAGE_SET,
} from './extensionApiMethods'
import { requireString } from './serviceParse'
import { requireEnabled, resolveProject } from './uiDispatch'
import type { DispatchDeps } from './serviceDispatch'

// `code.workspace.*`·`code.storage.*` 의 **어느 프로젝트인가** (G-1·G-2, 2026-09-22).
// `serviceDispatch.ts` 에서 갈라 왔다 — 저쪽이 300줄 상한에 붙어 있고, 둘이 같은 물음에 답한다.
//
// 규칙은 웹뷰·AI 와 **한 벌**이다 (`uiDispatch.ts` 의 `resolveProject`): 확장이 적은 `projectId` →
// 겉봉(명령·`onMessage` 처리기가 건 프로젝트), 둘 다 없으면 **던진다.** 화면에 떠 있는 프로젝트로
// 되돌아가지 않는다 — 핸들러가 P 를 위해 도는 중에 사용자가 Q 로 옮기면 Q 를 읽고 Q 에 쓴다.
//
// 겉봉은 **한 번만 읽는다.** 켜짐 판정(await)과 실제 호출 사이에 겉봉이 바뀌면 판정한 프로젝트와
// 읽는 프로젝트가 갈린다.

export type WorkspaceMethod =
  | typeof METHOD_GET_PROJECT_PATH
  | typeof METHOD_LIST_FILES
  | typeof METHOD_READ_FILE
  | typeof METHOD_STORAGE_GET
  | typeof METHOD_STORAGE_SET

export async function dispatchWorkspace(
  deps: DispatchDeps,
  method: WorkspaceMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  const envelope = deps.projectId()
  if (method === METHOD_STORAGE_GET || method === METHOD_STORAGE_SET) {
    const extension = requireString(params['extension'], 'extension')
    const project = await storageProject(deps, method, params, envelope)
    const key = requireString(params['key'], 'key')
    // `value` 는 검사하지 않는다 — 확장이 무엇을 넣든 그대로 돌려주는 것이 계약이다.
    // 넣을 수 없는 값(함수 등)은 구조화 복제가 RPC 경계에서 이미 거른다.
    return method === METHOD_STORAGE_GET
      ? deps.storage.get(extension, project, key)
      : deps.storage.set(extension, project, key, params['value'])
  }

  await requireEnabled(method, params, envelope, deps.allowedIn)
  const projectId = resolveProject(method, params, envelope)
  switch (method) {
    case METHOD_GET_PROJECT_PATH:
      return deps.workspace.getProjectPath(projectId)
    // `{files, truncated}` 를 그대로 보낸다. 확장에게 목록만 주면 **잘렸다는 사실이
    // 여기서 사라진다** — 자기 이름을 아는 자식 쪽(`extensionApi`)이 그걸 받아 알린다
    case METHOD_LIST_FILES:
      return deps.workspace.listFiles(projectId, requireString(params['glob'], 'glob'))
    case METHOD_READ_FILE:
      return deps.workspace.readFile(projectId, requireString(params['path'], 'path'))
  }
}

/**
 * 저장소 칸의 프로젝트.
 *
 * **3판만 새 규칙이다 (G-2).** 예전에는 명시 `projectId` 를 못 받았고, 겉봉이 없으면(타이머·`activate`·
 * 겹친 핸들러) 활성 프로젝트로, 그것도 없으면 공용 「프로젝트 없음」 칸에 **조용히** 읽고 썼다
 * (`hostPorts.ts` 의 `activeWhenUnknown`). 3판은 적은 `projectId` → 겉봉, 둘 다 없으면 던진다.
 *
 * **2판은 그대로 둔다** — 우리 확장 둘이 2판이고 6단계에서 옛 API 와 함께 사라진다. 매니페스트를
 * 모르는 이름도 옛 규칙으로 간다 (훑기에 없는 확장은 실려 있지 않다 — 이 호출이 올 수 없는 자리다).
 */
async function storageProject(
  deps: DispatchDeps,
  method: string,
  params: Record<string, unknown>,
  envelope: string | null,
): Promise<string | null> {
  const manifest = await deps.manifestOf(requireString(params['extension'], 'extension'))
  if (manifest !== undefined && manifest.manifestVersion >= 3) return resolveProject(method, params, envelope)
  return envelope
}
