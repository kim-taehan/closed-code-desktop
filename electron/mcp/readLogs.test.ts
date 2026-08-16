import { describe, expect, it } from 'vitest'
import { OutputBuffer } from '../pty/outputBuffer'
import { formatLogs, readLogsQuery } from './readLogs'

// **자르는 방법 셋이 각각 도는가, 그리고 전체 줄 수가 함께 오는가** (설계 §6 셋째 줄).
//
// 이 파일이 겨누는 실패는 "안 잘랐다" 가 아니라 **조용히 잘랐다** 이다. 잘린 것을 전부로
// 읽은 모델은 없는 줄을 근거로 결론을 낸다 — 게이트는 초록인 채로.

/** `dropped` 없이 그냥 N줄. 실제 버퍼가 상한 안에 있을 때의 모양이다. */
function snapshot(lines: string[], dropped = 0) {
  return { lines, dropped, total: dropped + lines.length }
}

const query = (over: Partial<ReturnType<typeof readLogsQuery>> = {}) => ({
  ...readLogsQuery({ name: 'dev' }),
  ...over,
})

describe('read_logs — 자르기 셋', () => {
  const many = Array.from({ length: 300 }, (_, index) => `줄 ${index}`)

  it('기본값은 마지막 100줄이다 — 통째로 주지 않는다', () => {
    const answer = formatLogs(query(), snapshot(many))

    expect(answer).toContain('줄 299')
    expect(answer).toContain('줄 200')
    expect(answer).not.toContain('줄 199')
  })

  it('tail 로 더 좁힐 수 있다', () => {
    const answer = formatLogs(query({ tail: 3 }), snapshot(many))

    expect(answer).toContain('줄 299')
    expect(answer).not.toContain('줄 296')
  })

  // 이 한 줄이 이 파일의 이유다. 전체 수가 안 오면 잘린 것이 전부로 읽힌다.
  it('전체 줄 수를 함께 준다', () => {
    const answer = formatLogs(query({ tail: 3 }), snapshot(many))

    expect(answer).toContain('모두 300줄')
    expect(answer).toContain('앞부분을 잘랐습니다')
  })

  it('심각도로 거른다', () => {
    const lines = ['vite ready', 'WARN deprecated api', 'Error: 못 찾음', '그냥 줄']

    const errors = formatLogs(query({ level: 'error' }), snapshot(lines))
    expect(errors).toContain('Error: 못 찾음')
    expect(errors).not.toContain('deprecated api')
    expect(errors).not.toContain('vite ready')

    // warn 은 **경고와 오류 둘 다**다 — 오류만 나오면 고칠 것을 놓친다
    const warns = formatLogs(query({ level: 'warn' }), snapshot(lines))
    expect(warns).toContain('deprecated api')
    expect(warns).toContain('Error: 못 찾음')
    expect(warns).not.toContain('vite ready')
  })

  it('거르고 나서 몇 줄이 남았는지 말한다', () => {
    const answer = formatLogs(query({ level: 'error' }), snapshot(['ok', 'error 하나']))

    expect(answer).toContain('2줄 중 1줄')
  })

  it('since 로 지난번에 본 뒤만 본다', () => {
    const answer = formatLogs(query({ since: 2 }), snapshot(['a', 'b', 'c', 'd']))

    expect(answer).toContain('c')
    expect(answer).toContain('d')
    expect(answer).not.toMatch(/^a$/m)
    expect(answer).not.toMatch(/^b$/m)
  })

  // 이어 볼 값을 안 주면 since 는 있으나 마나다 — 모델이 줄 번호를 지어내야 한다
  it('다음에 줄 since 값을 알려준다', () => {
    const answer = formatLogs(query(), snapshot(['a', 'b', 'c']))

    expect(answer).toContain('`since: 3`')
  })

  it('since 뒤에 새 줄이 없으면 빈손이라고 말한다', () => {
    const answer = formatLogs(query({ since: 3 }), snapshot(['a', 'b', 'c']))

    expect(answer).toContain('조건에 맞는 줄이 없습니다')
  })

  // 셋을 겹쳐 부르는 것이 실제 쓰임새다 — "지난번 이후에 난 오류의 마지막 한 줄"
  it('셋을 겹쳐 쓸 수 있다', () => {
    const lines = ['error 옛것', 'ok', 'error 하나', 'ok', 'error 둘']
    const answer = formatLogs(query({ since: 1, level: 'error', tail: 1 }), snapshot(lines))

    expect(answer).toContain('error 둘')
    expect(answer).not.toContain('error 하나')
    expect(answer).not.toContain('error 옛것')
  })
})

// **버린 것과 자른 것은 다른 사실이다.** 자른 것은 다시 물으면 오고, 버린 것은 영영 없다.
// 모델이 할 수 있는 일이 갈리므로 문장도 갈라야 한다.
describe('read_logs — 사라진 줄', () => {
  it('버퍼가 버린 줄이 있으면 다시 읽을 수 없다고 말한다', () => {
    const answer = formatLogs(query(), snapshot(['c', 'd'], 2))

    expect(answer).toContain('앞의 2줄')
    expect(answer).toContain('이미 사라졌습니다')
    expect(answer).toContain('모두 4줄')
  })

  it('지난번에 본 뒤로 버려진 줄이 있으면 그것도 말한다', () => {
    const answer = formatLogs(query({ since: 1 }), snapshot(['c', 'd'], 3))

    expect(answer).toContain('2줄은 버퍼 상한을 넘겨')
  })

  // 같은 이름으로 다시 띄우면 버퍼가 새로 생겨 전체 수가 **줄어든다.** 그때 조용히 빈손을
  // 주면 모델은 "그 뒤로 아무 일도 없었다" 로 읽는다 — 실제로는 처음부터 다시 도는 중이다.
  it('전체 수가 since 보다 작으면 프로세스가 다시 뜬 것으로 알린다', () => {
    const answer = formatLogs(query({ since: 500 }), snapshot(['a', 'b']))

    expect(answer).toContain('다시 뜬 것 같습니다')
  })

  // 층 사이가 이어졌는가 — 진짜 버퍼가 넘쳤을 때 그 사실이 모델에게까지 가는가
  it('진짜 버퍼가 넘쳤을 때도 그 사실이 그대로 간다', () => {
    const buffer = new OutputBuffer(3)
    buffer.push('a\nb\nc\nd\ne\n')

    const answer = formatLogs(query(), buffer.snapshot())
    expect(answer).toContain('모두 5줄')
    expect(answer).toContain('앞의 2줄')
  })
})

describe('read_logs — 인자', () => {
  it('이름이 없으면 거절한다', () => {
    expect(() => readLogsQuery({})).toThrow('name')
  })

  it('기본값은 마지막 100줄, 안 거름, 처음부터', () => {
    expect(readLogsQuery({ name: 'dev' })).toEqual({
      name: 'dev',
      tail: 100,
      level: 'all',
      since: null,
    })
  })

  // 상한이 없으면 "전부 달라" 한 번에 이 도구의 존재 이유가 사라진다
  it('tail 이 아무리 커도 1000줄까지다', () => {
    expect(readLogsQuery({ name: 'dev', tail: 999999 }).tail).toBe(1000)
  })

  it('말이 안 되는 값은 조용히 고치지 않고 거절한다', () => {
    expect(() => readLogsQuery({ name: 'dev', tail: 0 })).toThrow('tail')
    expect(() => readLogsQuery({ name: 'dev', since: -1 })).toThrow('since')
    expect(() => readLogsQuery({ name: 'dev', level: '심각' })).toThrow('level')
  })
})

// 색은 모델이 읽을 수 없는 잡음이고 컨텍스트만 먹는다. 버퍼는 원본을 그대로 들고 있다.
describe('read_logs — ANSI', () => {
  it('색은 벗겨서 준다', () => {
    const answer = formatLogs(query(), snapshot(['\u001b[31mError: 빨강\u001b[0m']))

    expect(answer).toContain('Error: 빨강')
    expect(answer).not.toContain('\u001b')
  })

  it('색에 가려도 심각도를 알아본다', () => {
    const answer = formatLogs(query({ level: 'error' }), snapshot(['\u001b[31mError: 빨강\u001b[0m']))

    expect(answer).toContain('Error: 빨강')
  })
})
