// 앱 전역 설정. 지금까지 환경변수로만 받던 것들을 사용자가 바꿀 수 있게 한다.
//
// 해석 순서는 **설정 > 환경변수 > 기본값** 이다 (설계 §4.1 과 같은 원칙).
// 환경변수를 아래에 두는 이유는 개발 중 쓰는 방식이라 깨지면 안 되고,
// 동시에 사용자가 화면에서 지정하면 그게 이겨야 하기 때문이다.

// ## 없어진 항목: `opencodeUrl` (2026-08-14)
//
// 붙을 opencode 서버 주소를 사용자가 넣던 칸이 있었다. **지웠다** — 이제 서버를
// **프로젝트마다 우리가 띄우고**(`electron/opencode/serverPool.ts`) 주소는 그 프로세스가
// 알려 준다. 근거는 제품 요구다: 폐쇄망 현장 개발자는 터미널에서 `opencode serve` 를
// 칠 수 없고, 그러니 "이미 띄운 서버 주소" 라는 것이 아예 성립하지 않는다.
//
// **개발용 오버라이드로 격하하지도 않았다.** 남겨 두면 제품이 안 밟는 분기가 설정 파일에
// 남아, 다음 사람이 "이 앱은 붙기도 하는구나" 로 읽는다. 실행 파일 위치만 바꿔야 하는
// 사람에게는 `OPENCODE_BIN` 이 남아 있다 (`electron/opencode/binary.ts`).
//
// 이 항목을 읽던 자리(설정 폼의 주소 칸 · 프로브 IPC 의 `opencodeUrl` 페이로드 ·
// `ProjectBridge.onRuntimeConfigChange`)도 함께 걷어냈다.

/**
 * 데스크톱 MCP 서버 자동 등록의 기본값. **이 상수 한 곳에서만 읽는다** —
 * 켜고 끄는 판단이 바뀌면 여기 한 줄만 고친다.
 *
 * 켜 두는 근거: 사용자가 명시적으로 요청한 기능이고, 서버는 127.0.0.1 에만 바인딩하며
 * 토큰은 실행마다 새로 만든다. 대신 노출 대상이 공여보다 넓다 — 같은 프로젝트 폴더로
 * 그 opencode 서버에 붙은 **다른 클라이언트**(TUI·다른 편집기)도 우리 도구를 본다
 * (`electron/mcp/server.ts` 머리말). 그래서 끌 수 있어야 한다.
 *
 * ## ⚠️ 지금은 켜도 **효과가 없다** (실측, 2026-08-12)
 *
 * 등록은 `connected` 로 끝나고 opencode 가 `tools/list` 로 우리 도구를 받아 가는 것까지
 * 확인됐다. **그런데 그 도구가 모델에게 나가는 도구 집합에 안 실린다.** 모델에게 가는
 * `/v1/chat/completions` 를 프록시로 가로채 봤고, opencode 자신의 오라클
 * (`GET /experimental/tool?provider=&model=`)도 같은 답을 줬다 — 둘 다 내장 도구 12개뿐이다.
 *
 * **우리 쪽 문제가 아니다.** 참조 MCP 서버(표준 응답의 stdio 서버)를 대조군으로 나란히
 * 세웠는데 **그것도 안 실린다.** 등록 경로 셋(런타임 `POST /mcp` · 프로젝트 설정의 remote ·
 * 같은 설정의 local stdio)이 전부 같은 결과이고, `config.tools` 로 이름을 명시 허용해도
 * 안 바뀐다. **opencode 1.17.18 과 1.18.16 둘 다 그렇다.**
 *
 * **어디서 끊기는지는 모른다.** 설치본은 난독화돼 있고 포크 소스는 버전이 달라, 합치는
 * 코드가 있다는 것까지만 읽힌다. "opencode 버그" 라고 단정하지 않는다 — 우리가 모르는
 * 설정 조건일 수도 있다. 재현 절차·대조군·두 버전 결과는 `_workspace/03_contract_qa.md`
 * 의 12·13회차에 있다.
 *
 * 그래서 **지금 이 값을 켜면 MCP 서버 포트만 열리고 아무 일도 안 일어난다.** 그래도 켜 두는
 * 것은 사용자 결정이고, opencode 쪽이 풀리면 **우리 코드 변경 없이 바로 동작한다.**
 */
export const DEFAULT_DESKTOP_MCP = true

/** UI 표시 언어. 기본 한국어. */
export type Language = 'ko' | 'en' | 'zh'

export interface AppSettings {
  /** 화면 문구 언어. 저장 즉시 리렌더된다. */
  language: Language
  /** 창이 비활성일 때 작업(턴)이 끝나면 OS 알림을 띄울지. */
  taskDoneNotify: boolean
  /**
   * 프로젝트가 opencode 에 붙을 때 **데스크톱 MCP 서버를 자동 등록**할지
   * (`electron/mcp/` — 앱이 MCP **서버**가 되는 쪽이다. `McpDialog` 의 개인 자격 설정과 무관).
   */
  desktopMcp: boolean
  /**
   * 개발자 모드. 로그 보기 등 개발자용 UI 를 노출한다.
   * 설정 화면에는 없다 — 전환 경로는 채팅 이스터에그뿐 (스펙 11_spec_devmode).
   */
  developerMode: boolean
  /**
   * 확장 배포처의 **목록 문서(index.json) 전체 주소**. 여러 개일 수 있다.
   *
   * 앱이 주소 뒤에 무언가 덧붙이지 않는다 (표준 §4.4) — 덧붙이면 배포처가 그 경로를
   * 강제당해 "어디서든 배포처가 될 수 있다" 가 깨진다. 사용자가 넣은 것을 그대로 쓴다.
   */
  extensionRegistries: string[]
  /**
   * 꺼 둔 확장의 **이름**(매니페스트 `name`). 목록에는 남고 실리지만 않는다.
   *
   * 폴더 경로가 아니라 이름으로 적는다 — 확장은 폴더째 복사·심링크로도 설치돼서
   * 같은 확장이 자리를 옮길 수 있고, 그때 꺼 둔 것이 조용히 다시 켜지면 안 된다.
   */
  disabledExtensions: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ko',
  taskDoneNotify: true,
  desktopMcp: DEFAULT_DESKTOP_MCP,
  developerMode: false,
  extensionRegistries: [],
  disabledExtensions: [],
}

/**
 * 신뢰할 수 없는 JSON 을 안전한 모양으로 되돌린다.
 * 항목 하나가 망가져도 나머지는 살린다 — 전부 버리면 사용자가 설정을 잃는다.
 */
export function normalizeSettings(parsed: unknown): AppSettings {
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
  const source = parsed as Record<string, unknown>

  // 예전 설정 파일에 남아 있는 `opencodeUrl` 은 **말없이 버린다** — 위 머리말대로 그 값을
  // 읽는 곳이 이제 없다. 남겨서 되돌려 주면 화면이 저장할 때 다시 실어 보내 영영 산다.
  return {
    language: toLanguage(source['language']),
    taskDoneNotify: toBool(source['taskDoneNotify'], DEFAULT_SETTINGS.taskDoneNotify),
    desktopMcp: toBool(source['desktopMcp'], DEFAULT_SETTINGS.desktopMcp),
    developerMode: toBool(source['developerMode'], DEFAULT_SETTINGS.developerMode),
    extensionRegistries: toRegistries(source['extensionRegistries']),
    disabledExtensions: toNames(source['disabledExtensions']),
  }
}

/**
 * 꺼 둔 확장 이름 목록. 문자열이 아닌 것과 중복을 없앤다.
 *
 * 여기서 이름 모양(`isSafeExtensionName`)까지 보지 않는다 — 이 값은 **경로를 만드는 데
 * 쓰이지 않고** 이름 비교에만 쓰이기 때문이다. 경로가 되는 자리(삭제)에서 따로 검사한다.
 */
function toNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    seen.add(raw.trim())
  }
  return [...seen]
}

/**
 * 배포처 주소 목록. `http`/`https` 만 남기고 중복을 없앤다.
 *
 * 여기서 거르는 이유: 이 값은 **앱이 직접 fetch 하는 주소**다. `file:` 이 살아 있으면
 * 설정 파일 한 줄로 로컬 파일을 읽게 만들 수 있다 (`registryIndex.ts` 의 같은 판단).
 * 순서는 사용자가 넣은 순서를 지킨다 — 목록에서 그 순서로 보인다.
 */
function toRegistries(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.extensionRegistries]

  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const url = raw.trim()
    if (url === '' || seen.has(url)) continue
    try {
      const { protocol } = new URL(url)
      if (protocol !== 'http:' && protocol !== 'https:') continue
    } catch {
      continue
    }
    seen.add(url)
    kept.push(url)
  }
  return kept
}

/** 불리언이 아니면 기본값. 설정 파일이 망가져도 토글 하나 때문에 전부 잃지 않게. */
function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 아는 언어 코드가 아니면 기본값(한국어). */
function toLanguage(value: unknown): Language {
  return value === 'en' || value === 'zh' || value === 'ko' ? value : DEFAULT_SETTINGS.language
}
