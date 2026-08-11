import {
  METHOD_AGENT_ASK,
  METHOD_EXPORT_SAVE,
  METHOD_STORAGE_GET,
  METHOD_STORAGE_SET,
  METHOD_ACTIVE_FILE,
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_READ_FILE,
  METHOD_SET_HTML,
  METHOD_SET_ROWS,
  METHOD_PROGRESS,
  METHOD_SET_TREE,
  METHOD_UI_ASK_TEXT,
} from './davisApi'
import { asProgressKind, asProgressLanes, asRecord, requireString } from './serviceParse'
import type { ExtensionProgressPayload } from '../../shared/ipc/extensionPayloads'
import {
  REFUSE_STORAGE,
  refuseAsk,
  refuseAskText,
  refuseExport,
  type ExtensionAskText,
  type ExtensionExportFile,
} from './serviceRefuse'
import { NOTICE_AGENT_ACTIVITY, type RpcRequest } from './rpc'
import type { ExtensionWorkspace } from './workspaceApi'
import type { ExtensionStorage } from './storageStore'

// 자식이 부른 `davis.*` 를 대신 수행한다. `service.ts` 가 300줄 상한에 붙어 갈라냈다.
//
// **여기가 확장이 앱에 닿는 유일한 문이다.** 새 API 를 여는 자리이자, 열지 않기로 한 것
// (`net.fetch`·`secrets.*`)이 막히는 자리다 (표준 §4.2). 파일 접근 경계는 `workspace` 가 쥔다.
//
// 서비스가 아니라 이 함수가 던지면 `serve` 가 오류 응답으로 감싼다 —
// **답을 빠뜨리면 확장의 await 가 영원히 걸린다.**

/** 코드 어시스턴트에게 묻는다. 답 텍스트만 돌아온다 (`agentLane/askAgent.ts`). */
/**
 * 두 번째 인자는 **어느 프로젝트에 묻나**다. 저장소가 쓰는 프로젝트와 같아야 한다 —
 * 어긋나면 A 프로젝트의 목록을 B 워크스페이스에 물어보게 된다 (실측: 122개 중 42개 유실).
 */
/**
 * 세 번째 인자는 **답하는 도중의 활동**을 받을 자리다 (`agentLane/askAgent.ts` 의
 * `AgentActivity`). 안 쓰는 배선도 있어 선택이다 — 없으면 예전과 똑같이 결론만 온다.
 */
export type ExtensionAsk = (
  prompt: string,
  projectId: string | null,
  onActivity?: (activity: { kind: string; text: string }) => void,
) => Promise<string>

export interface DispatchDeps {
  workspace: ExtensionWorkspace
  exportFile: ExtensionExportFile
  ask: ExtensionAsk
  askText: ExtensionAskText
  storage: ExtensionStorage
  /** 행·화면이 어느 프로젝트 것인지. 도는 명령이 없거나 겹치면 null(모름) */
  projectId: () => string | null
  /**
   * 지금 편집기에서 보고 있는 파일. 아무것도 안 보고 있으면 null.
   *
   * 값의 주인은 **렌더러**다 (`src/state/editorContext.ts`). main 은 렌더러가 밀어 준
   * 마지막 값을 들고 있을 뿐이라, 배선이 빠지면 늘 null 이 된다 — 그 경우도
   * 「안 보고 있다」와 같은 답이 되므로 **화면이 조용히 비는 것을 조심해야 한다.**
   */
  activeFile: () => unknown
  emitRows: (viewId: string, rows: unknown[], projectId: string | null) => void
  emitHtml: (viewId: string, html: string, projectId: string | null) => void
  emitTree: (viewId: string, nodes: unknown[], projectId: string | null) => void
  /**
   * 진행 상황 한 줄. 뷰 id 가 없다 — 확장 하나에 한 줄이지 뷰마다 따로 두지 않는다.
   *
   * 대신 **낸 확장 이름**이 앞에 온다 (`emitRows` 의 `viewId` 자리). 없으면 화면이
   * 어느 바에 그릴지 가릴 수 없어 남의 문구가 지금 보는 확장에 찍힌다.
   */
  emitProgress: (payload: ExtensionProgressPayload, projectId: string | null) => void
  /**
   * 자식에게 **응답 없는 통지**를 보낸다 (`NOTICE_AGENT_ACTIVITY`).
   *
   * 응답으로 못 보내는 것들의 자리다 — 왕복 하나에 답이 여럿이면 `PendingRequests` 가
   * 깨진다. 지금 쓰는 곳은 어시스턴트 활동 하나뿐이다.
   */
  notifyChild: (method: string, params: unknown) => void
}

/**
 * 확장이 앱에 닿는 포트 전부. 선택인 것은 배선을 빠뜨렸을 때 거절 함수로 채워진다.
 *
 * `ExtensionServiceOptions` 가 이걸 그대로 물려받는다 — 두 군데에 같은 목록을 적어 두면
 * 포트를 하나 더할 때 한쪽만 고치게 되고, 그 확장은 **조용히 거절된 채로 돈다.**
 */
export interface DispatchPorts {
  /** 확장의 파일 접근. 프로젝트 밖은 여기서 막힌다. */
  workspace: ExtensionWorkspace
  /** 산출물 내보내기. 프로젝트 경계 밖이라 `workspace` 와 갈라 둔다 (`davisApi.ts` 머리말). */
  exportFile?: ExtensionExportFile
  /** 코드 어시스턴트에 묻는 통로. */
  ask?: ExtensionAsk
  /** 사람에게 묻는 통로. 확장이 사용자에게서 값을 받는 유일한 길이다. */
  askText?: ExtensionAskText
  /** 확장별·프로젝트별 저장소. */
  storage?: ExtensionStorage
  /**
   * 지금 보고 있는 파일. **배선을 안 하면 늘 null 이다.**
   *
   * 다른 포트는 안 열면 「거절」로 채워 확장이 사유를 받는데, 이건 그럴 수 없다 —
   * 「안 보고 있다」가 정상 답이라 거절과 구분이 안 된다. 그래서 **선택이지만 조용하다.**
   * 배선을 빠뜨리면 확장은 아무 불평 없이 빈 화면을 그린다.
   */
  activeFile?: () => unknown
}

/**
 * 서비스 옵션 + 그때그때의 겉봉을 합쳐 `DispatchDeps` 를 만든다.
 *
 * `service.ts` 에서 옮겨 왔다 — 저쪽이 300줄 상한에 닿았고, **"배선이 없으면 무엇으로
 * 대신하는가"** 는 이 파일의 관심사다(열지 않기로 한 것이 막히는 자리와 같은 자리다).
 */
export function portsOf(
  ports: DispatchPorts,
  envelope: Pick<
    DispatchDeps,
    'projectId' | 'emitRows' | 'emitHtml' | 'emitTree' | 'emitProgress' | 'notifyChild'
  >,
): DispatchDeps {
  return {
    workspace: ports.workspace,
    activeFile: ports.activeFile ?? (() => null),
    exportFile: ports.exportFile ?? refuseExport,
    ask: ports.ask ?? refuseAsk,
    askText: ports.askText ?? refuseAskText,
    storage: ports.storage ?? REFUSE_STORAGE,
    ...envelope,
  }
}

export async function dispatchDavisApi(deps: DispatchDeps, request: RpcRequest): Promise<unknown> {
  const params = asRecord(request.params)
  const { workspace } = deps

  switch (request.method) {
    case METHOD_GET_PROJECT_PATH:
      return workspace.getProjectPath()
    case METHOD_LIST_FILES:
      return workspace.listFiles(requireString(params['glob'], 'glob'))
    case METHOD_READ_FILE:
      return workspace.readFile(requireString(params['path'], 'path'))
    // **null 을 그대로 낸다.** 「아무것도 안 보고 있다」는 사실이라 빈 객체로 채우지 않는다.
    case METHOD_ACTIVE_FILE:
      return deps.activeFile()
    case METHOD_SET_ROWS: {
      const rows = params['rows']
      deps.emitRows(
        requireString(params['viewId'], 'viewId'),
        Array.isArray(rows) ? rows : [],
        deps.projectId(),
      )
      return undefined
    }

    case METHOD_PROGRESS: {
      // 글 말고는 다 선택이다. **수를 지어내지 않는다** — 분모를 모르는 단계에서
      // 억지로 퍼센트를 만들면 화면이 거짓말을 한다.
      //
      // 확장 이름은 **문자열이 아니면 던진다** (`storage` 와 같은 규칙). 눙쳐서 흘리면
      // 주인 없는 줄이 되어 어느 바에도 안 뜨고, 확장 개발자는 사유를 못 본다.
      const text = params['text']
      const done = asCount(params['done'])
      const total = asCount(params['total'])
      const kind = asProgressKind(params['kind'])
      const lanes = asProgressLanes(params['lanes'])
      // `undefined` 인 칸은 **아예 싣지 않는다** — 화면이 「있음/없음」으로 가르는 값이다
      deps.emitProgress(
        {
          extension: requireString(params['extension'], 'extension'),
          text: typeof text === 'string' ? text : null,
          ...(done === undefined ? {} : { done }),
          ...(total === undefined ? {} : { total }),
          ...(kind === undefined ? {} : { kind }),
          ...(lanes === undefined ? {} : { lanes }),
        },
        deps.projectId(),
      )
      return undefined
    }
    case METHOD_SET_HTML:
      // 행과 달리 **빈 값으로 눙치지 않고 던진다** — 표는 0행이 정상 결과지만,
      // HTML 자리에 문자열이 아닌 것이 온 것은 확장의 실수다. 조용히 빈 화면을 그리면
      // 확장 개발자가 무엇이 잘못됐는지 알 길이 없다.
      deps.emitHtml(
        requireString(params['viewId'], 'viewId'),
        requireString(params['html'], 'html'),
        deps.projectId(),
      )
      return undefined
    case METHOD_SET_TREE: {
      // 행과 같은 규칙이다 — 배열이 아니면 빈 트리로 본다. 마디의 모양 검증은 화면 쪽이 한다
      // (`extensionTree.ts`): 여기서 걸러도 화면은 어차피 남의 데이터로 취급해야 한다.
      const nodes = params['nodes']
      deps.emitTree(
        requireString(params['viewId'], 'viewId'),
        Array.isArray(nodes) ? nodes : [],
        deps.projectId(),
      )
      return undefined
    }
    case METHOD_EXPORT_SAVE:
      // 파일 이름도 **문자열이 아니면 던진다.** 확장이 이름을 빠뜨린 채로 대화상자가 뜨면
      // 사용자는 무엇을 저장하는 중인지 모른 채 경로를 고르게 된다.
      return deps.exportFile(
        requireString(params['fileName'], 'fileName'),
        requireString(params['text'], 'text'),
      )
    case METHOD_AGENT_ASK: {
      // **확장 이름은 `createDavisApi` 가 채운다** (`storage` 와 같은 규칙).
      // 활동 통지를 어느 확장에 배달할지 가르는 열쇠라, 확장이 실으면 남의 화면에 찍힌다.
      const extension = requireString(params['extension'], 'extension')
      // **겉봉을 함께 넘긴다** — 저장소가 쓰는 프로젝트와 같은 곳에 물어야 한다
      return deps.ask(requireString(params['prompt'], 'prompt'), deps.projectId(), (activity) => {
        deps.notifyChild(NOTICE_AGENT_ACTIVITY, { extension, ...activity })
      })
    }
    // **확장 이름은 `createDavisApi` 가 채운다** (`storage` 와 같은 규칙).
    // 확장이 직접 실어 보내면 남의 이름으로 창을 띄울 수 있다.
    case METHOD_UI_ASK_TEXT: {
      const hint = params['hint']
      return deps.askText({
        label: requireString(params['label'], 'label'),
        title: requireString(params['title'], 'title'),
        ...(typeof hint === 'string' ? { hint } : {}),
        value: typeof params['value'] === 'string' ? params['value'] : '',
        multiline: params['multiline'] === true,
      })
    }
    case METHOD_STORAGE_GET:
      return deps.storage.get(
        requireString(params['extension'], 'extension'),
        deps.projectId(),
        requireString(params['key'], 'key'),
      )
    case METHOD_STORAGE_SET:
      // `value` 는 검사하지 않는다 — 확장이 무엇을 넣든 그대로 돌려주는 것이 계약이다.
      // 넣을 수 없는 값(함수 등)은 구조화 복제가 RPC 경계에서 이미 거른다.
      return deps.storage.set(
        requireString(params['extension'], 'extension'),
        deps.projectId(),
        requireString(params['key'], 'key'),
        params['value'],
      )
    default:
      throw new Error(`알 수 없는 메서드: ${request.method}`)
  }
}

/** 진행 분수의 한쪽. 수가 아니면 **없는 것으로** 본다 — 억지로 0 으로 만들면 0/0 이 그려진다. */
function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// 배선 없는 자리의 거절 함수들은 `serviceRefuse.ts` 로 옮겼다. **여기서 다시 내보낸다** —
// 이 파일이 확장 포트의 정문이라, 쓰는 쪽이 두 곳을 알아야 할 이유가 없다.
export {
  REFUSE_STORAGE,
  refuseAsk,
  refuseAskText,
  refuseExport,
  type ExtensionAskText,
  type ExtensionExportFile,
}
