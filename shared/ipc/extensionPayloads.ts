import type { ExtensionContributes } from '../extensions/manifest'

// 확장 채널이 주고받는 것.
//
// ⚠️ runtime 의 **플러그인(Plugin)** 과 다른 체계다 (계획서 §0). 문구를 섞지 않는다.
//
// `channels.ts` 가 상한 300에 붙어 있어 타입을 거기 직접 늘리지 않는다.
// 다른 payload 파일(`logPayloads.ts` 등)과 같은 자리다.
//
// **매니페스트를 통째로 내보내지 않는다.** main 의 `LoadedExtension` 은 매니페스트 전체를
// 들고 있는데, 통째로 넘기면 매니페스트가 바뀔 때마다 renderer 가 흔들린다.
// 대신 **화면이 실제로 쓰는 것만** 추린다 — 이름·버전·설명, 그리고 `contributes`
// (사이드바가 명령 버튼과 뷰 탭을 이걸로 그린다).

/** 목록에 뜨는 확장 하나. 상세 창을 두지 않기로 해서 이 필드가 화면에 보이는 전부다. */
export interface ExtensionEntryPayload {
  name: string
  displayName: string
  version: string
  /** 목록 한 줄에 실린다. 매니페스트에 없으면 없다 */
  description?: string
  /** 설치 위치. 상세에 보이고, **삭제할 때 가리키는 것**도 이 값이다 */
  dir: string
  /**
   * 켜져 있는지. 꺼진 확장은 목록에 남되 실리지 않아 명령·뷰가 사라진다.
   *
   * 목록에서까지 지우지 않는 이유는 단순하다 — 사라지면 다시 켤 자리가 없다.
   */
  enabled: boolean
  /**
   * 확장이 얹겠다고 선언한 명령·뷰.
   *
   * 매니페스트에서 **이것만** 그대로 통과시킨다 — 사이드바가 명령 버튼과 뷰 탭을
   * 여기서 그리므로 납작하게 펼 수가 없다. 나머지 필드는 위처럼 추린다.
   */
  contributes?: ExtensionContributes
}

/**
 * 훑거나 싣다가 건너뛴 것.
 *
 * **감추지 않는다.** 설치했는데 목록에 없으면 사용자는 원인을 알 수 없다.
 *
 * `reason` 을 **유니온이 아니라 `string`** 으로 둔다. 사유의 정본은 main 쪽
 * (`electron/extensions/registry.ts` 의 `ExtensionSkipReason` + `extensionLoader` 의 싣기 실패)
 * 인데 renderer 는 `electron/` 을 import 할 수 없다(`tsconfig.json` include = `src`·`shared`).
 * 유니온으로 좁히면 사유가 하나 늘 때마다 화면이 컴파일 에러로 막힌다 —
 * 화면은 모르는 사유도 코드값 그대로 보여주며 버틴다.
 */
export interface SkippedExtensionPayload {
  dir: string
  reason: string
  /** require·activate 가 던진 원문 같은 것. 사유만으로 못 고칠 때 함께 보여준다 */
  detail?: string
}

export interface ExtensionListPayload {
  extensions: ExtensionEntryPayload[]
  skipped: SkippedExtensionPayload[]
}

/**
 * 디스크에서 설치한 결과.
 *
 * `cancelled` 를 따로 두는 이유 — 사용자가 파일 선택을 닫은 것은 **실패가 아니다.**
 * 실패로 뭉뚱그리면 화면이 "설치하지 못했습니다" 를 띄우게 되고, 아무것도 안 한
 * 사용자에게 오류를 보여주는 꼴이 된다.
 */
export type ExtensionInstallPayload =
  | { ok: true; name: string; version: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; reason: string; detail?: string }

/** 확장이 `code.view.setRows` 로 넘긴 행 하나. 키·값은 확장이 정한다. */
export type ExtensionRowPayload = Record<string, unknown>

export interface ExtensionRunCommandPayload {
  commandId: string
  /**
   * 사용자가 화면에서 고른 것 (트리 체크박스·목록 선택).
   *
   * **확장 화면에서 확장으로 가는 통로를 넓히지 않고 선택을 전하는 길이다.**
   * 조작 알갱이를 명령 단위로 두고, 명령을 걸 때 지금 고른 것을 함께 싣는다.
   *
   * 고른 것이 없거나 그런 화면이 아니면 생략된다.
   */
  selection?: string[]
  /**
   * 이 명령을 낸 **확장 화면의 주인**. 화면에서 온 명령(`data-command`)에만 실린다.
   *
   * 2026-08-13 에 통로를 한 갈래 넓혔다. 여기에는 원래 *"그 통로는 파일 열기 하나만
   * 통과시키고, 넓히면 확장이 앱에 보낼 수 있는 것이 통째로 열린다"* 고 적혀 있었다.
   * 넓히되 그 경계는 지킨다 — 새로 통과하는 것은 **명령 id 하나뿐**이고 인자는 없다
   * (`extensionHtmlDoc.ts` 의 `isCommandRequest`). 임의의 값은 여전히 못 보낸다.
   *
   * 함께 싣는 이유: 명령표는 확장 전부가 나눠 쓰는 한 장이라(`childHandlers.ts`)
   * 명령 id 만으로는 남의 명령을 부르는 것을 막을 수 없다. **없으면 종전대로**
   * 확인 없이 돈다 — 사이드바 단추가 그 경로이고, 거기는 앱이 그린 화면이다.
   */
  extension?: string
}


// 진행 상황의 모양은 `extensionProgress.ts` 에 산다 — 여기로 그대로 다시 내보낸다.
export type { ExtensionProgressPayload, ExtensionProgressKind, ExtensionProgressLane } from './extensionProgress'

// 트리의 모양도 갈라 뒀다 (`extensionTreePayload.ts`). 이 파일이 300줄 상한에 닿았고,
// 트리 마디는 칸이 계속 느는 자리다. **부르는 쪽은 여기서 그대로 받는다.**
export type {
  ExtensionTreeNodePayload,
  ExtensionTreeNodeState,
  ExtensionTreePayload,
} from './extensionTreePayload'

/** 한 뷰의 결과 전체. `setRows` 는 이어붙이기가 아니라 통째 교체다 (계획서 §2.4). */
export interface ExtensionRowsPayload {
  viewId: string
  rows: ExtensionRowPayload[]
}

/**
 * 확장이 `code.view.setHtml` 로 넘긴 화면.
 *
 * **날 것 그대로다.** 여기서도 main 에서도 손대지 않는다 — 격리(iframe·CSP·링크 중계)는
 * 그릴 수 있는 유일한 곳인 renderer 가 씌운다 (`src/state/extensionHtmlDoc.ts`).
 * 중간에서 고치기 시작하면 "어디까지가 확장의 HTML 인가" 가 흐려진다.
 *
 * `setRows` 와 같이 **통째 교체**다. 이어붙이지 않는다.
 */
export interface ExtensionHtmlPayload {
  viewId: string
  html: string
}

/**
 * 격리 문서를 등록한다. **완성된 문서**가 온다 — CSP·바탕 스타일·클릭 다리까지 씌운 것
 * (`src/state/extensionHtmlDoc.ts`). main 은 그것을 URL 로 내주기만 하고 내용을 안 본다.
 *
 * 문서를 만드는 일이 renderer 에 남은 이유: 지금 테마 색을 아는 곳이 거기뿐이다.
 */
export interface ExtensionViewRegisterPayload {
  doc: string
}

/** 등록 결과. iframe 의 `src` 에 그대로 넣는다. */
export interface ExtensionViewRegisterResult {
  url: string
}

/** 어느 확장의 상세를 볼지. 이름은 곧 설치 폴더명이다 (`install.ts`). */
export interface ExtensionReadmePayload {
  name: string
}

/**
 * 켜고 끄기. **이름으로 가리킨다** — 확장은 폴더째 복사·심링크로도 깔려서 같은 확장이
 * 자리를 옮길 수 있고, 그때 꺼 둔 것이 조용히 다시 켜지면 안 된다.
 */
export interface ExtensionSetEnabledPayload {
  name: string
  enabled: boolean
}

/**
 * 지우기. **폴더로 가리킨다** — 설치 폴더 이름이 매니페스트 이름과 늘 같지는 않다
 * (폴더째 복사·심링크). 이름으로 지우면 그런 확장은 영영 못 지운다.
 */
export interface ExtensionUninstallPayload {
  dir: string
}

/** 지운 결과. `reason` 은 코드값이고 사람 말로 옮기는 것은 화면 몫이다. */
export type ExtensionUninstallResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string }

/**
 * CSV 로 내보낼 것.
 *
 * **내용을 화면이 만들어 넘긴다.** 무엇을 내보낼지(어느 확장의 어느 뷰를, 거르고 정렬한
 * 어느 상태로)는 화면만 아는 것이고, main 이 그걸 다시 계산하려면 그 상태를 통째로
 * 들고 가야 한다. main 은 대화상자를 띄우고 쓰기만 한다.
 */
export interface ExtensionExportCsvPayload {
  /** 저장 대화상자에 채워 둘 파일 이름. 뷰 제목에서 만든다 (`extensionRowCsv.csvFileName`) */
  suggestedName: string
  csv: string
}

/** 창을 닫은 것은 실패가 아니다 — 설치 흐름(`ExtensionInstallPayload`)과 같은 규칙이다. */
export type ExtensionExportCsvResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; reason: string }

/**
 * 확장 설명(README.md).
 *
 * **`missing` 은 실패가 아니다.** README 없는 확장이 대부분이라, 화면은 이걸
 * 오류가 아니라 "설명이 없습니다" 로 그린다. 사유는 코드값이고 옮기는 것은 화면 몫이다.
 */
export type ExtensionReadmeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string }

/**
 * 편집기에서 **보고 있는 것.** 아무것도 안 보고 있으면 이 값 대신 `null` 이 간다.
 *
 * **빈 객체를 만들지 않는다** — 「경로 없는 파일」은 「안 보고 있다」와 구분되지 않는다.
 * 줄 번호는 **1-based** 다 (`src/state/editorContext.ts` 와 같은 규약. 그쪽 머리말에
 * runtime 의 `start_offset` 이 이름과 달리 줄로 해석된다는 실측이 있다).
 */
export interface ActiveFileNotice {
  /** 프로젝트 루트 상대 경로. 절대 경로 변환은 main 이 한다. */
  path: string
  /** 커서가 있는 줄. 선택 영역이 없으면 없다. */
  line?: number
}

/**
 * 확장이 사람에게 글을 묻는다 (`code.ui.askText`).
 *
 * **취소가 정상 답이다.** 사용자가 창을 닫으면 `null` 이 확장까지 그대로 간다 —
 * 빈 문자열로 눙치면 확장은 "사람이 다 지웠다" 로 읽고 저장된 것을 날린다.
 */
export interface ExtensionAskTextPayload {
  /** 물음을 잇는 열쇠. 물음이 겹쳐도 서로의 답을 먹지 않는다 */
  requestId: string
  /** 어느 확장이 묻나. 사람이 보는 창에 그대로 뜬다 — 익명으로 묻는 창을 두지 않는다 */
  extension: string
  title: string
  /** 창 안의 도움말 한 줄. 없으면 안 그린다 */
  hint?: string
  /** 처음에 채워 둘 글. 고쳐 쓰는 것이 기본 사용이다 */
  value: string
  /** 여러 줄인가. 시나리오 본보기처럼 긴 글은 한 줄 상자에 안 들어간다 */
  multiline: boolean
}

/** 답. `text` 가 `null` 이면 취소다. */
export interface ExtensionAskTextResponsePayload {
  requestId: string
  text: string | null
}
