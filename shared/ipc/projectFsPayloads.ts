// 프로젝트 파일을 **만들고 옮기고 버리는** 조작 (`project:fsAction`).
//
// 읽기·덮어쓰기는 `channels.ts` 쪽 채널 셋이 이미 진다. 여기 있는 넷은 뒤늦게 생긴 것이고,
// **채널 하나에 갈래로 담는다** — 넷을 따로 두면 `channelNames.ts`(299줄)와
// `preload.ts`(290줄)가 나란히 300줄 상한을 넘는다. 갈래를 나누는 것이 아깝지 않은 이유는
// 넷이 같은 것을 공유해서다: 같은 경계 검사(`resolveInside`)와 같은 결과 모양.
//
// **여기서 하는 일은 파일시스템뿐이다.** 열린 탭·트리를 맞추는 것은 화면 몫이고,
// main 이 그것까지 지면 「지운 파일의 탭을 닫는다」 같은 규칙이 두 곳에 생긴다.

/** 무엇을 하는가. 갈래마다 필요한 값이 달라 판별 유니온으로 둔다. */
export type ProjectFsAction =
  /**
   * 빈 파일을 만든다. **덮어쓰지 않는다** — 같은 이름이 있으면 `exists` 로 돌려준다.
   * 있는 파일을 조용히 비우는 것이 이 조작의 최악이다.
   */
  | { kind: 'newFile'; path: string }
  /**
   * 폴더를 만든다. **부모는 이미 있어야 한다** — 경계를 재는 길이 부모를 실경로로 펴는
   * 것이라(`resolveNewInside`) 그 위는 잴 수가 없다. 우클릭 메뉴는 늘 있는 폴더 위에서
   * 열리므로 실제로 막히는 자리가 아니다.
   */
  | { kind: 'newDir'; path: string }
  /**
   * 이름을 바꾼다(같은 폴더 안) 또는 옮긴다.
   *
   * `to` 도 **프로젝트 루트 기준 상대경로**다 — 이름만 받으면 폴더를 넘나드는 이동을
   * 표현할 수 없고, 「이름에 `/` 를 넣으면 어떻게 되나」가 답이 없는 질문이 된다.
   */
  | { kind: 'rename'; path: string; to: string }
  /**
   * OS 휴지통으로 보낸다. **지우지 않는다** — 되돌릴 수 없는 조작을 앱이 대신 결정하지
   * 않는다. 휴지통이 없는 환경에서는 실패로 돌려주고, 그때도 파일은 그대로 남는다.
   */
  | { kind: 'trash'; path: string }

export interface ProjectFsActionPayload {
  projectId: string
  action: ProjectFsAction
}

/**
 * 결과.
 *
 * `reason` 은 **코드값**이고 사람 말로 옮기는 것은 화면 몫이다 — 이 레포의 다른 결과
 * 타입과 같은 규칙이다 (`WriteFileResult`·`ExtensionUninstallResult`).
 *
 * - `not_allowed` — 루트 밖을 가리켰다. 경계 위반이라 사유를 더 밝히지 않는다
 * - `exists` — 같은 이름이 이미 있다 (`newFile`·`newDir`·`rename`)
 * - `missing` — 옮기거나 버릴 것이 없다
 * - `failed` — 그 밖의 실패. 원문은 `detail` 에 담는다
 */
export type ProjectFsResult =
  | { ok: true }
  | { ok: false; reason: 'not_allowed' | 'exists' | 'missing' | 'failed'; detail?: string }
