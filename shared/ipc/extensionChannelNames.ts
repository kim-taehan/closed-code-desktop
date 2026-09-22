// 확장 채널 이름. `channelNames.ts` 가 300줄 상한에 닿아 갈라냈고, 거기서 `disjoint` 로 합친다 —
// 키가 겹치면 컴파일이 멈춘다 (저쪽 머리말). 소비자는 여전히 `shared/ipc/channels` 의 `Channel` 을 쓴다.
//
// 옮긴 것은 이름과 주석 그대로다. 줄 순서도 옛 등록부의 것이다.

export const EXTENSION_CHANNELS = {
  /**
   * main → renderer: **확장이 채팅으로 물었다** (`code.chat.ask`).
   *
   * 확장 질의는 사용자 입력과 **같은 큐**를 타야 한다 — 그 큐는 렌더러에 있다
   * (`useSendQueue`). 그래서 main 이 대신 보내지 않고 화면에 밀어 넣는다.
   */
  EXTENSION_CHAT_ASK: 'extension:chatAsk',
  /** renderer → main: 설치된 확장 목록 (건너뛴 것도 사유와 함께 온다) */
  EXTENSION_LIST: 'extension:list',
  /** renderer → main: 확장이 선언한 명령 실행 */
  EXTENSION_RUN_COMMAND: 'extension:runCommand',
  /** 저장된 것을 지금 프로젝트 기준으로 다시 그리라고 시킨다 (`ExtensionService.redraw`) */
  EXTENSION_REDRAW: 'extension:redraw',
  /**
   * renderer → main: **편집기에서 보고 있는 파일이 바뀌었다.**
   *
   * 값의 주인은 렌더러다 (`src/state/editorContext.ts` 가 채팅에 싣는 그 값). main 은
   * 마지막 값을 들고 있다가 확장에 넘긴다 — 확장이 당겨 갈 수도(`workspace.activeFile()`),
   * 밀어 줄 수도(`onActiveFile`) 있어야 해서 둘 다 이 채널 하나에서 갈린다.
   */
  EXTENSION_ACTIVE_FILE: 'extension:activeFile',
  /** 확장 화면의 「중단」 — **사용자 대화의 도는 턴**을 끊는다 (설계 2026-08-13) */
  EXTENSION_CANCEL: 'extension:cancel',
  /** 확장이 알린 진행 상황 한 줄 (`code.progress`) */
  EXTENSION_PROGRESS: 'extension:progress',
  /** main → renderer: 확장이 code.view.setRows 로 넘긴 행 */
  EXTENSION_ROWS: 'extension:rows',
  /** main → renderer: 확장이 code.view.setHtml 로 넘긴 HTML (격리는 renderer 가 씌운다) */
  EXTENSION_HTML: 'extension:html',
  /** 확장이 `view.setTree` 로 올린 트리. 앱이 그리고 **선택 상태도 앱이 쥔다.** */
  EXTENSION_TREE: 'extension:tree',
  /**
   * 확장이 **사람에게 글을 묻는다** (`code.ui.askText`). main → renderer 밀어주기.
   * 답은 `EXTENSION_ASK_TEXT_RESPOND` 로 되돌아온다.
   */
  EXTENSION_ASK_TEXT: 'extension:askText',
  /** 위 물음의 답. `requestId` 로 잇는다 — 물음이 겹쳐도 서로의 답을 먹지 않는다. */
  EXTENSION_ASK_TEXT_RESPOND: 'extension:askTextRespond',
  /**
   * renderer → main: 격리 문서를 등록하고 `code-ext://` URL 을 받는다.
   *
   * srcdoc 을 쓰지 않는 이유는 `electron/extensions/viewHost.ts` 머리말 —
   * srcdoc 은 앱 CSP 를 물려받아 확장 화면의 스크립트가 통째로 죽는다.
   */
  EXTENSION_VIEW_REGISTER: 'extension:viewRegister',
  /** renderer → main: 디스크에서 패키지를 골라 설치 */
  EXTENSION_INSTALL_FROM_DISK: 'extension:installFromDisk',
  /** renderer → main: 확장 폴더의 README.md (설정 창 「상세」) */
  EXTENSION_README: 'extension:readme',
  /** renderer → main: 확장 하나를 켜고 끈다 (목록에는 남고 실리지만 않는다) */
  EXTENSION_SET_ENABLED: 'extension:setEnabled',
  /** renderer → main: 설치된 확장을 폴더째 지운다 */
  EXTENSION_UNINSTALL: 'extension:uninstall',
  /** renderer → main: 확장 결과 표를 CSV 파일로 저장 (내용은 화면이 만들고 main 은 쓰기만) */
  EXTENSION_EXPORT_CSV: 'extension:exportCsv',
  /** renderer → main: 확장 배포처 주소 — 기억한 목록·추가·삭제 (표준 §4.4: 전체 주소를 그대로 쓴다) */
  EXTENSION_REGISTRY_LIST: 'extension:registryList',
  EXTENSION_REGISTRY_ADD: 'extension:registryAdd',
  EXTENSION_REGISTRY_REMOVE: 'extension:registryRemove',
  /** renderer → main: 배포처 하나를 조회한다 (목록 문서 = 사용자가 넣은 주소 그대로) */
  EXTENSION_REGISTRY_FETCH: 'extension:registryFetch',
  /** renderer → main: 배포처가 내놓은 설명(README) — **받기 전에** 보는 글이다 */
  EXTENSION_REGISTRY_README: 'extension:registryReadme',
  /** renderer → main: 배포처에서 패키지를 내려받아 설치한다 (디스크 설치와 같은 검사를 탄다) */
  EXTENSION_REGISTRY_INSTALL: 'extension:registryInstall',
  /**
   * renderer → main: **웹뷰 탭 하나를 띄운다** (매니페스트 3판). 토큰을 새로 내고 iframe URL 을 준다.
   *
   * **탭이 마운트될 때 한 번만** 부른다. 토큰은 (확장 `ui/`·프로젝트·뷰)를 묶고 탭이 사는 동안
   * 바뀌지 않는다 — 갱신마다 새 토큰을 받던 `EXTENSION_VIEW_REGISTER` 가 화면을 다시 띄우던 자리다.
   */
  EXTENSION_UI_OPEN_VIEW: 'extension:uiOpenView',
  /** renderer → main: 탭을 닫았다 — 토큰을 놓는다. 그 뒤로 그 토큰의 파일은 404 다 */
  EXTENSION_UI_CLOSE_VIEW: 'extension:uiCloseView',
  /**
   * renderer → main: 웹뷰 앞단이 올린 메시지 한 통. **토큰으로 온다** — 어느 확장·뷰·프로젝트인지는
   * main 이 토큰에서 푼다. iframe 이 자기가 누구라고 주장할 자리를 두지 않는다.
   */
  EXTENSION_UI_SEND: 'extension:uiSend',
  /** main → renderer: 확장 뒷단이 민 메시지 (`code.ui.post`). 토큰이 맞는 탭 하나만 받는다 */
  EXTENSION_UI_MESSAGE: 'extension:uiMessage',
  /** main → renderer: 이 프로젝트에서 이 뷰의 탭을 열어라 (`code.ui.open`). 프로젝트 겉봉을 쓴다 */
  EXTENSION_UI_OPEN: 'extension:uiOpen',
  /**
   * main → renderer: 이 프로젝트의 채팅 입력칸에 글을 넣어라 (`code.chat.post`, 하이닉스 H2). **보내지 않는다.**
   * 프로젝트 겉봉을 쓴다 — 입력칸이 붙은 프로젝트가 아니면 받는 쪽이 버린다 (`useComposerSendBridges`).
   */
  EXTENSION_CHAT_POST: 'extension:chatPost',
} as const
