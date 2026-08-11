import type { RuntimeEndpoint } from './locator'
import { pingOpencode } from '../opencode/probe'

// 연결 진단. "왜 안 되는지" 를 사용자가 직접 확인할 수 있게 모아 준다.
//
// **davis 때는 셋(런타임·Admin·LLM)을 봤다.** 런타임이 중앙 서버에 붙어 설정을 받았는지,
// 그 설정으로 LLM 에 닿는지가 따로 확인해야 할 문제였기 때문이다.
// opencode 에는 중앙 서버가 없고 모델은 서버 설정 파일이 정한다 — 여기서 볼 것은
// **서버가 떠 있는가** 하나뿐이고, 모델은 Doctor 2단계(`opencode/probe.ts`)가 따로 본다.
//
// 필드 이름 `runtime` 은 IPC 계약이라 남겨 둔다 (의미는 "opencode 서버").

export interface DiagnosticCheck {
  ok: boolean
  /** 화면에 그대로 보여줄 한 줄 */
  detail: string
}

export interface Diagnostics {
  endpoint: { host: string; port: number } | null
  runtime: DiagnosticCheck
}

export function noEndpointDiagnostics(): Diagnostics {
  return {
    endpoint: null,
    runtime: { ok: false, detail: '연결할 서버 주소가 없습니다' },
  }
}

export async function diagnose(endpoint: RuntimeEndpoint): Promise<Diagnostics> {
  const where = { host: endpoint.host, port: endpoint.port }
  const result = await pingOpencode(`http://${endpoint.host}:${endpoint.port}`)
  return { endpoint: where, runtime: result }
}
