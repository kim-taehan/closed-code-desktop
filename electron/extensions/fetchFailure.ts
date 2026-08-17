// 배포처를 상대하다 난 실패를 **사용자가 할 일이 다른 둘**로 가른다.
//
// `registryFetch`·`registryReadmeFetch`·`packageDownload` 가 글자 단위로 같은 판정을 각자
// 들고 있었다 (2026-08-17 정리). 배포처로 나가는 길이 셋이라 셋 다 같은 실패를 겪는데,
// 사본이 갈라지면 **같은 고장이 화면마다 다른 말로 보인다** — 사용자는 그 차이를 설명할
// 길이 없다.
//
// **이름은 부르는 쪽이 정한다.** 세 모듈의 실패 유니온이 각각 다르지만
// (`write_failed`·`too_large`·`invalid_json`) 셋 다 `timeout`·`unreachable` 을 갖고 있어,
// 좁은 유니온을 돌려주면 그대로 담긴다. 이 파일은 그 둘만 알고 나머지는 모른다.

import { describeError } from '../../shared/errors/describeError'

/**
 * 시간 초과와 아예 못 닿는 것을 가른다. **뭉치면 안 된다** — 사용자가 할 일이 다르다
 * (기다렸다 다시 / 주소·망 확인).
 *
 * `detail` 이 갈래마다 다른 것도 그래서다: 시간 초과는 **얼마를 기다렸나**가 알 것의
 * 전부고, 못 닿은 쪽은 런타임이 준 사유가 유일한 단서다.
 */
export function networkFailure(
  error: unknown,
  timeoutMs: number,
): { ok: false; reason: 'timeout' | 'unreachable'; detail: string } {
  return isTimeout(error)
    ? { ok: false, reason: 'timeout', detail: `${timeoutMs}ms` }
    : { ok: false, reason: 'unreachable', detail: describeError(error) }
}

/**
 * 두 이름을 다 받는다. **세 사본이 그랬던 그대로 옮긴 것이고, 왜 둘인지는 이 정리에서
 * 재지 않았다** — 지금 초록인 시험들이 겨누는 것도 판정 결과지 이름의 출처가 아니다.
 */
function isTimeout(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    ((error as { name?: unknown }).name === 'TimeoutError' ||
      (error as { name?: unknown }).name === 'AbortError')
  )
}
