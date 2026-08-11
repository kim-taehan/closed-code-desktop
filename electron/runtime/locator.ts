// opencode 서버의 주소 표현.
//
// **davis 시절엔 여기가 "런타임을 찾는" 계층이었다** — 포트 8000~8099 의 인스턴스 파일을
// 훑어(`instanceScanner`) 우리가 띄운 것을 골라내는 탐색기들이 있었다. opencode 는
// 사용자가 띄운 한 곳에 붙을 뿐이라(`electron/opencode/endpoint.ts`) 탐색이 통째로 사라졌고,
// 남은 것은 **주소를 담는 모양**과 WebSocket URL 조립뿐이다.
//
// `toWebSocketUrl` 은 아직 davis WS 를 여는 확장 질의 레인(`agentLane/askAgent.ts`)만 쓴다.
// 그 레인이 opencode 로 옮겨가면 이 파일도 같이 없어진다.

export interface RuntimeEndpoint {
  host: string
  port: number
  /** 어디서 찾았는지 — 실패 화면에 그대로 보여준다 */
  source: string
}

/** WebSocket URL 을 만든다. csid 는 클라이언트가 생성해 넘긴다. */
export function toWebSocketUrl(endpoint: RuntimeEndpoint, csid: string): string {
  return `ws://${endpoint.host}:${endpoint.port}/ws?csid=${encodeURIComponent(csid)}`
}
