// 오래 걸리는 명령이 **살아 있음과 어디까지 왔는지**를 말하는 통로의 모양.
//
// `extensionPayloads.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다. 한 줄짜리 알림이던
// 것이 「쌓을 줄 / 스쳐 갈 줄」과 「겹쳐 도는 갈래」를 함께 실으면서 혼자 자란 갈래다.
// 저쪽이 그대로 다시 내보내므로 부르는 쪽은 어느 파일에서 오는지 몰라도 된다.

/**
 * 오래 걸리는 명령이 알리는 진행 상황 한 줄.
 *
 * `text` 가 `null` 이면 **지운다**(끝났다). `done`/`total` 은 있을 때만 분수로 그린다 —
 * 끝을 모르는 단계에서 퍼센트를 지어내지 않는다.
 */
export interface ExtensionProgressPayload {
  /**
   * 낸 확장의 매니페스트 `name`. **보는 확장의 것만 그리라고 있는 칸이다.**
   *
   * 없으면 남의 문구가 내 바에 찍힌다 — `redraw` 는 켜진 확장 **전부**를 돌리므로
   * (`extensionLoader.ts` 의 `redraws`), 테스트 시나리오를 보는 중에 현행분석의
   * 「analyzer(…) 에서 실행을 찾는 중…」이 그 자리에 떴다.
   *
   * `setRows` 의 `viewId` 와 같은 자리다. 뷰 id 가 아니라 확장 이름인 것은
   * `davis.progress` 가 뷰를 받지 않기 때문이다 — 확장 하나에 한 줄이다.
   */
  extension: string
  text: string | null
  done?: number
  total?: number
  /**
   * 이 소식의 성격. **쌓을 줄과 스쳐 갈 줄을 가른다.**
   *
   * 없거나 `step` 이면 지금 줄을 갈아치운다 (분수 갱신·「…하는 중」). 나머지는 **쌓인다** —
   * 대상 하나가 끝났다는 소식은 다음 줄이 왔다고 사라지면 안 된다. 수 분짜리 작업에서
   * 자리를 비웠다 돌아오면 그것만이 「무엇이 됐고 무엇이 실패했나」의 답이다.
   */
  kind?: ExtensionProgressKind
  /**
   * **지금 겹쳐 도는 것들.** 주면 화면이 레인 칸을 그리고, 없으면 안 그린다.
   *
   * 한 줄로는 겹쳐 도는 일을 말할 수 없다 — 확장이 넷을 동시에 돌리면 그중 하나밖에
   * 못 적는다. 어느 확장이 몇 갈래로 도는지는 그 확장만 알므로 여기로 실어 온다.
   */
  lanes?: ExtensionProgressLane[]
}

/** 쌓이는 줄(`done`·`fail`·`note`)과 스쳐 가는 줄(`step`). */
export type ExtensionProgressKind = 'step' | 'done' | 'fail' | 'note'

/** 겹쳐 도는 갈래 하나. */
export interface ExtensionProgressLane {
  /** 사람이 읽는 대상 이름 */
  name: string
  /** 그 대상에 대해 **지금** 하고 있는 일 (「읽는 중」). 없으면 안 그린다 */
  doing?: string
  /**
   * 시작 시각 (epoch ms).
   *
   * **경과가 아니라 시각이다** — 경과를 실어 보내면 확장이 밀 때만 갱신되어 화면에서
   * 멈춘 것처럼 보인다 (실측 불만: *"시간도 멈춰있어"*). 세는 일은 화면이 한다.
   */
  startedAt: number
}

