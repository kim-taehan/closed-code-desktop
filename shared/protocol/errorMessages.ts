// 에러 코드 → 사용자 문구 카탈로그.
//
// **출처(실측 2026-07-28):** `davis-code-ide-eclipse/davis-code-ide-plugin/web/config/error-messages.json`
// `_version: "1.1.0"`, 코드 **24종**. 같은 내용이 intellij(`src/main/resources/config/`)·
// vscode webview(`webview/shared/config/`)에도 있고 세 파일의 md5 가 같다 (`c48a485b…`).
// ⚠️ `davis-code-ide-vscode/src/resources/error-messages.json` 은 **22종 구판**이다
// (`OPENAI_BADREQUEST_IMAGE_UNSUPPORTED`·`OPENAI_BADREQUEST_CONTEXT_EXCEEDED` 없음,
//  `OPENAI_BADREQUEST` 문구도 다르다) — 대조 대상이 아니다.
//
// **JSON 을 복사해 오지 않고 TS 상수로 재선언한다.** 코드값이 runtime 계약에서 오는 값이라
// 이 레포가 계약값을 다루는 방식과 같다 (`turnReview.ts:24 STATUS_LABEL`, `kinds.ts`).
// Electron 패키징에 JSON 리소스 로더가 없다는 실무 이유도 있다.
//
// 코드 대조 규칙은 vscode 의 resolver 와 같다 — **대문자로 정규화한 뒤 조회**하고,
// 없으면 null 을 돌려 호출부의 기존 폴백을 그대로 쓰게 한다
// (`davis-code-ide-vscode/webview/shared/utils/errorMessageResolver.ts:16-20`).

export type ErrorSeverity = 'info' | 'warning' | 'error'

export interface ErrorMessageEntry {
  title: string
  message: string
  severity: ErrorSeverity
}

export const ERROR_MESSAGES: Record<string, ErrorMessageEntry> = {
  OPENAI_BADREQUEST: {
    title: 'AI 모델 요청 오류',
    message: 'AI 모델이 요청을 처리하지 못했습니다. 반복되면 관리자에게 문의하세요.',
    severity: 'warning',
  },
  OPENAI_BADREQUEST_IMAGE_UNSUPPORTED: {
    title: '이미지를 지원하지 않는 모델입니다',
    message: '현재 모델은 이미지를 지원하지 않으니 텍스트로 다시 시도해주세요.',
    severity: 'warning',
  },
  OPENAI_BADREQUEST_CONTEXT_EXCEEDED: {
    title: '대화가 너무 길어졌습니다',
    message: '대화 내용이 모델 처리 한도를 초과했으니 새 채팅으로 다시 시도해주세요.',
    severity: 'warning',
  },
  OPENAI_UNAUTHORIZED: {
    title: 'API 인증 실패',
    message: 'API 키가 유효하지 않거나 만료되었습니다.\n설정에서 API 키를 확인해주세요.',
    severity: 'error',
  },
  OPENAI_TOO_MANY_REQUESTS: {
    title: '요청 한도 초과',
    message: 'API 사용량 한도에 도달했습니다.\n잠시 후(1~2분) 다시 시도해주세요.',
    severity: 'warning',
  },
  OPENAI_HTTPCORE_CONNECTTIMEOUT: {
    title: '서버 연결 시간 초과',
    message: '서버에 연결할 수 없습니다.\n네트워크 연결을 확인하고 다시 시도해주세요.',
    severity: 'warning',
  },
  OPENAI_HTTPCORE_READTIMEOUT: {
    title: '응답 대기 시간 초과',
    message: '서버 응답이 너무 오래 걸리고 있습니다.\n질문을 간결하게 수정하거나 잠시 후 다시 시도해주세요.',
    severity: 'warning',
  },
  OPENAI_APICONNECTIONERROR: {
    title: '네트워크 연결 오류',
    message: '서버에 접속할 수 없습니다.\n네트워크 연결 및 서버 URL을 확인해주세요.',
    severity: 'error',
  },
  OPENAI_INTERNAL_SERVER_ERROR: {
    title: 'AI 서버 오류',
    message: '서버에 일시적인 문제가 발생했습니다.\n잠시 후 다시 시도해주세요. 지속되면 관리자에게 문의하세요.',
    severity: 'warning',
  },
  OPENAI_METHOD_NOT_ALLOWED: {
    title: 'API 설정 오류',
    message: 'API 서버 URL이 잘못 설정되어 있습니다.\n관리자에게 API 설정 확인을 요청해주세요.',
    severity: 'error',
  },
  OPENAI_GRAPHRECURSIONERROR_ERROR: {
    title: '처리 한도 초과',
    message: '작업이 너무 복잡하여 처리 한도를 초과했습니다.\n질문을 단순화하거나 단계별로 나누어 요청해주세요.',
    severity: 'error',
  },
  OPENAI_UNKNOWN_ERROR: {
    title: 'AI 처리 오류',
    message: 'AI 처리 중 알 수 없는 오류가 발생했습니다.\n다시 시도해주세요. 지속되면 관리자에게 문의하세요.',
    severity: 'error',
  },
  STREAM_ERROR: {
    title: '응답 처리 오류',
    message: 'AI 응답을 처리하는 중 문제가 발생했습니다.\n다시 시도해주세요.',
    severity: 'error',
  },
  BAD_REQUEST: {
    title: '잘못된 요청',
    message: '요청 형식이 올바르지 않습니다.\n메시지를 다시 확인하고 전송해주세요.',
    severity: 'warning',
  },
  INTERNAL_ERROR: {
    title: '내부 오류',
    message: '시스템 내부에서 예기치 않은 오류가 발생했습니다.\n새 채팅을 시작해주세요. 지속되면 관리자에게 문의하세요.',
    severity: 'error',
  },
  SERVICE_ERROR: {
    title: '서비스 오류',
    message: '서비스 처리 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.',
    severity: 'error',
  },
  AUTH_REQUIRED: {
    title: '인증이 필요합니다',
    message: '서비스를 사용하려면 먼저 인증이 필요합니다.\n라이선스 키를 입력해주세요.',
    severity: 'info',
  },
  AUTH_INVALID_KEY: {
    title: '인증 실패',
    message: '입력한 라이선스 키가 유효하지 않습니다.\n라이선스 키를 다시 확인해주세요.',
    severity: 'error',
  },
  AUTH_KEY_EXPIRED: {
    title: '라이선스 만료',
    message: '라이선스 키가 만료되었습니다.\n관리자에게 라이선스 갱신을 요청해주세요.',
    severity: 'warning',
  },
  AUTH_DEVICE_LIMIT: {
    title: '기기 수 초과',
    message: '동시 접속 가능한 기기 수를 초과했습니다.\n다른 기기에서 로그아웃하거나 관리자에게 문의하세요.',
    severity: 'warning',
  },
  AUTH_SERVER_UNAVAILABLE: {
    title: '인증 서버 접속 불가',
    message: '인증 서버에 연결할 수 없습니다.\n네트워크 연결을 확인하고 잠시 후 다시 시도해주세요.',
    severity: 'error',
  },
  UNAUTHORIZED: {
    title: '권한 없음',
    message: '이 작업을 수행할 권한이 없습니다.\n인증 정보를 확인하고 다시 로그인해주세요.',
    severity: 'error',
  },
  WORKSPACE_IN_USE: {
    title: '작업 공간 사용 중',
    message: '다른 세션에서 이미 이 프로젝트를 사용 중입니다.\n다른 세션을 종료하거나 잠시 후 다시 시도해주세요.',
    severity: 'warning',
  },
  WORKSPACE_NOT_BOUND: {
    title: '프로젝트 미연결',
    message: '채팅과 연결된 프로젝트가 없습니다.\nIDE에서 프로젝트를 열고 다시 시도해주세요.',
    severity: 'info',
  },
}

/**
 * 카탈로그에 있는 코드면 그 항목을, 없으면 null.
 *
 * **없을 때 default 로 대체하지 않는다** — 호출부가 이미 갖고 있는 폴백(런타임이 준
 * 원문 + 코드)이 카탈로그의 뭉뚱그린 기본 문구보다 진단에 쓸모 있기 때문이다.
 * vscode 는 `getErrorDisplay` 에서 default 를 씌우지만 그쪽은 원문을 message 로 살려 둔다.
 */
export function findErrorMessage(code: string | undefined): ErrorMessageEntry | null {
  if (!code) return null
  return ERROR_MESSAGES[code.toUpperCase()] ?? null
}

/**
 * 심각도별 CSS 클래스 — 전부 같은 빨강으로 그리면 "잠시 후 다시 시도해주세요" 같은
 * 안내가 치명적 오류처럼 보인다. 카탈로그 24종 중 warning 11 · info 2 다.
 *
 * 모르는 심각도는 error 로 둔다 — 모르는 것을 가볍게 보이는 쪽이 더 위험하다.
 */
export function errorTone(severity: ErrorSeverity | undefined): string {
  return `message-error message-error--${severity ?? 'error'}`
}
