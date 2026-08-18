// 트리 뷰(`contributes.views[].kind === 'tree'`)가 주고받는 모양.
//
// `extensionPayloads.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았고, 트리 마디는
// 칸이 계속 느는 자리라(`detail`·`section` 이 뒤에 붙었다) 앞으로도 자란다.
// **그쪽에서 그대로 다시 내보내므로 부르는 쪽은 아무것도 안 고쳐도 된다.**

/**
 * 트리의 마디 하나.
 *
 * **잎(children 이 없는 것)만 고를 수 있다.** 가지를 고르면 그 아래 잎이 전부 딸려온다 —
 * 가지 자체를 값으로 넘기면 확장이 "폴더" 와 "그 안의 파일들" 을 둘 다 다뤄야 한다.
 *
 * `id` 가 명령에 실려 나가는 값이다 (`ExtensionRunCommandPayload.selection`).
 */
export interface ExtensionTreeNodePayload {
  id: string
  label: string
  /**
   * 이름 **밑에** 흐리게 붙는 한 줄. 경로처럼 이름만으로는 어느 것인지 못 가리는 것.
   *
   * 예전에는 경로가 `title` 툴팁에만 있었다 — 이름이 겹치는 화면이 둘이면
   * (`목록 조회` 가 셋인 프로젝트가 실제로 있다) 마우스를 얹기 전에는 못 가린다.
   * 툴팁은 마우스가 없는 사람에게는 없는 것과 같기도 하다.
   */
  detail?: string
  /**
   * 이 가지가 **접히지 않는 구획**인가.
   *
   * 폴더 트리의 가지는 접을 수 있어야 한다 — 903줄짜리가 통째로 펼쳐지면 어디서
   * 시작할지 알 수 없다. 그런데 **상태로 가른 무리**(「미작성」·「작성완료」)는 성격이
   * 다르다: 개수가 적고, 접으면 이 확장을 여는 이유인 「무엇이 비었나」가 통째로
   * 사라진다. 그런 가지는 꺾쇠도 체크박스도 없이 **라벨과 개수만** 그리고 늘 펼친다.
   *
   * 무엇이 폴더고 무엇이 구획인지는 확장만 안다 — 그래서 데이터로 받는다
   * (`action` 과 같은 규칙).
   */
  section?: boolean
  /** 오른쪽 끝에 붙는 짧은 표시. 이미 만든 결과의 건수 같은 것. */
  badge?: string
  /**
   * 이 줄에만 붙는 버튼. 누르면 그 마디 하나를 골라 `command` 를 돌린다.
   *
   * **확장별 특례를 앱에 넣지 않으려고 데이터로 받는다** — 「이 API 의 결과를 본다」 같은
   * 것은 줄마다 대상이 다르므로 위쪽 명령 줄의 버튼으로는 표현할 수 없다.
   * `command` 는 매니페스트에 선언하지 않아도 된다 — 선언하면 위쪽에 큰 버튼으로도 뜬다.
   */
  action?: { label: string; command: string }
  /**
   * 이 줄이 **지금 어떤 상태인가**. 없으면 아무것도 안 그린다.
   *
   * 진행과 대상이 서로 남남이던 자리다 — 바닥 진행 칸은 「비상 로그인이 도는 중」이라고
   * 말하는데 정작 그 줄이 트리의 어디인지는 화면이 말하지 않았다. 어느 대상이 도는지·
   * 남았는지·터졌는지를 아는 것은 확장뿐이라 데이터로 받는다 (`action` 과 같은 규칙).
   *
   * `badge`(쓴 건수)와 **함께 오지 않는다**: 끝난 줄은 배지가, 안 끝난 줄은 이쪽이 말한다.
   */
  state?: ExtensionTreeNodeState
  children?: ExtensionTreeNodePayload[]
}

/** 아직 안 끝난 줄의 형편. 끝난 줄은 `badge` 로 말한다. */
export type ExtensionTreeNodeState = 'waiting' | 'running' | 'failed'


/** 한 뷰의 트리 전체. 행·화면과 같이 **통째 교체**다. */
export interface ExtensionTreePayload {
  viewId: string
  nodes: ExtensionTreeNodePayload[]
}
