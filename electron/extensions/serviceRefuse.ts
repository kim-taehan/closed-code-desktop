import type { ExtensionStorage } from './storageStore'

// **배선을 빠뜨렸을 때 무엇으로 대신하는가.** `serviceDispatch.ts` 에서 갈라냈다 —
// 저쪽이 300줄 상한에 닿았고, 자리도 여기가 맞다: 저쪽은 **확장의 부름을 수행**하고
// 이쪽은 **수행할 수 없을 때 무엇을 말하나**다.
//
// 관통하는 규칙 하나: **조용히 성공한 척하지 않는다.** 취소(`null`)나 빈 값으로 눙치면
// 확장은 「사람이 창을 닫았다」·「못 찾았다」로 읽고 아무 말 없이 빈 산출물을 낸다 —
// 사용자에게는 **아무리 눌러도 아무 일이 없는데 사유가 어디에도 안 남는** 상태가 된다.
// 그래서 전부 사유를 담아 던진다.
//
// 예외가 하나 있다: `activeFile` 은 거절 함수를 두지 않는다. 「안 보고 있다」가 정상 답이라
// 거절과 구분되지 않기 때문이다 (`DispatchPorts.activeFile` 주석).

/**
 * 확장이 만든 문서를 내보낸다. 저장한 경로 · 취소면 `null` · 실패면 던진다.
 *
 * 함수 하나로 받는 이유는 `workspace` 와 같다 — 이 파일이 `electron` 을 모르게 두려는 것이다.
 * 저장 대화상자는 창을 쥔 쪽(`main.ts`)만 띄울 수 있다.
 */
export type ExtensionExportFile = (fileName: string, text: string) => Promise<string | null>

/**
 * 내보내기가 배선되지 않은 서비스의 기본값.
 *
 * **조용히 `null`(취소)을 돌려주지 않는다.** 그러면 확장은 "사용자가 창을 닫았다" 로 알고
 * 아무 말도 하지 않아, 아무리 눌러도 파일이 안 생기는데 사유가 어디에도 안 남는다.
 */
export function refuseExport(): Promise<never> {
  return Promise.reject(new Error('이 앱에는 내보내기가 배선되지 않았습니다'))
}

/**
 * 사람에게 글을 묻는다. 답 · 취소면 `null` · 창이 없으면 던진다.
 *
 * `exportFile` 과 같은 이유로 함수 하나로 받는다 — 이 파일이 `electron` 을 모르게 둔다.
 * 창을 쥔 쪽만 물을 수 있다.
 */
export type ExtensionAskText = (options: {
  /** 창에 뜨는 **사람이 읽는** 확장 이름 (`displayName`). 저장소 열쇠가 아니다 */
  label: string
  title: string
  hint?: string
  value: string
  multiline: boolean
}) => Promise<string | null>

/**
 * 물음 통로가 배선되지 않았을 때.
 *
 * **조용히 `null`(취소)을 돌려주지 않는다.** 그러면 확장은 "사람이 창을 닫았다" 로 알고
 * 아무 말도 하지 않아, 아무리 눌러도 창이 안 뜨는데 사유가 어디에도 안 남는다
 * (`refuseExport` 와 같은 규칙).
 */
export function refuseAskText(): Promise<never> {
  return Promise.reject(new Error('이 앱에는 확장 물음창이 배선되지 않았습니다'))
}

/**
 * 에이전트가 없을 때의 기본값.
 *
 * **열린 프로젝트가 없거나 세션이 아직 안 붙었으면 물을 곳이 없다.** 빈 문자열을 돌려주면
 * 확장은 "에이전트가 아무것도 못 찾았다" 로 읽고 빈 산출물을 낸다 — 사유가 어디에도
 * 안 남는다.
 */
export function refuseAsk(): Promise<never> {
  return Promise.reject(new Error('코드 어시스턴트에 연결돼 있지 않습니다 — 프로젝트를 열고 연결을 확인하세요'))
}

/**
 * 저장소가 배선되지 않았을 때.
 *
 * **읽기를 빈 값으로 눙치지 않는다.** 그러면 확장은 "저장된 것이 없다" 로 읽고 처음부터
 * 다시 만들며, 쓰기도 조용히 사라져 사용자에게는 "저장이 안 된다" 로만 보인다.
 */
export const REFUSE_STORAGE: ExtensionStorage = {
  get: () => Promise.reject(new Error('이 앱에는 확장 저장소가 배선되지 않았습니다')),
  set: () => Promise.reject(new Error('이 앱에는 확장 저장소가 배선되지 않았습니다')),
}

