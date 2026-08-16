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

/**
 * **이 프로젝트의 서버를 우리가 띄웠나.**
 *
 * `running: false` 는 "그 주소가 죽었다" 가 아니라 **"우리 표에 없다"** 는 뜻이다.
 * 화면은 그때 「다시 시작」이 아니라 「서버 시작」을 준다 — 우리가 안 띄운 프로세스는
 * 죽일 수 없기 때문이다 (`electron/opencode/serverPool.ts` 의 `statusOf`).
 */
export interface ServerStatusPayload {
  running: boolean
  url: string | null
  pid: number | null
}

/** 서버 조작. 「시작」과 「다시 시작」은 화면 문구가 갈릴 뿐 같은 길로 간다. */
export interface ServerControlPayload {
  action: 'start' | 'restart' | 'stop'
}

export interface ServerControlResultPayload {
  ok: boolean
  /** 실패 사유. **버리면 원인을 알 길이 없다** — 화면에 그대로 올린다 */
  error?: string
  /** 조작 뒤 상태. 화면이 곧바로 다시 그린다 */
  status: ServerStatusPayload
}

export interface DiagnosticsPayload {
  endpoint: { host: string; port: number } | null
  /** opencode 서버 도달 여부 (구 runtime) */
  runtime: DiagnosticCheckPayload
}

