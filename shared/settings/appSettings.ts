// 앱 전역 설정. 지금까지 환경변수로만 받던 것들을 사용자가 바꿀 수 있게 한다.
//
// 해석 순서는 **설정 > 환경변수 > 기본값** 이다 (설계 §4.1 과 같은 원칙).
// 환경변수를 아래에 두는 이유는 개발 중 쓰는 방식이라 깨지면 안 되고,
// 동시에 사용자가 화면에서 지정하면 그게 이겨야 하기 때문이다.

/** opencode 서버 기본 주소. `opencode serve` 의 기본 포트다. */
export const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096'

/** UI 표시 언어. 기본 한국어. */
export type Language = 'ko' | 'en' | 'zh'

export interface AppSettings {
  /** 붙을 opencode 헤드리스 서버. 비우면 기본값(127.0.0.1:4096)을 쓴다. */
  opencodeUrl: string
  /** 화면 문구 언어. 저장 즉시 리렌더된다. */
  language: Language
  /** 창이 비활성일 때 작업(턴)이 끝나면 OS 알림을 띄울지. */
  taskDoneNotify: boolean
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
  opencodeUrl: DEFAULT_OPENCODE_URL,
  language: 'ko',
  taskDoneNotify: true,
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

  const opencode = source['opencodeUrl']
  return {
    // 빈 문자열은 "기본값 사용" 이다 — 여기서 기본값으로 되돌려 소비처가 분기하지 않게 한다
    opencodeUrl:
      typeof opencode === 'string' && opencode.trim() !== '' ? opencode.trim() : DEFAULT_OPENCODE_URL,
    language: toLanguage(source['language']),
    taskDoneNotify: toBool(source['taskDoneNotify'], DEFAULT_SETTINGS.taskDoneNotify),
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
