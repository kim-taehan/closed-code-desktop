// opencode 서버 주소 해석.
//
// davis 시절엔 포트 8000~8099 를 훑어 인스턴스 파일로 런타임을 **찾았다**(`electron/runtime/locator`).
// opencode 는 사용자가 `--port` 로 띄운 한 곳에 붙을 뿐이라 탐색이 없다 — 주소를 안다.
// 그래도 화면·진단이 host/port 모양을 기대하므로 같은 형태로 돌려준다.

export const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096'

export interface OpencodeEndpoint {
  host: string
  port: number
  /** 어디서 왔는지 — 진단 화면이 그대로 보여준다 */
  source: string
}

export function opencodeEndpoint(url?: string): OpencodeEndpoint {
  const parsed = new URL(url ?? DEFAULT_OPENCODE_URL)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    source: 'opencode',
  }
}
