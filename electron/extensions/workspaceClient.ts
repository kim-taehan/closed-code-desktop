import {
  METHOD_ACTIVE_FILE,
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_PROGRESS,
  METHOD_READ_FILE,
} from './extensionApiMethods'
import { asActiveFile, asString, asStrings, type ActiveFile } from './extensionApiParse'
import type { RpcCall } from './extensionApi'

// 확장이 받는 `code.workspace` — 자식(확장 호스트) 쪽 대리자.
//
// `extensionApi.ts` 에서 갈라 왔다 — 저쪽이 300줄 상한에 붙었고, G-1(2026-09-22)로 세 메서드가
// 모두 **확장 이름과 선택 `projectId`** 를 싣게 되면서 모양이 `ui`·`ai` 대리자 쪽으로 옮겨 왔다.
// 이름은 부모가 켜짐을 판정하는 데 쓴다 (`workspaceDispatch.ts` → `requireEnabled`).
//
// **electron 을 import 하지 않는다** — 자식에서 돈다 (`rpc.ts` 머리말).

/** 겉봉이 없는 자리(타이머·`activate`·겹친 일)에서 프로젝트를 직접 적을 때만 — `ui.post` 의 `target` 과 같다 */
export interface ProjectTarget {
  projectId: string
}

export interface ExtensionWorkspaceApi {
  getProjectPath(target?: ProjectTarget): Promise<string>
  listFiles(glob: string, target?: ProjectTarget): Promise<string[]>
  readFile(relativePath: string, target?: ProjectTarget): Promise<string>
  /** 지금 보고 있는 파일. 없으면 `null` — **빈 객체를 만들지 않는다.** */
  activeFile(): Promise<ActiveFile | null>
}

/**
 * `target` 에서 **`projectId` 만** 꺼낸다. 나머지 키는 버린다 — 펼치면 확장이 `target` 에 `extension` 을
 * 실어 이 쪽이 채운 값을 덮는다 (`extensionApi.ts` 의 `ui.post` 주석, 계약 대조 2026-09-22 실측).
 */
export function projectOf(target: ProjectTarget | undefined): { projectId?: unknown } {
  return target === undefined ? {} : { projectId: target.projectId }
}

export function createWorkspaceApi(call: RpcCall, extensionName: string): ExtensionWorkspaceApi {
  // `extension` 을 여기서 채운다 (`storage` 와 같은 규칙) — 확장이 실어 보내면 남의 켜짐으로 읽는다
  const scoped = (target: ProjectTarget | undefined) => ({ ...projectOf(target), extension: extensionName })
  return {
    getProjectPath: async (target) =>
      asString(await call(METHOD_GET_PROJECT_PATH, scoped(target)), METHOD_GET_PROJECT_PATH),
    /**
     * **확장에게는 예전과 똑같이 `string[]` 만 준다.** 달라진 것은 잘렸을 때
     * 진행 줄이 한 줄 나간다는 것뿐이라 확장 코드는 안 고쳐도 된다.
     *
     * 알리는 자리가 여기인 이유는 **이름** 때문이다 — 진행 줄에는 낸 확장 이름이
     * 있어야 하는데(`emitProgress`), 호스트는 `listFiles` 를 누가 불렀는지 모른다.
     */
    listFiles: async (glob, target) => {
      const answer = await call(METHOD_LIST_FILES, { ...scoped(target), glob })
      const listing = (answer ?? {}) as Record<string, unknown>
      const files = asStrings(listing['files'], METHOD_LIST_FILES)
      if (listing['truncated'] === true) {
        // 진행 줄과 같은 길로 나간다. **기다리지 않는다** — 알림이 실패해도 훑기는 끝났다
        void call(METHOD_PROGRESS, {
          extension: extensionName,
          text: `프로젝트가 커서 ${files.length}개까지만 훑었습니다 — 목록이 전부가 아닙니다`,
          kind: 'note',
        }).catch(() => {})
      }
      return files
    },
    readFile: async (relativePath, target) =>
      asString(await call(METHOD_READ_FILE, { ...scoped(target), path: relativePath }), METHOD_READ_FILE),
    activeFile: async () => asActiveFile(await call(METHOD_ACTIVE_FILE)),
  }
}
