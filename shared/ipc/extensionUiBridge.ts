import type { ProjectHandler } from './desktopBridge'

// 웹뷰 탭(매니페스트 3판) 표면 — 탭 띄우기·놓기·메시지 양방향·탭 열기 요청, 그리고 채팅 입력칸에 넣기(H2).
// `desktopBridge.ts` 가 300줄 상한에 붙어 갈라냈고 그쪽이 상속한다 (`extensionBridgeSurface.ts` 와 같은 자리).
//
// **메시지는 토큰으로 다닌다.** 탭(iframe)이 누구인지는 main 이 토큰에서 푼다 — 확장·뷰·프로젝트를
// 화면이 실어 보내게 하면, 그 값이 틀렸을 때 남의 확장·남의 프로젝트로 간다 (`uiServer.ts`).

/** 어느 확장의 어느 뷰를 **어느 프로젝트에서** 띄우나. 탭이 들고 있는 것은 이것이다 */
export interface ExtensionUiTarget {
  extension: string
  viewId: string
  projectId: string
}

/** 띄운 결과. 실패를 `null` 로 뭉뚱그리지 않는다 — 꺼짐·없는 뷰·`ui/` 없음을 사람이 읽어야 한다 */
export type ExtensionUiOpenViewResult =
  | { ok: true; token: string; url: string; title: string }
  | { ok: false; reason: string }

/** 앞단 → 뒷단, 뒷단 → 앞단 둘 다 이 모양이다. `message` 는 JSON 만 (`shared/extensions/uiMessage.ts`) */
export interface ExtensionUiMessagePayload {
  token: string
  message: unknown
}

/** 탭을 열어라 (`code.ui.open`). 프로젝트는 겉봉(`ProjectScoped`)에 있다 */
export interface ExtensionUiOpenPayload {
  extension: string
  viewId: string
  /** 매니페스트의 뷰 제목 — 탭 이름표 */
  title: string
}

/** 채팅 입력칸에 넣을 글 (`code.chat.post`). 프로젝트는 겉봉에 있다. **넣기만 하고 보내지 않는다** */
export interface ExtensionChatPostPayload {
  text: string
}

/**
 * 편집기 탭으로 열 파일 (`code.workspace.openFile`). 프로젝트는 겉봉에 있다.
 *
 * 경로는 **프로젝트 루트 상대경로**다 — 탭 식별자가 그 값이고(`OpenFile.path`), 절대경로를 실으면
 * 같은 파일이 두 탭이 된다.
 */
export interface ExtensionOpenFilePayload {
  path: string
  /** 1-based. 없으면 맨 위 — 탭의 `revealLine` 이 되는 값이다 */
  line?: number
}

export interface ExtensionUiBridgeSurface {
  /** 탭이 마운트될 때 **한 번.** 토큰은 탭이 사는 동안 그대로다 */
  openExtensionUi(target: ExtensionUiTarget): Promise<ExtensionUiOpenViewResult>
  /** 탭을 닫았다 */
  closeExtensionUi(payload: { token: string }): Promise<void>
  /** 앞단이 올린 한 통을 뒷단으로. 못 건네면 사유와 함께 거부된다 */
  sendExtensionUi(payload: ExtensionUiMessagePayload): Promise<void>
  /** 뒷단이 민 한 통. **자기 토큰의 것만** 받아야 한다 — 거르는 것은 받는 탭이다 */
  onExtensionUiMessage(handler: (payload: ExtensionUiMessagePayload) => void): () => void
  onExtensionUiOpen(handler: ProjectHandler<ExtensionUiOpenPayload>): () => void
  /** 확장이 입력칸에 넣으라고 한 글. **그 입력칸의 프로젝트 것만** 받아야 한다 */
  onExtensionChatPost(handler: ProjectHandler<ExtensionChatPostPayload>): () => void
  /** 확장이 열라고 한 파일. 입력칸과 같은 규칙 — **지금 보고 있는 프로젝트 것만** 받는다 */
  onExtensionOpenFile(handler: ProjectHandler<ExtensionOpenFilePayload>): () => void
}
