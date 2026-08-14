// 연결 진단 페이로드.
// channels.ts 가 300줄을 넘어 갈라냈다 — 채널 정의와 진단 타입은 함께 자랄 이유가 없다.

// `ServerProbePayload { opencodeUrl? }` 가 여기 있었다. **프로브는 이제 아무것도 안 받는다** —
// 화면이 주소를 바꿔 저장 전에 확인하던 흐름이 통째로 없어졌고(설정 항목이 사라졌다,
// `shared/settings/appSettings.ts` 머리말), 볼 대상은 **활성 프로젝트의 서버** 하나로 정해진다.

export interface ModelCheckResultPayload {
  ok: boolean
  message: string
}

export interface DiagnosticCheckPayload {
  ok: boolean
  detail: string
}

/** desktop → opencode 서버 직접 ping 결과 */
export interface ServerPingResultPayload {
  ok: boolean
  detail: string
}

export interface DiagnosticsPayload {
  endpoint: { host: string; port: number } | null
  /** opencode 서버 도달 여부 (구 runtime) */
  runtime: DiagnosticCheckPayload
}

