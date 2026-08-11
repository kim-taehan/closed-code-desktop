import { describe, expect, it } from 'vitest'
import { MessageKind } from '../../shared/ipc/messageTypes'
import { MessageStore } from './messageStore'
import { recordLocalNotice, recordShellResult } from './shellRecord'
import type { ShellResult } from './shellRunner'

// `!명령` 로컬 셸 결과를 대화에 남긴다. 턴을 열지 않고 화면에만 기록한다.

function record(result: ShellResult) {
  const store = new MessageStore()
  recordShellResult(store, result)
  return store.snapshot()
}

describe('recordShellResult — 사용자 명령 줄', () => {
  it('친 명령을 !접두로 user 메시지로 남긴다', () => {
    const [user] = record({ command: 'ls -la', code: 0, output: '결과' })
    expect(user).toMatchObject({ author: 'user', kind: MessageKind.TEXT, content: '!ls -la' })
  })
})

describe('recordShellResult — 출력 본문', () => {
  it('성공 출력은 코드 블록으로 감싸 assistant 로 남긴다', () => {
    const items = record({ command: 'echo hi', code: 0, output: 'hi' })
    const body = items[1]!
    expect(body.author).toBe('assistant')
    expect(body.content).toBe('```\nhi\n```')
    expect(body.turnId).toMatch(/^local-shell-/)
  })

  it('기록마다 턴 id 가 다르다 — 화면이 turnId 로 키잡아 고정 id 는 React 키 충돌', () => {
    const store = new MessageStore()
    recordShellResult(store, { command: 'a', code: 0, output: '1' })
    recordShellResult(store, { command: 'b', code: 0, output: '2' })
    const [, first, , second] = store.snapshot()
    expect(first!.turnId).not.toBe(second!.turnId)
  })

  it('출력이 없으면 (출력 없음) 을 보여준다', () => {
    const items = record({ command: 'true', code: 0, output: '' })
    expect(items[1]!.content).toBe('```\n(출력 없음)\n```')
  })

  it('0 이 아닌 종료 코드는 출력 뒤에 종료 코드 줄을 붙인다', () => {
    const items = record({ command: 'false', code: 1, output: '에러 출력' })
    expect(items[1]!.content).toBe('```\n에러 출력\n종료 코드 1\n```')
  })

  it('종료 코드만 있고 출력이 없으면 종료 코드 줄만', () => {
    const items = record({ command: 'false', code: 2, output: '' })
    expect(items[1]!.content).toBe('```\n종료 코드 2\n```')
  })

  it('실행 자체가 실패하면 failed 메시지를 상태로 쓴다', () => {
    const items = record({ command: 'nope', code: null, output: '', failed: '셸을 찾을 수 없습니다' })
    expect(items[1]!.content).toBe('```\n셸을 찾을 수 없습니다\n```')
  })

  it('failed 가 있으면 code 와 무관하게 failed 를 우선한다', () => {
    const items = record({ command: 'x', code: 0, output: '무시안됨', failed: '중단됨' })
    expect(items[1]!.content).toBe('```\n무시안됨\n중단됨\n```')
  })
})

describe('recordShellResult — 셸 표식', () => {
  it('마지막 메시지에 원문(command·output)을 shell 로 붙인다', () => {
    const items = record({ command: 'echo hi', code: 0, output: 'hi' })
    // runtime 은 이 대화를 모르므로 이어 물으려면 원문이 필요하다
    expect(items[1]!.shell).toEqual({ command: 'echo hi', output: 'hi' })
  })

  it('shell.output 은 (출력 없음) 같은 화면용 문자열과 같다', () => {
    const items = record({ command: 'true', code: 0, output: '' })
    expect(items[1]!.shell).toEqual({ command: 'true', output: '(출력 없음)' })
  })

  it('두 메시지(user 명령 + assistant 출력)만 남긴다', () => {
    expect(record({ command: 'ls', code: 0, output: 'a' })).toHaveLength(2)
  })
})

describe('recordLocalNotice — 이스터에그 로컬 응답', () => {
  it('사용자 문구 + 응답 한 쌍을 남기고 턴은 열지 않는다', () => {
    const store = new MessageStore()
    recordLocalNotice(store, '내가 김다은이다', '개발자 모드로 변경되었습니다.')
    const [user, reply] = store.snapshot()

    expect(user).toMatchObject({ author: 'user', content: '내가 김다은이다' })
    expect(reply).toMatchObject({ author: 'assistant', content: '개발자 모드로 변경되었습니다.' })
    expect(reply!.turnId).toMatch(/^local-notice-/)
  })

  it('연속 안내도 턴 id 가 겹치지 않는다 — 이스터에그 두 번 입력 시 중복 키 경고 재현 방지', () => {
    const store = new MessageStore()
    recordLocalNotice(store, '내가 김다은이다', '개발자 모드로 변경되었습니다.')
    recordLocalNotice(store, '내가 김다은이다', '이미 개발자 모드입니다')
    const [, first, , second] = store.snapshot()
    expect(first!.turnId).not.toBe(second!.turnId)
  })
})
