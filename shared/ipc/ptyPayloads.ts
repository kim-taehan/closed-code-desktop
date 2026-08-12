// 셸 드로어가 오가는 값들. 이 레포 관례대로 **payload 객체 + 타입**이지 위치 인자가 아니다.
//
// projectId 가 어디에도 없다 — 드로어는 활성 프로젝트의 것이고, 그 판정은 main 이 한다
// (`electron/pty/drawerBridge.ts`). main → renderer 로 나가는 것만 `ProjectScoped` 겉봉을
// 쓴다: 프로젝트를 옮기는 순간 도착한 이전 프로젝트의 출력이 화면에 섞이면 안 된다.

/** 드로어를 편 결과. 실패 사유는 그대로 화면에 뜬다 — 빈 터미널만 보이면 사용자가 자기 탓으로 여긴다. */
export interface PtyOpenResult {
  ok: boolean
  error?: string
}

/** 사용자가 누른 키. **원시 바이트다** — JSON 봉투로 감싸면 그 JSON 이 셸에 타이핑된다 (실측). */
export interface PtyInputPayload {
  data: string
}

export interface PtyResizePayload {
  rows: number
  cols: number
}

/**
 * 드로어에서 떠난다 — **떠나는 쪽이 자기 신원을 말한다.**
 *
 * 다른 요청과 달리 여기만 projectId 가 실린다. 이 프레임이 나가는 유일한 경로가
 * **프로젝트를 옮길 때**인데, 그 시점에 main 의 활성 프로젝트는 **이미 옮겨 간 쪽**이다.
 * 신원을 안 실으면 main 이 "떠나온 A" 대신 "도착한 B" 를 정리해서, A 의 소켓이 안 닫히고
 * 표에 남는다 — 옮겨 다닐수록 쌓인다 (design-audit 경고 2).
 *
 * 나가는 프레임에 겉봉을 씌운 것과 같은 이유다: 어느 프로젝트 것인지를 **보내는 쪽이 안다.**
 */
export interface PtyDetachPayload {
  projectId: string
}

export interface PtyDataPayload {
  chunk: string
}

/** 셸이 끝났다. 코드를 못 읽었으면 null (pty 가 이미 사라진 경우). */
export interface PtyExitPayload {
  exitCode: number | null
}
