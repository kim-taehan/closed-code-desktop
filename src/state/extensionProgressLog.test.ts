import { describe, expect, it } from 'vitest'
import { applyProgressLine, linesOf, LOG_KEEP, type ExtensionProgressLog } from './extensionProgressLog'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'

// **무엇이 쌓이고 무엇이 스쳐 가나.**
//
// 사이드바의 진행 표시는 한 줄이라 다음 줄이 오면 앞 줄이 사라졌다. 수 분~한 시간 도는
// 명령에서 그것은 자리를 비웠다 돌아왔을 때 **아무것도 안 남는다**는 뜻이다.
//
// 가르는 것은 확장이다 (`kind`). 여기서 글을 보고 짐작하지 않는다 — 「…하는 중」과
// 「대상 하나가 끝났다」의 수명 차이를 아는 것은 그것을 낸 쪽뿐이다.

const of = (extension: string, text: string | null, kind?: ExtensionProgressPayload['kind']) =>
  ({ extension, text, ...(kind === undefined ? {} : { kind }) }) satisfies ExtensionProgressPayload

/** 여러 줄을 차례로 흘려 넣는다. 시각은 1씩 는다 */
function feed(payloads: ExtensionProgressPayload[], from: ExtensionProgressLog = {}): ExtensionProgressLog {
  return payloads.reduce((log, payload, at) => applyProgressLine(log, payload, at), from)
}

describe('쌓이는 줄만 모은다', () => {
  it('done·fail·note 는 쌓인다 — 무엇이 됐고 무엇이 실패했는지의 답이 이것뿐이다', () => {
    const log = feed([
      of('ts', '로그인 — 6건', 'done'),
      of('ts', '문서 업로드 — 실패', 'fail'),
      of('ts', '고른 대상 15개', 'note'),
    ])

    expect(linesOf(log, 'ts').map((one) => one.text)).toEqual([
      '로그인 — 6건',
      '문서 업로드 — 실패',
      '고른 대상 15개',
    ])
  })

  it('step 과 성격 없는 줄은 안 쌓인다 — 그 글은 「지금 한 줄」이 이미 말한다', () => {
    const log = feed([of('ts', '화면을 찾는 중…', 'step'), of('ts', '엔드포인트를 찾는 중…')])

    expect(linesOf(log, 'ts')).toEqual([])
  })

  it('상한을 넘으면 오래된 것부터 버린다 — 전부 보는 자리는 본문 탭이다', () => {
    const log = feed(Array.from({ length: LOG_KEEP + 5 }, (_, at) => of('ts', `${at}번`, 'done')))

    const lines = linesOf(log, 'ts')
    expect(lines).toHaveLength(LOG_KEEP)
    expect(lines[0]!.text).toBe('5번')
    expect(lines[lines.length - 1]!.text).toBe(`${LOG_KEEP + 4}번`)
  })

  it('확장마다 따로 쌓는다 — `redraw` 는 켜진 확장 전부를 돌린다', () => {
    const log = feed([of('ts', '로그인 — 6건', 'done'), of('current-analysis', '훑기 끝', 'done')])

    expect(linesOf(log, 'ts').map((one) => one.text)).toEqual(['로그인 — 6건'])
    expect(linesOf(log, 'current-analysis').map((one) => one.text)).toEqual(['훑기 끝'])
  })
})

describe('판이 끝나고 다시 시작할 때', () => {
  it('끝나도(text: null) 지우지 않는다 — 지우면 돌아온 사람에게는 아무 일도 없던 것과 같다', () => {
    const log = feed([of('ts', '로그인 — 6건', 'done'), of('ts', null)])

    expect(linesOf(log, 'ts').map((one) => one.text)).toEqual(['로그인 — 6건'])
  })

  it('끝난 뒤 새 줄이 오면 **거기서** 비운다 — 두 판이 섞이면 사람이 가릴 수 없다', () => {
    const log = feed([
      of('ts', '지난 판 — 6건', 'done'),
      of('ts', null),
      of('ts', '이번 판 — 3건', 'done'),
    ])

    expect(linesOf(log, 'ts').map((one) => one.text)).toEqual(['이번 판 — 3건'])
  })

  it('안 끝난 확장의 줄은 이어 쌓는다', () => {
    const log = feed([of('ts', '첫째 — 6건', 'done'), of('ts', '둘째 — 3건', 'done')])

    expect(linesOf(log, 'ts')).toHaveLength(2)
  })

  it('한 번도 안 온 확장에 끝났다만 오면 아무 일도 없다', () => {
    expect(feed([of('ts', null)])).toEqual({})
  })

  it('없는 확장을 물으면 빈 배열이다 — 부르는 쪽이 undefined 를 가르지 않게', () => {
    expect(linesOf({}, '없는것')).toEqual([])
  })
})
