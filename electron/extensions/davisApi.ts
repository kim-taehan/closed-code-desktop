// 확장이 받는 `davis` 객체 — 확장 개발자가 보는 유일한 계약이다.
//
// **여기에 구현은 없다.** 파일 접근도 화면 갱신도 전부 부모(main)가 한다.
// 자식(확장 호스트)에는 어떤 프로젝트가 열려 있는지가 없고, 경로 경계 판정은
// 프로젝트 상태를 쥔 쪽에서만 옳게 내릴 수 있다 (레포 원칙: 상태 소유는 main).
// 자식이 프로젝트 루트 사본을 들고 있으면 프로젝트를 바꾼 순간 낡은 경계로 읽는다.
// 여기 있는 것은 RPC 로 부모에게 넘기는 얇은 대리자뿐이다.
//
// ⚠️ runtime 의 **플러그인**(`src/app/plugins/`)과 다른 체계다 (계획서 §0).

import { listenAgentActivity, type AgentActivity } from './agentActivityBus'
import type { ExtensionProgressKind, ExtensionProgressLane } from '../../shared/ipc/extensionPayloads'
import {
  asActiveFile,
  asPathOrNull,
  asString,
  asStrings,
  asTextOrNull,
  type ActiveFile,
} from './davisApiParse'


// 메서드 이름은 `davisApiMethods.ts` 에 산다 — 여기로 **그대로 다시 내보낸다.**
// 부르는 쪽(`serviceDispatch`·시험)은 어느 파일에서 오는지 몰라도 되고, 갈라낸 것 때문에
// import 를 고쳐 다닐 이유도 없다.
export * from './davisApiMethods'
import {
  METHOD_ACTIVE_FILE,
  METHOD_AGENT_ASK,
  METHOD_EXPORT_SAVE,
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_PROGRESS,
  METHOD_READ_FILE,
  METHOD_SET_HTML,
  METHOD_SET_ROWS,
  METHOD_SET_TREE,
  METHOD_STORAGE_GET,
  METHOD_STORAGE_SET,
  METHOD_UI_ASK_TEXT,
} from './davisApiMethods'


/** 확장이 만드는 트리의 마디. 화면 쪽 `ExtensionTreeNodePayload` 와 같은 모양이다. */
export interface ExtensionTreeNode {
  id: string
  label: string
  badge?: string
  /** 이 줄에만 붙는 버튼. 누르면 그 마디 하나를 골라 `command` 를 돌린다 */
  action?: { label: string; command: string }
  children?: ExtensionTreeNode[]
}

export interface AskTextOptions {
  /** 창 제목. 무엇을 묻는지가 여기서 끝나야 한다 */
  title: string
  /** 도움말 한 줄. 생략하면 안 그린다 */
  hint?: string
  /** 처음에 채워 둘 글. 생략하면 빈 상자 */
  value?: string
  /** 여러 줄로 받을 것인가. 기본은 한 줄 */
  multiline?: boolean
}

export interface DavisApi {
  workspace: {
    getProjectPath(): Promise<string>
    listFiles(glob: string): Promise<string[]>
    readFile(relativePath: string): Promise<string>
    /** 지금 보고 있는 파일. 없으면 `null` — **빈 객체를 만들지 않는다.** */
    activeFile(): Promise<ActiveFile | null>
  }
  view: {
    setRows(viewId: string, rows: unknown[]): Promise<void>
    setHtml(viewId: string, html: string): Promise<void>
    setTree(viewId: string, nodes: ExtensionTreeNode[]): Promise<void>
  }
  /**
   * 진행 상황. `null` 이면 지운다. `done`/`total` 은 있으면 분수로 그려진다.
   *
   * `more.kind` 가 `done`·`fail`·`note` 면 그 줄은 화면에 **쌓인다**. 없거나 `step` 이면
   * 지금 줄을 갈아치운다 — 대상 하나가 끝났다는 소식과 「…하는 중」은 수명이 다르다.
   *
   * `more.lanes` 는 **겹쳐 도는 것들**이다. 확장이 여러 갈래로 돌 때 한 줄로는 그중
   * 하나밖에 못 적으므로, 몇 갈래로 무엇을 물고 있는지 여기로 함께 올린다.
   */
  progress(
    text: string | null,
    done?: number,
    total?: number,
    more?: { kind?: ExtensionProgressKind; lanes?: ExtensionProgressLane[] },
  ): void
  export: {
    /** 저장한 절대경로. 사용자가 창을 닫으면 `null` — **취소는 실패가 아니다.** */
    save(fileName: string, text: string): Promise<string | null>
  }
  agent: {
    /**
     * 최종 답 텍스트. 도구 호출·사고 과정은 빼고 결론만 온다. 실패하면 던진다.
     *
     * `onActivity` 를 주면 **답을 만드는 동안** 어시스턴트가 무엇을 하는지 한 줄씩 온다.
     * 질의 하나가 수십 초~수 분이라, 그동안 확장이 화면에 말할 것이 없으면 사람은 멈춘
     * 것으로 읽는다. **결론이 아니다** — 화면에 보이기만 하고 파싱하지 않는다.
     */
    ask(prompt: string, onActivity?: (activity: AgentActivity) => void): Promise<string>
  }
  ui: {
    /**
     * 사람에게 글을 묻는다. **사용자가 창을 닫으면 `null`** — 취소는 실패가 아니다.
     *
     * `value` 를 주면 그것이 채워진 채로 뜬다. 고쳐 쓰는 것이 기본 사용이라
     * (저장된 템플릿을 다시 열어 손보는 식), 빈 상자로만 물으면 매번 처음부터 써야 한다.
     */
    askText(options: AskTextOptions): Promise<string | null>
  }
  storage: {
    /** 넣은 적 없는 키는 `undefined`. `null` 은 일부러 넣은 값이라 구분된다. */
    get(key: string): Promise<unknown>
    /** `undefined` 를 주면 그 키를 지운다. */
    set(key: string, value: unknown): Promise<void>
  }
}

/** 부모에게 요청을 보내고 응답을 기다리는 함수. 실패하면 거부된다. */
export type RpcCall = (method: string, params?: unknown) => Promise<unknown>

/**
 * 대리자를 만든다.
 *
 * 반환값을 `as` 로 단정하지 않고 모양을 확인한다 — 부모가 우리 코드라도,
 * 여기서 거짓말을 하면 확장 안에서 엉뚱한 자리에서 터진다.
 */
/**
 * @param extensionName 매니페스트 `name`. **저장소의 열쇠**라 사람이 읽는 이름과 갈라 둔다 —
 *   표시 이름을 열쇠로 쓰면 확장이 이름을 바꾸는 순간 저장된 것이 통째로 사라진다.
 * @param extensionLabel 사람이 읽는 이름(`displayName`). 물음창에만 쓴다. 생략하면 `name`.
 */
export function createDavisApi(call: RpcCall, extensionName: string, extensionLabel?: string): DavisApi {
  return {
    workspace: {
      getProjectPath: async () => asString(await call(METHOD_GET_PROJECT_PATH), METHOD_GET_PROJECT_PATH),
      listFiles: async (glob) => asStrings(await call(METHOD_LIST_FILES, { glob }), METHOD_LIST_FILES),
      readFile: async (relativePath) =>
        asString(await call(METHOD_READ_FILE, { path: relativePath }), METHOD_READ_FILE),
      activeFile: async () => asActiveFile(await call(METHOD_ACTIVE_FILE)),
    },
    view: {
      setRows: async (viewId, rows) => {
        await call(METHOD_SET_ROWS, { viewId, rows })
      },
      setHtml: async (viewId, html) => {
        await call(METHOD_SET_HTML, { viewId, html })
      },
      setTree: async (viewId, nodes) => {
        await call(METHOD_SET_TREE, { viewId, nodes })
      },
    },
    // **기다리지 않는다.** 진행 알림을 await 하면 훑기가 화면 왕복만큼 느려지고,
    // 알림이 실패해도 훑기는 계속돼야 한다 (알림은 곁다리다).
    //
    // `extension` 을 여기서 채운다 — `storage` 와 같은 규칙이다. 확장이 실어 보내면
    // 남의 바에 자기 문구를 띄울 수 있다.
    progress: (text, done, total, more) => {
      void call(METHOD_PROGRESS, {
        extension: extensionName,
        text,
        done,
        total,
        kind: more?.kind,
        lanes: more?.lanes,
      }).catch(() => {})
    },
    export: {
      save: async (fileName, text) => asPathOrNull(await call(METHOD_EXPORT_SAVE, { fileName, text })),
    },
    agent: {
      // `extension` 을 여기서 채운다 — 활동 통지를 어느 확장에 배달할지 가르는 열쇠라,
      // 확장이 실어 보내면 남의 화면에 자기 활동을 찍을 수 있다 (`storage` 와 같은 규칙).
      ask: async (prompt, onActivity) => {
        const stop = onActivity ? listenAgentActivity(extensionName, onActivity) : null
        try {
          return asString(
            await call(METHOD_AGENT_ASK, { extension: extensionName, prompt }),
            METHOD_AGENT_ASK,
          )
        } finally {
          // **반드시 거둔다.** 안 거두면 다음 질의의 활동이 앞 질의의 화면으로 흘러간다
          stop?.()
        }
      },
    },
    ui: {
      askText: async (options) =>
        asTextOrNull(
          await call(METHOD_UI_ASK_TEXT, {
            // `label` 을 여기서 채운다 — 확장이 실어 보내면 남의 이름으로 창이 뜬다.
            // 저장소 열쇠(`extension`)와 **다른 이름**을 쓴다: 이쪽은 사람이 읽는 이름이라
            // 같은 칸에 담으면 언젠가 표시 이름이 저장소 열쇠로 새어 든다.
            label: extensionLabel ?? extensionName,
            title: options.title,
            ...(options.hint === undefined ? {} : { hint: options.hint }),
            value: options.value ?? '',
            multiline: options.multiline === true,
          }),
        ),
    },
    storage: {
      // `extension` 을 여기서 채운다 — 확장이 실어 보내면 남의 칸을 읽을 수 있다
      get: (key) => call(METHOD_STORAGE_GET, { extension: extensionName, key }),
      set: async (key, value) => {
        await call(METHOD_STORAGE_SET, { extension: extensionName, key, value })
      },
    },
  }
}

export type { ActiveFile }

// 활동 조각의 모양은 확장 계약의 일부다 — `davis.agent.ask` 의 인자에 나온다
export type { AgentActivity }
