import type { ActiveFileNotice } from './extensionPayloads'
import type {
  ExtensionExportCsvPayload,
  ExtensionExportCsvResult,
  ExtensionHtmlPayload,
  ExtensionInstallPayload,
  ExtensionListPayload,
  ExtensionReadmePayload,
  ExtensionReadmeResult,
  ExtensionRowsPayload,
  ExtensionProgressPayload,
  ExtensionTreePayload,
  ExtensionAskTextPayload,
  ExtensionAskTextResponsePayload,
  ExtensionRunCommandPayload,
  ExtensionSetEnabledPayload,
  ExtensionUninstallPayload,
  ExtensionUninstallResult,
  ExtensionViewRegisterPayload,
  ExtensionViewRegisterResult,
} from './extensionPayloads'
import type { ProjectHandler } from './desktopBridge'

// 확장 **설치본** 표면 — 목록·상세·디스크 설치·명령 실행·결과 행.
// `desktopBridge.ts` 가 300줄 상한에 붙어 갈라냈고 그쪽이 상속한다
// (선례: `gitHistoryBridge.ts`·`extensionRegistryBridge.ts`).
//
// 배포처 쪽(`extensionRegistryBridge.ts`)과 가르는 선은 **바깥이냐 안이냐**다 —
// 저쪽은 신뢰 경계 밖이라 전부 `{ ok:false, reason }` 을 돌려주고, 이쪽은 디스크만 본다.

export interface ExtensionBridgeSurface {
  /**
   * 설치된 확장 목록. **건너뛴 것도 사유와 함께 온다** — 감추면
   * "설치했는데 목록에 안 뜬다" 로 끝난다.
   *
   * 프로젝트 겉봉이 없다. 확장은 앱에 설치되는 것이지 프로젝트에 매이지 않고,
   * 확장 호스트도 **앱 수명**이다 (main.ts 에서 whenReady 에 뜬다).
   */
  listExtensions(): Promise<ExtensionListPayload>
  /**
   * 파일 선택창을 열어 고른 패키지를 설치한다.
   *
   * 사용자가 창을 닫으면 `{ ok: false, cancelled: true }` 다 — 실패가 아니다.
   */
  installExtensionFromDisk(): Promise<ExtensionInstallPayload>
  /**
   * 확장 폴더의 README.md. 설정 창 「상세」가 그린다.
   *
   * 없어도 예외가 아니라 `{ ok: false, reason: 'missing' }` 으로 온다 —
   * README 없는 확장이 대부분이라 없음이 정상 상태다.
   */
  readExtensionReadme(payload: ExtensionReadmePayload): Promise<ExtensionReadmeResult>
  /**
   * 확장 하나를 켜고 끈다. **목록에는 남는다** — 사라지면 다시 켤 자리가 없다.
   *
   * 끄면 그 확장의 명령·뷰가 사라진다. 다만 **이미 실린 코드가 걸어 둔 타이머·리스너는
   * 앱을 껐다 켤 때까지 돈다** (`service.ts` 의 loadAll 머리말 — 자식을 다시 띄우면
   * 다른 확장이 쥔 상태까지 날아간다).
   */
  setExtensionEnabled(payload: ExtensionSetEnabledPayload): Promise<void>
  /**
   * 설치된 확장을 폴더째 지운다. 심링크로 깔린 것은 **링크만** 지워지고 원본은 남는다.
   *
   * 되돌릴 수 없으므로 확인은 화면이 먼저 받는다.
   */
  uninstallExtension(payload: ExtensionUninstallPayload): Promise<ExtensionUninstallResult>
  /** 확장이 선언한 명령을 실행한다. 없는 명령·죽은 호스트면 거부된다(reject). */
  runExtensionCommand(payload: ExtensionRunCommandPayload): Promise<void>
  /**
   * **저장해 둔 것을 지금 프로젝트 기준으로 다시 그리라고 시킨다.**
   *
   * 확장은 앱이 뜰 때 한 번만 그린다. 그 한 번은 화면이 붙기 전에 끝날 수 있고, 프로젝트
   * 탭을 옮기면 화면은 비워지는데(`useExtensionTree`) 확장은 그 사실을 모른다.
   * 그래서 **화면이 붙은 뒤에 화면이 부른다** — `requestHistoryList` 와 같은 방식이다.
   */
  redrawExtensionViews(): Promise<void>
  /**
   * 편집기에서 보고 있는 파일이 바뀌었다고 알린다. **응답을 안 기다린다.**
   *
   * 파일을 옮길 때마다 도는 자리라, 왕복을 기다리면 탭 전환이 확장의 느린 조회만큼
   * 느려진다. 아무것도 안 보고 있으면 `null` — 빈 객체를 만들지 않는다.
   */
  notifyActiveFile(file: ActiveFileNotice | null): void
  /**
   * 도는 확장 질의를 끊는다.
   *
   * 확장 명령은 어시스턴트를 여러 번 부르고 그 하나하나가 수 분이다 — 중단이 없으면
   * 사용자는 **끝날 때까지 기다리는 것 말고 할 수 있는 일이 없다.**
   */
  cancelExtension(): Promise<void>
  /**
   * 확장 결과 표를 CSV 파일로 저장한다. 저장 대화상자를 띄운다.
   *
   * **CSV 내용은 화면이 만들어 넘긴다** — 거르고 정렬한 지금 상태가 곧 내보낼 것이라,
   * main 이 다시 계산할 수 있는 값이 아니다.
   *
   * 사용자가 창을 닫으면 `{ ok: false, cancelled: true }` 다 — 실패가 아니다
   * (`installExtensionFromDisk` 와 같은 규칙).
   */
  exportExtensionCsv(payload: ExtensionExportCsvPayload): Promise<ExtensionExportCsvResult>
  /**
   * 확장이 넘긴 결과 행.
   *
   * 겉봉은 **명령을 건 프로젝트**다 — `runExtensionCommand` 를 부른 순간 굳고, 명령이
   * 도는 동안 탭을 옮겨도 바뀌지 않는다. 화면은 겉봉이 다르면 버린다 (`useExtensionRows`).
   *
   * ⚠️ 확장이 **읽는** 파일은 여전히 활성 프로젝트 기준이다(`workspaceApi.ts` 의
   * `requireActive`). 명령 도중 탭을 옮기면 읽는 대상과 겉봉이 어긋날 수 있다.
   */
  onExtensionRows(handler: ProjectHandler<ExtensionRowsPayload>): () => void
  /**
   * 확장이 넘긴 화면(HTML). 겉봉 규칙은 `onExtensionRows` 와 같다.
   *
   * **행과 따로 온다.** 한 채널에 합쳐 종류로 가르면 화면이 "이번 것은 표인가 HTML 인가" 를
   * 매번 되물어야 하고, 뷰 하나가 둘 다 낼 수 있다는 오해를 부른다.
   */
  onExtensionHtml(handler: ProjectHandler<ExtensionHtmlPayload>): () => void
  /** `view.setTree` 로 올라온 트리. 그리기도 **선택 상태도** 앱이 쥔다. */
  onExtensionTree(handler: ProjectHandler<ExtensionTreePayload>): () => void
  /**
   * 확장이 사람에게 글을 묻는다 (`davis.ui.askText`).
   *
   * **겉봉이 없다.** 창이 하나뿐이라 물음은 늘 지금 보는 화면에 뜬다 —
   * 결과와 달리 나중에 돌아와 볼 것이 아니라 **지금 답해야 확장이 진행된다.**
   */
  onExtensionAskText(handler: (payload: ExtensionAskTextPayload) => void): () => void
  /** 위 물음의 답. 취소면 `text` 가 `null` 이다. */
  respondExtensionAskText(payload: ExtensionAskTextResponsePayload): Promise<void>
  /**
   * 오래 걸리는 명령의 진행 상황. `text` 가 `null` 이면 지운다.
   *
   * 잠긴 버튼 하나로는 부족하다 — 목록 갱신은 묶음마다 어시스턴트를 부르므로 수 분이 걸리고,
   * 그동안 화면에 아무 변화가 없으면 사용자는 멈춘 것으로 읽는다.
   */
  onExtensionProgress(handler: ProjectHandler<ExtensionProgressPayload>): () => void
  /**
   * 격리 문서를 등록하고 iframe 에 넣을 `davis-ext://` URL 을 받는다.
   *
   * `srcdoc` 을 못 쓰는 이유 — 그 문서는 **앱 CSP 를 물려받아** 확장 화면의 스크립트가
   * 통째로 막힌다 (`electron/extensions/viewHost.ts` 머리말의 실측).
   */
  registerExtensionView(
    payload: ExtensionViewRegisterPayload,
  ): Promise<ExtensionViewRegisterResult>
}
