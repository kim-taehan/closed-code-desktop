// 확장이 부를 수 있는 **메서드 이름들**. `code` 객체(`extensionApi.ts`)의 각 함수가 이 중
// 하나로 부모에게 넘어가고, `serviceDispatch.ts` 가 같은 이름으로 받아 갈래를 탄다.
//
// `extensionApi.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다. 이름과 그 뜻은 **확장 개발자가
// 읽는 계약**이라 주석이 길고, 앞으로도 기여점이 늘 때마다 길어진다. 갈래 실행(대리자)과
// 이름 목록은 같은 속도로 자라지 않는다. `extensionApi.ts` 가 그대로 다시 내보내므로
// 부르는 쪽은 어느 파일에서 오는지 몰라도 된다.

/**
 * 프로젝트의 절대경로. 열린 프로젝트가 없으면 거부된다.
 *
 * **셋(`getProjectPath`·`listFiles`·`readFile`) 다 「어느 프로젝트」는 `METHOD_UI_POST` 와 같은 규칙이다** (G-1,
 * 2026-09-22) — 적은 `projectId` → 겉봉, 둘 다 없으면 거부, 그 프로젝트에서 켜진 확장만. 예전에는 화면에
 * 떠 있는 프로젝트를 읽어, 핸들러 도중 사용자가 탭을 옮기면 남의 프로젝트 파일을 읽었다.
 */
export const METHOD_GET_PROJECT_PATH = 'workspace.getProjectPath'
/** glob 에 맞는 파일들의 **프로젝트 상대경로**. 지원 문법은 globFilter.ts 머리말 참조. */
export const METHOD_LIST_FILES = 'workspace.listFiles'
/** 프로젝트 안의 파일 하나를 텍스트로. 밖·너무 큼·바이너리는 거부된다. */
export const METHOD_READ_FILE = 'workspace.readFile'
/**
 * **지금 편집기에서 보고 있는 파일.** 아무것도 안 보고 있으면 `null`.
 *
 * `onActiveFile`(밀기)과 짝이다 — 밀기만 있으면 확장이 **켜진 직후**를 못 채운다.
 * 이미 파일이 열려 있는 상태에서 확장이 활성화되면 이벤트가 안 오기 때문이다.
 * VS Code 가 `activeTextEditor`(당김)와 `onDidChangeActiveTextEditor`(밀기)를
 * 짝으로 갖는 이유와 같다.
 */
export const METHOD_ACTIVE_FILE = 'workspace.activeFile'
/** 뷰에 표시할 행. 확장은 데이터만 넘기고 렌더는 앱이 한다 (계획서 §2.5). */
export const METHOD_SET_ROWS = 'view.setRows'
/**
 * 뷰에 표시할 **화면(HTML)**. `kind: 'html'` 로 선언한 뷰에 쓴다.
 *
 * `setRows` 와 나눠 둔 이유: 행을 내면 정렬·거르개·CSV 내보내기를 앱이 공짜로 얹어 주는데,
 * HTML 을 내면 그 전부를 확장이 직접 해야 한다. **되도록 `setRows` 를 쓰고**, 목록→상세→
 * 관계처럼 표로 표현되지 않는 화면에서만 이쪽을 쓴다.
 *
 * 앱은 이 HTML 을 **격리해서** 그린다 — 스크립트는 opaque origin 에 갇히고 바깥 네트워크는
 * 막힌다. 파일을 열려면 `data-open` 규약을 쓴다 (`src/state/extensionHtmlDoc.ts` 머리말).
 */
export const METHOD_SET_HTML = 'view.setHtml'
/**
 * 뷰에 표시할 **트리**. `kind: 'tree'` 로 선언한 뷰에 쓴다.
 *
 * `setHtml` 과 갈라 둔 까닭이 핵심이다 — **앱이 그리면 선택 상태를 앱이 쥔다.**
 * 확장이 자기 HTML 로 트리를 그리면 사용자가 고른 것을 확장에게 알릴 길이 없다
 * (화면에서 나가는 메시지는 파일 열기 하나뿐이다). 앱이 그리면 명령을 걸 때
 * 고른 것을 함께 실어 보내면 되고, 조작 알갱이가 명령 단위로 유지된다.
 *
 * 잎만 고를 수 있고, 가지를 고르면 그 아래 잎이 전부 딸려온다.
 */
export const METHOD_SET_TREE = 'view.setTree'
/**
 * 진행 상황 한 줄. 오래 걸리는 명령이 **살아 있음과 어디까지 왔는지**를 말하는 통로다.
 *
 * 잠긴 버튼 하나로는 부족하다 — 목록 갱신은 묶음마다 어시스턴트를 부르므로 수 분이 걸리고,
 * 그동안 화면에 아무 변화가 없으면 사용자는 멈춘 것으로 읽는다.
 *
 * `done`/`total` 은 있으면 분수로 그린다. 없으면 글만 나온다 — 끝을 모르는 단계에서
 * **퍼센트를 지어내지 않는다.**
 */
export const METHOD_PROGRESS = 'view.progress'
/**
 * 확장이 만든 문서를 **사용자가 고른 곳**에 내보낸다. 저장한 경로를 돌려주고, 창을 닫으면 `null`.
 *
 * **`workspace.writeFile`(프로젝트 안에 쓰기)과 일부러 갈랐다.** 산출물은 앱 밖으로 들고
 * 나가는 것이지 프로젝트에 남기는 것이 아니다. 이쪽은 경로를 확장이 못 정하므로
 * (사용자가 대화상자에서 고른다) 경로 경계 문제가 아예 생기지 않는다 — 표준 §4.2 가
 * "다음" 으로 미뤄 둔 `workspace.writeFile` 을 열지 않고도 내보내기가 성립하는 이유다.
 *
 * 화면의 「CSV 로 내보내기」(`extensionExportCsv.ts`)와 **같은 자리**다. 저쪽은 행만 있으면
 * 앱이 만들 수 있어 앱 몫이고, 이쪽은 문서 양식을 확장만 알아서 확장 몫이다.
 */
export const METHOD_EXPORT_SAVE = 'export.save'
/**
 * **코드 어시스턴트에게 묻는다.** 확장이 가진 유일한 지능이다.
 *
 * 이 API 가 생기기 전까지 확장은 파일을 읽어 정규식으로 긁는 것밖에 못 했다 — LLM 런타임이
 * 붙어 있는 앱 위에서 그러고 있었다는 것이 표준의 진짜 구멍이었다 (표준 §7 "확장마다
 * 결과 화면을 새로 요구한다" 와 같은 종류의 신호).
 *
 * **확장에 연결 정보를 주지 않는다.** 앱이 대신 묻고 답만 돌려준다 — 확장이 직접 소켓을
 * 열게 하면 설치된 모든 확장이 자격을 갖게 되고, 배포처로 남의 확장을 받는 순간 위험이 된다.
 *
 * ⚠️ **읽기 전용이 아니다 (2026-08-13 이후).** 곁길 시절에는 그 레인이
 * `set_permission_mode { mode: 'plan' }` 으로 고정이라 확장이 시킨 분석이 파일을 고치는 일이
 * 없었다. 이제 확장 질의는 **사용자 대화의 턴**이라 그때의 권한 모드를 그대로 따른다 —
 * 사용자가 편집을 허용해 둔 상태면 확장이 시킨 일도 파일을 고칠 수 있다.
 *
 * 대신 **사용자가 다 본다**: 질문도 답도 화면에 뜨고, 도구 승인 카드도 사용자가 받는다.
 * 안 보이는 곳에서 조용히 도는 것과 보이는 곳에서 승인받는 것 중 뒤를 골랐다 (사용자 결정).
 * 이 안전은 **승인 카드를 실제로 읽는다**는 전제에 기댄다 — 승인 피로가 문제가 되면
 * 읽기 전용 고정이 다음 수다 (설계 §3.1).
 */
export const METHOD_CHAT_ASK = 'chat.ask'
/**
 * **사람에게 글을 묻는다.** 2판 확장이 사용자에게서 값을 받는 유일한 길이다.
 * (3판 웹뷰는 이것이 필요 없다 — 자기 화면에 입력칸을 그리고 `ui.onMessage` 로 받는다.
 * 울타리는 그대로이고, 열린 것은 **자기 뒷단으로 가는 메시지 통로 하나**다. 이 API 는 6단계에서 사라진다.)
 *
 * 확장 화면(`setHtml`)으로는 못 받는다 — 그 화면은 `iframe sandbox` + CSP 안에 있고,
 * 밖으로 나가는 메시지는 파일 열기 하나뿐이다 (`extensionHtmlDoc.ts` 의 `isOpenRequest`).
 * 입력을 거기서 받게 하려면 그 울타리를 열어야 하는데, 그것은 확장 화면을 신뢰하는 것과
 * 같다 (표준 §4.2 "확장 호스트는 샌드박스가 아니다").
 *
 * **창은 앱이 그린다.** 확장은 무엇을 묻는지만 말하고 모양은 정하지 못한다 —
 * 확장이 HTML 을 주게 하면 그 순간 신뢰 경계가 다시 무너진다.
 *
 * 취소는 실패가 아니라 `null` 이다 (`export.save` 와 같은 규칙).
 */
export const METHOD_UI_ASK_TEXT = 'ui.askText'
/**
 * 확장이 자기 결과를 들고 있는 곳. **확장별·프로젝트별로 갈린다.**
 *
 * 갈라 두는 이유가 둘이다. 자식은 확장 전부를 한 프로세스에 싣고 같은 통로를 쓰므로,
 * 확장 이름으로 안 가르면 `results` 같은 흔한 키가 충돌한다. 프로젝트로 한 번 더 가르는
 * 것은 A 를 분석한 결과가 B 에서 보이면 사람이 그것을 B 의 산출물로 읽기 때문이다.
 *
 * 확장은 자기 이름을 **말하지 않는다** — 호스트가 어느 확장에 준 `code` 인지 알고
 * 대신 채운다 (`createExtensionApi` 의 두 번째 인자). 확장이 이름을 실어 보내면 남의 칸을
 * 읽는 것을 막을 방법이 없다.
 */
/*
 * **3판은 프로젝트 규칙이 `METHOD_UI_POST` 와 같다** (G-2, 2026-09-22) — 적은 `projectId` → 겉봉, 둘 다 없으면
 * 거부. 2판은 예전대로 겉봉 → 활성 프로젝트 → 공용 「프로젝트 없음」 칸이다 (`workspaceDispatch.ts`).
 */
export const METHOD_STORAGE_GET = 'storage.get'
export const METHOD_STORAGE_SET = 'storage.set'
/**
 * **확장 뒷단이 호스트를 거쳐 HTTP 를 부른다** (하이닉스 요구사항 확장 §5-1). 부르는 것은 main 이다.
 *
 * 매니페스트 3판 `network` 에 적은 **출처**(scheme+host+port 정확히)만 허용한다. 넘겨주기는 행선지도
 * 목록에 있을 때만 따라가고, 쿠키는 담아 두지 않는다. 응답 10MB · 시간 기본 30초 최대 120초.
 * 바이트는 양쪽 다 base64 (`bodyBase64`). 프로젝트 규칙·켜짐은 `METHOD_UI_POST` 와 같다.
 * 규칙의 근거는 `httpFetch.ts` 머리말.
 */
export const METHOD_HTTP_FETCH = 'http.fetch'
/**
 * **비밀** (토큰 같은 것). OS 보안 저장소(`safeStorage`)로 암호화해 둔다. **확장마다**다 — 프로젝트를 안 본다.
 * 암호화를 못 쓰는 환경이면 거부된다 (평문으로 떨어지지 않는다). 웹뷰에는 길이 없다 — 뒷단만 부른다.
 * 확장 이름은 `storage` 와 같이 호스트가 채운다. 근거는 `secretStore.ts` 머리말.
 */
export const METHOD_SECRETS_GET = 'secrets.get'
export const METHOD_SECRETS_SET = 'secrets.set'
export const METHOD_SECRETS_DELETE = 'secrets.delete'
/**
 * **사용자 채팅 입력칸에 글을 넣기만 한다 — 보내지 않는다** (하이닉스 H2 결정 K-3). 사람이 보고 보낸다.
 *
 * `chat.ask`(사용자 대화에 턴을 만든다)와 다르다. 확장 AI(`ai.run`)는 읽기 전용이라, 코드를 고치는 일은
 * 이 길로 **사람을 거쳐** 메인 AI 에 넘긴다 (확장 재설계 §2-3).
 *
 * - 프로젝트 규칙·켜짐은 `METHOD_UI_POST` 와 같다 — 적은 `projectId` → 겉봉, 둘 다 없으면 거부.
 * - 그 프로젝트가 **화면에 떠 있을 때만** 넣는다. 아니면 「그 프로젝트를 먼저 여세요」로 거부된다 —
 *   입력칸은 화면에 뜬 프로젝트 하나에만 있다.
 * - 쓰던 글이 있으면 **덮지 않고 빈 줄 하나 띄워 뒤에 붙인다.** 채팅 탭으로 옮기고 입력칸에 커서를 둔다.
 * - 글은 빈 칸이 아닌 문자열, `CHAT_POST_MAX_BYTES`(UTF-8 바이트)까지.
 */
export const METHOD_CHAT_POST = 'chat.post'
/** `chat.post` 한 번에 넣을 수 있는 글 — UTF-8 **바이트**로 잰다 (한글은 3바이트) */
export const CHAT_POST_MAX_BYTES = 100 * 1024
/**
 * **웹뷰 앞단에 메시지를 민다** (매니페스트 3판, 확장 재설계 §2-1). 앞단은 `message` 이벤트로 받는다.
 *
 * `view.setHtml` 을 대신하는 자리다. 저쪽은 문서를 통째로 갈아끼워 갱신마다 화면이 다시 떴고
 * 스크롤·입력이 날아갔다. 이쪽은 앞단이 **한 번** 뜬 채로 살아 있고 데이터만 간다.
 *
 * 행선지는 (이 확장 · `viewId` · 프로젝트)가 **셋 다** 맞는 열린 탭이다. 프로젝트는 겉봉
 * (`ProjectEnvelope` — 명령·앞단 메시지를 건 프로젝트)이고, 겉봉이 없거나 겹쳐 모를 때는
 * 확장이 `projectId` 를 직접 적어야 한다. **지금 활성 프로젝트로 되돌아가지 않는다** — 그러면
 * 사용자가 탭을 옮긴 사이 P 의 결과가 Q 의 탭에 뜬다 (`projectEnvelope.ts` 머리말의 그 결함).
 *
 * 메시지는 JSON 만, 1MB 까지다 (`shared/extensions/uiMessage.ts`). 넘으면 사유와 함께 거부된다.
 */
export const METHOD_UI_POST = 'ui.post'
/**
 * **웹뷰 탭을 연다.** 이미 열려 있으면 그 탭으로 간다. 프로젝트 규칙은 `METHOD_UI_POST` 와 같다.
 *
 * 명령 팔레트가 없어 지금 이 앱에서 사람이 확장 명령을 부르는 자리는 사이드바·파일 우클릭이고,
 * 그 명령이 이것으로 탭을 연다. 다른 하나의 문은 설정 창 확장 목록의 「열기」다 (E5).
 */
export const METHOD_UI_OPEN = 'ui.open'
/**
 * **확장 전용 AI 세션으로 묻는다** (확장 재설계 §2-3). `chat.ask` 와 달리 사용자 대화에 턴을 만들지 않는다.
 *
 * (확장 × 프로젝트)마다 opencode 세션 하나를 처음 쓸 때 만들어 계속 쓴다. 그 세션은 **읽기 전용**이다 —
 * 만들 때 권한 규칙으로 `read`·`glob`·`grep` 만 열고 나머지(편집·셸·질문·하위 작업)는 막는다
 * (`electron/opencode/extensionRun.ts`). 그래도 승인·질문 요청이 오면 곧바로 거절한다.
 * 세션은 대화 이력에 안 뜬다 (`electron/opencode/extensionSessions.ts`).
 *
 * 프로젝트 규칙은 `METHOD_UI_POST` 와 같다 — 적은 `projectId` → 겉봉, 둘 다 없으면 거부.
 * 한 세션에 한 번에 하나만 돈다. 도는 중에 또 부르면 **busy** 사유로 거부된다.
 *
 * 글 조각은 응답이 아니라 통지(`NOTICE_AI_TEXT`)로 내려온다 — 왕복 하나에 답이 여럿일 수 없다.
 */
export const METHOD_AI_RUN = 'ai.run'
/** 도는 `ai.run` 을 끊는다 (확장이 준 `signal` 이 abort 됐다). 그 세션의 턴을 중단하고 `ai.run` 은 취소 사유로 거부된다 */
export const METHOD_AI_CANCEL = 'ai.cancel'
