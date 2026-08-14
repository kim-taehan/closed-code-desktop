// opencode 서버의 주소 표현.
//
// **davis 시절엔 여기가 "런타임을 찾는" 계층이었다** — 포트 8000~8099 의 인스턴스 파일을
// 훑어(`instanceScanner`) 우리가 띄운 것을 골라내는 탐색기들이 있었다. 탐색은 통째로
// 사라졌고 남은 것은 **주소를 담는 모양**과 WebSocket URL 조립뿐이다.
//
// 사라진 이유가 한 번 바뀌었다. 처음에는 *"사용자가 띄운 한 곳에 붙을 뿐이라"* 였는데,
// 지금은 **우리가 띄우면서 그 프로세스가 주소를 직접 알려 주기 때문**이다
// (`opencode/serverProcess.ts` 의 stdout 한 줄). 어느 쪽이든 훑을 것이 없다.
//
// `toWebSocketUrl` 은 이제 **스모크 테스트만** 쓴다 — 확장 질의 레인이 없어졌다
// (설계 2026-08-13: 확장은 사용자 대화의 턴으로 묻는다). 앱 코드에는 davis WS 를 여는 곳이 없다.
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
