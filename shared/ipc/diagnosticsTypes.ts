// 연결 진단 페이로드.
// channels.ts 가 300줄을 넘어 갈라냈다 — 채널 정의와 진단 타입은 함께 자랄 이유가 없다.

export interface ServerProbePayload {
  /** 확인할 opencode 서버 주소. 비우면 저장된 값을 쓴다 —
   *  입력창에서 주소를 바꾸고 확인하면 **그 바뀐 값**으로 봐야 한다. */
  opencodeUrl?: string
}

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

