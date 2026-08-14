// opencode 서버 주소 해석.
//
// davis 시절엔 포트 8000~8099 를 훑어 인스턴스 파일로 런타임을 **찾았다**(`electron/runtime/locator`).
// 여기에는 탐색이 없다. 한동안 그 이유는 "사용자가 `--port` 로 띄운 한 곳에 붙기 때문" 이었고,
// **지금은 우리가 띄우기 때문**이다 (`serverPool.ts`) — 포트를 opencode 가 고르고 그 값을
// stdout 한 줄로 알려 주므로 (`serverProcess.ts`), 이 파일에 오는 시점엔 주소가 이미 정해져 있다.
// 그래도 화면·진단이 host/port 모양을 기대하므로 같은 형태로 돌려준다.
//
// **기본 주소가 없다.** 예전에는 `opencodeUrl` 이 비면 `127.0.0.1:4096` 으로 물러났는데,
// 서버마다 포트가 다른 지금 그 물러남은 **남의 서버에 붙는 것**이다. 주소는 반드시 받는다.

export interface OpencodeEndpoint {
  host: string
  port: number
  /** 어디서 왔는지 — 진단 화면이 그대로 보여준다 */
  source: string
}

export function opencodeEndpoint(url: string): OpencodeEndpoint {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    source: 'opencode',
  }
}
