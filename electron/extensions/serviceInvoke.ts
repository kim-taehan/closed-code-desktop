import { METHOD_ACTIVE_FILE, METHOD_REDRAW, METHOD_RUN_COMMAND } from './rpc'

// **부모 → 자식으로 거는 세 가지.** `service.ts` 에서 뽑아 왔다 — 저쪽이 300줄 상한에 닿았고,
// 이 셋은 하나의 관심사다: 확장에 **일을 시키고**, 도는 동안 **프로젝트 겉봉을 씌운다**.
//
// 나머지(훑기·싣기·자식이 부른 code.* 응대)와 흐름이 반대라 갈라 두면 읽기도 쉽다.
//
// **셋을 하나로 합치지 않는다.** 「명령을 걸어라」·「다시 그려라」·「보는 것이 바뀌었다」는
// 서로 다른 사실이고, 섞으면 확장이 **왜 불렸는지 모른 채** 매번 전부 다시 그린다
// (사유는 `rpc.ts` 의 `METHOD_ACTIVE_FILE` 머리말).

export interface InvokeDeps {
  /** 자식에 요청을 걸고 답을 기다린다 (`ExtensionHost.request`). */
  request(method: string, params?: unknown): Promise<unknown>
  /** 도는 동안 프로젝트 겉봉을 세운다 (`ProjectEnvelope.during`). */
  during<T>(projectId: string | null, work: () => Promise<T>): Promise<T>
}

export interface Invoker {
  runCommand(
    commandId: string,
    projectId: string | null,
    selection?: unknown,
    extension?: string,
  ): Promise<void>
  redraw(projectId: string | null): Promise<void>
  activeFileChanged(file: unknown, projectId: string | null): Promise<void>
}

/**
 * `projectId` 는 셋 다 **일을 건 프로젝트**다. 그 사이에 올라온 결과 행이 이 겉봉을 달고
 * 나가므로, 명령이 도는 동안 사용자가 탭을 옮겨도 결과는 건 탭으로 간다.
 * 열린 프로젝트가 없으면 `null`.
 */
export function createInvoker(deps: InvokeDeps): Invoker {
  return {
    /**
     * 확장 명령 하나를 실행한다. 없는 명령·죽은 호스트는 거부된다.
     *
     * `selection` 은 **사용자가 화면에서 고른 것**이다 (트리 체크박스·목록 선택).
     * `extension` 은 **확장 화면에서 온 명령의 주인**이고, 있으면 자식이 명령표의 주인과
     * 대조해 남의 명령을 거부한다 (없으면 종전대로 확인 없이 돈다).
     */
    async runCommand(commandId, projectId, selection, extension) {
      await deps.during(projectId, () =>
        deps.request(METHOD_RUN_COMMAND, { commandId, selection, extension }),
      )
    },

    /**
     * **저장된 것을 지금 프로젝트 기준으로 다시 그리게 한다.**
     *
     * 확장의 `activate` 는 앱이 뜰 때 한 번만 돈다 — 그때 그린 것은 그 순간의 활성 프로젝트
     * 것이고, 사용자가 탭을 옮기면 화면은 비워지는데(`useExtensionTree`) 다시 채울 사람이 없다.
     * 게다가 그 한 번은 **화면이 붙기 전에** 끝날 수 있고 밀어 넣기는 재생되지 않는다.
     * 그래서 화면이 붙은 뒤에 화면이 요청한다 (`rpc.ts` 의 `METHOD_REDRAW`).
     */
    async redraw(projectId) {
      await deps.during(projectId, () => deps.request(METHOD_REDRAW, {}))
    },

    /**
     * **보고 있는 파일이 바뀌었다**고 확장 **전부에** 뿌린다. 누가 쓰는지는 모른다 —
     * `setHtml` 이 「어느 확장인지 모른다」로 도는 것과 같다.
     *
     * `file` 은 `{ path, line? }` 또는 **`null`(아무것도 안 보고 있다)** 이다. 여기서
     * 모양을 다시 보지 않는다 — 렌더러가 보낸 것을 `extensionActiveFile.ts` 가 이미 걸렀다.
     *
     * ponytail: 자식(`childHandlers.ts`)에 **같은 검사가 한 벌 더** 있다. 프로세스 경계라
     * 다시 거르는 것이 옳고, 자식은 electron 을 못 물어(`rpc.ts` 머리말) 이쪽 함수를
     * 가져다 쓸 수도 없다. 규칙(빈 경로 → null)을 고칠 때는 **두 곳을 같이** 고친다.
     */
    async activeFileChanged(file, projectId) {
      await deps.during(projectId, () => deps.request(METHOD_ACTIVE_FILE, { file }))
    },
  }
}
