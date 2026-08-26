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
// WebSocket URL 조립(`toWebSocketUrl`)도 2026-08-24 에 사라졌다. 앱 코드에는 davis WS 를
// 여는 곳이 없고 — 확장 질의 레인이 없어졌다 (설계 2026-08-13: 확장은 사용자 대화의 턴으로
// 묻는다) — 마지막 호출자였던 `tests/smoke/*` 가 이미 죽어 있었다 (없어진 API 를 import 해
// 환경변수를 채워도 못 돌았다). 남은 것은 **주소를 담는 모양** 하나뿐이다.
//
// 그 모양은 아직 살아 있다: `runtime/diagnostics.ts` 의 `diagnose()` 가 이걸 받고,
// `ipc/bridge.ts` → `window.davis.diagnose()` → `src/state/connectionProbe.ts` 로
// 화면까지 이어진다. 진단 표면이 opencode 쪽으로 옮겨가면 이 파일도 같이 없어진다.

export interface RuntimeEndpoint {
  host: string
  port: number
  /** 어디서 찾았는지 — 실패 화면에 그대로 보여준다 */
  source: string
}
