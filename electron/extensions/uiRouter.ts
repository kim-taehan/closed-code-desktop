import type { ExtensionUiServer } from './uiServer'

// 확장 뒷단이 민 웹뷰 메시지(`code.ui.post`)와 탭 열기(`code.ui.open`)의 **행선지를 가르는** 자리.
//
// 수명이 둘로 갈린다. 토큰 표(`uiServer.ts`)와 확장 호스트는 **앱 수명**이고, 메시지를 실어 갈
// 창은 **창 수명**이다 (macOS 는 창을 닫아도 앱이 산다). 그래서 창 쪽 배선(`extensionUiBridge.ts`)이
// 붙을 때 `attach` 로 실어 갈 길을 걸고 떨어질 때 뗀다 — 호스트에 창을 값으로 넘기면 창을
// 되살린 뒤 죽은 세대를 본다 (`appLaunch.ts` 머리말과 같은 함정).
//
// **electron 을 import 하지 않는다.** 판단(누구에게 주나)만 있고, 보내는 것은 붙은 쪽이 한다.

/** 창 쪽이 걸어 주는 두 길 */
export interface UiSinks {
  /** 그 토큰의 탭에 메시지 한 통 */
  toTab(token: string, message: unknown): void
  /** 그 프로젝트에서 이 뷰의 탭을 열라고 화면에 알린다. 열 수 없는 뷰(꺼짐·없음)면 사유와 함께 거부한다 */
  openTab(projectId: string, extension: string, viewId: string): Promise<void>
  /** 그 프로젝트의 채팅 입력칸에 글을 넣는다 (`code.chat.post`). 그 프로젝트가 화면에 없으면 사유와 함께 던진다 */
  chatPost(projectId: string, text: string): void
  /**
   * 그 프로젝트의 편집기 탭으로 파일을 연다 (`code.workspace.openFile`). `line` 은 1-based.
   *
   * **경로는 이미 걸러진 것이다** — 루트 안의 있는 파일인지는 `workspaceDispatch` 가 `ExtensionWorkspace`
   * 로 본다 (경계 판정은 루트를 아는 쪽의 일이다). 여기서 보는 것은 입력칸과 같은 물음 하나,
   * **그 프로젝트가 화면에 있나**뿐이다.
   */
  openFile(projectId: string, path: string, line?: number): void
}

/** 확장 호스트(`serviceDispatch`)가 보는 표면 */
export interface UiPorts {
  /** 열린 탭이 하나라도 있어 실어 보냈으면 true */
  post(extension: string, viewId: string, message: unknown, projectId: string): boolean
  open(extension: string, viewId: string, projectId: string): Promise<void>
  chatPost(projectId: string, text: string): void
  openFile(projectId: string, path: string, line?: number): void
}

export class ExtensionUiRouter implements UiPorts {
  private sinks: UiSinks | null = null

  constructor(readonly server: ExtensionUiServer) {}

  /** 창이 붙었다. 돌려준 함수로 뗀다 — 뗄 때 토큰도 전부 놓는다 (탭이 창과 함께 사라졌다) */
  attach(sinks: UiSinks): () => void {
    this.sinks = sinks
    return () => {
      if (this.sinks === sinks) this.sinks = null
      this.server.clear()
    }
  }

  /**
   * (확장 · 뷰 · 프로젝트)가 **셋 다** 맞는 열린 탭에만 준다 (`uiServer.tokensOf`).
   *
   * 열린 탭이 없으면 버리고 false — 탭이 뜨기 전에 민 것을 여기서 쌓아 두지 않는다. 앞단이
   * 뜨면 앞단이 자기가 필요한 것을 청하면 된다 (확장 재설계 §2-1: 앱은 앞단 상태를 보관하지 않는다).
   */
  post(extension: string, viewId: string, message: unknown, projectId: string): boolean {
    const sinks = this.sinks
    if (sinks === null) return false
    const tokens = this.server.tokensOf(extension, viewId, projectId)
    for (const token of tokens) sinks.toTab(token, message)
    return tokens.length > 0
  }

  async open(extension: string, viewId: string, projectId: string): Promise<void> {
    if (this.sinks === null) throw new Error('웹뷰 탭을 열 창이 없습니다')
    await this.sinks.openTab(projectId, extension, viewId)
  }

  /** 입력칸도 창 수명이다 — 웹뷰 탭과 같은 길로 싣는다. 창이 없으면 넣을 칸이 없다 */
  chatPost(projectId: string, text: string): void {
    if (this.sinks === null) throw new Error('채팅 입력칸이 있는 창이 없습니다')
    this.sinks.chatPost(projectId, text)
  }

  /** 본문 탭도 창 수명이다 (`chatPost` 와 같은 이유) */
  openFile(projectId: string, path: string, line?: number): void {
    if (this.sinks === null) throw new Error('파일을 열 창이 없습니다')
    this.sinks.openFile(projectId, path, line)
  }
}
