import { Action, Kind } from '../../shared/protocol/kinds'

// 어댑터 실패를 davis 봉투로 옮긴다.
//
// `transport.ts` 에서 갈라냈다 (300줄 상한). 프레임을 만들기만 하고 누구에게도 밀지 않는다 —
// 미는 것과 어댑터 상태(streamId·에러 핸들러)는 `transport.ts` 가 그대로 쥔다.

/** 어댑터가 내는 실패의 단일 코드. 위층은 이 값으로 렌더 분기를 하지 않는다 (문구만 쓴다). */
const ERROR_CODE = 'OPENCODE_ERROR'

/**
 * 실패를 **화면까지** 올릴 프레임들.
 *
 * onError 로만 알리면 아무도 듣지 않는 자리에서 사라진다. 실제로 세션 생성이 조용히
 * 실패했을 때 증상이 "핸드셰이크는 ready 인데 채팅 무응답" 으로만 나타나 추적이 어려웠다.
 * 진행 중인 턴이 있으면(`streamId` 가 살아 있으면) stream_end 까지 내려 진행 표시기가
 * 영원히 돌지 않게 한다.
 */
export function failureFrames(
  kind: string,
  message: string,
  streamId: string | null,
): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [
    { kind, action: Action.ERROR, data: { code: ERROR_CODE, message } },
  ]
  if (streamId) {
    frames.push({
      kind: Kind.CHAT,
      action: Action.STREAM_END,
      data: { failed: true, errorCode: ERROR_CODE },
      streamId,
    })
  }
  return frames
}
