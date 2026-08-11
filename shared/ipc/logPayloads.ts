// 로그 창이 주고받는 것들.
//
// 페이로드를 channels.ts 에 두지 않는 이유는 그 파일이 300줄 상한에 거의 닿아서다.
// projectPayloads.ts · searchPayloads.ts 가 같은 이유로 갈라져 나갔다.

/** runtime 이 뱉은 것과 데스크탑이 뱉은 것. 한 번에 하나만 본다. */
export type LogSource = 'runtime' | 'desktop'

export interface LogEntry {
  /** 들어온 순서. 화면에서 key 로 쓴다 — 같은 밀리초에 여러 줄이 들어온다. */
  seq: number
  at: number
  source: LogSource
  text: string
}

export interface LogListResult {
  entries: LogEntry[]
}
