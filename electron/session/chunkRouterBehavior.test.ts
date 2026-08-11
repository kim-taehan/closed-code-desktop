import { describe, expect, it, vi } from 'vitest'
import { ChunkType } from '../../shared/protocol/chunkTypes'
import { SAMPLE_CHUNKS, setup } from './chunkTestKit'

// 라우터가 표를 실제로 집행하는지 — 경로별 동작 검증.
// 표 자체의 완전성은 chunkRoutes.test.ts 에 있다.

describe('RENDERS — 만들어진 메시지의 내용', () => {
  it('text 는 내용과 semanticType 을 담는다', () => {
    const { messages, turns, router } = setup()
    turns.onTurnStart('t1')
    router.route({ messageType: 'text', message: '답변', semanticType: 'reply', segmentId: 's1' }, 'stream-1')

    const message = messages.messages[0]!
    expect(message.content).toBe('답변')
    expect(message.semanticType).toBe('reply')
    expect(message.turnId).toBe('t1')
    expect(message.streamId).toBe('stream-1')
  })

  it('빈 text 는 메시지를 만들지 않는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'text', message: '' })
    expect(messages.messages).toHaveLength(0)
  })

  it('같은 (streamId, segmentId) 텍스트는 이어붙는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'text', message: '첫 ', segmentId: 's1' }, 'stream-1')
    router.route({ messageType: 'text', message: '둘 ', segmentId: 's1' }, 'stream-1')
    router.route({ messageType: 'text', message: '셋', segmentId: 's1' }, 'stream-1')

    expect(messages.messages).toHaveLength(1)
    expect(messages.messages[0]!.content).toBe('첫 둘 셋')
  })

  it('segmentId 가 바뀌면 새 버블이 열린다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'text', message: '계획', segmentId: 's1' }, 'stream-1')
    router.route({ messageType: 'text', message: '답변', segmentId: 's2' }, 'stream-1')

    expect(messages.messages).toHaveLength(2)
  })

  it('tool_call 은 도구 이름을 담고 결과는 비어 있다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'tool_call', toolName: 'grep_search', toolCallId: 'tc9' })

    const message = messages.messages[0]!
    expect(message.toolName).toBe('grep_search')
    expect(message.toolCallId).toBe('tc9')
    expect(message.toolResult).toBeUndefined()
  })

  it('error 는 message/code 를 담는다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'error', message: '한도를 넘었습니다', code: 'CONTEXT_EXCEEDED' })

    expect(messages.messages[0]!.content).toContain('한도를 넘었습니다')
    expect(messages.messages[0]!.content).toContain('CONTEXT_EXCEEDED')
  })

  // agent_error 는 필드명이 error 와 다르다 (errorMessage/exceptionType).
  // error 분기를 필드명 그대로 재사용하면 이 단언이 "알 수 없는 오류" 로 깨진다.
  it('agent_error 는 errorMessage/exceptionType 을 읽는다 — 문구가 비면 안 된다', () => {
    const { messages, router } = setup()
    router.route(SAMPLE_CHUNKS[ChunkType.AGENT_ERROR]!)

    expect(messages.messages).toHaveLength(1)
    const content = messages.messages[0]!.content
    expect(content).toContain('에이전트 실행이 중단됐습니다')
    expect(content).toContain('ToolException')
    expect(content).not.toContain('알 수 없는 오류')
  })

  it('agent_error 의 errorMessage 가 없으면 기본 문구로 떨어진다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'agent_error', exceptionType: 'ValueError' })

    expect(messages.messages[0]!.content).toContain('알 수 없는 오류')
  })
})

describe('FOLDS — 기존 메시지에 접힌다', () => {
  it('tool_result 는 toolCallId 로 짝을 찾아 접힌다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'tool_call', toolName: 'read_file', toolCallId: 'tc1' })
    router.route({ messageType: 'tool_result', toolCallId: 'tc1', result: '파일 내용', success: true })

    expect(messages.messages).toHaveLength(1)
    // raw 는 OUT/ERR 행 분해에 필요해 원본 그대로 보관한다
    expect(messages.messages[0]!.toolResult).toEqual({
      message: '파일 내용',
      raw: '파일 내용',
      success: true,
    })
  })

  it('짝을 못 찾은 tool_result 는 폐기된다 — 유령 메시지를 만들지 않는다', () => {
    const { messages, router } = setup()
    const result = router.route({ messageType: 'tool_result', toolCallId: '없는id', result: 'x' })

    expect(messages.messages).toHaveLength(0)
    expect(result.changed).toBe(false)
  })

  it('toolCallId 가 없으면 같은 streamId 의 미완료 도구에 접힌다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'tool_call', toolName: 'run_command' }, 'stream-1')
    router.route({ messageType: 'tool_result', result: '출력' }, 'stream-1')

    expect(messages.messages[0]!.toolResult?.message).toBe('출력')
  })

  it('error 가 있으면 success 는 false 가 된다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'tool_call', toolName: 'edit_file', toolCallId: 'tc1' })
    router.route({ messageType: 'tool_result', toolCallId: 'tc1', error: '권한 없음' })

    expect(messages.messages[0]!.toolResult).toMatchObject({ success: false, error: '권한 없음' })
  })

  it('type_revision 은 기존 버블의 semanticType 만 바꾼다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'text', message: '내용', segmentId: 's1' }, 'stream-1')
    const before = messages.messages.length

    router.route({ messageType: 'type_revision', segmentId: 's1', semanticType: 'reply' })

    expect(messages.messages).toHaveLength(before)
    expect(messages.messages[0]!.semanticType).toBe('reply')
  })

  it('type_revision 은 뒤에서부터 찾는다 — segmentId 가 턴을 가로질러 충돌할 수 있다', () => {
    const { messages, router } = setup()
    router.route({ messageType: 'text', message: '옛 턴', segmentId: 's1' }, 'stream-1')
    router.route({ messageType: 'text', message: '새 턴', segmentId: 's1' }, 'stream-2')

    router.route({ messageType: 'type_revision', segmentId: 's1', semanticType: 'reply' })

    expect(messages.messages[0]!.semanticType).toBeUndefined()
    expect(messages.messages[1]!.semanticType).toBe('reply')
  })

  it('짝 없는 type_revision 은 아무 일도 하지 않는다', () => {
    const { router } = setup()
    expect(router.route({ messageType: 'type_revision', segmentId: '없음', semanticType: 'reply' }).changed).toBe(false)
  })
})

describe('META_ONLY — DOM 을 만들지 않는다', () => {
  it('turn_start 는 활성 턴만 연다', () => {
    const { messages, turns, router } = setup()
    router.route({ messageType: 'turn_start', turnId: 't1', startedAt: '2026-07-20T10:00:00Z' })

    expect(messages.messages).toHaveLength(0)
    expect(turns.active).toBe('t1')
    expect(turns.get('t1')?.startedAt).toBe(Date.parse('2026-07-20T10:00:00Z'))
  })

  it('같은 turnId 로 재개되면 최초 startedAt 을 유지한다', () => {
    const { turns, router } = setup()
    router.route({ messageType: 'turn_start', turnId: 't1', startedAt: '2026-07-20T10:00:00Z' })
    router.route({ messageType: 'turn_start', turnId: 't1', startedAt: '2026-07-20T10:05:00Z' })

    expect(turns.get('t1')?.startedAt).toBe(Date.parse('2026-07-20T10:00:00Z'))
  })

  it('turn_end 는 메타를 기록하고 terminal:true 에서만 활성 턴을 놓는다', () => {
    const { turns, router } = setup()
    router.route({ messageType: 'turn_start', turnId: 't1' })

    router.route({ messageType: 'turn_end', turnId: 't1', durationMs: 900, terminal: false })
    expect(turns.active).toBe('t1')

    router.route({ messageType: 'turn_end', turnId: 't1', durationMs: 1500, terminal: true })
    expect(turns.active).toBeNull()
    expect(turns.get('t1')).toMatchObject({ durationMs: 1500, terminal: true })
  })
})

describe('INTERRUPT — 메시지 배열 밖으로 나간다', () => {
  it('tool_approval_request 는 메시지를 만들지 않고 승인 요청을 돌려준다', () => {
    const { messages, router } = setup()
    const result = router.route({
      messageType: 'tool_approval_request',
      requestId: 'r1',
      toolName: 'edit_file',
      args: { path: 'a.ts' },
    })

    expect(messages.messages).toHaveLength(0)
    expect(result.approval).toEqual({ requestId: 'r1', toolName: 'edit_file', args: { path: 'a.ts' } })
  })

  it('requestId 가 없으면 승인 요청으로 치지 않는다', () => {
    const { router } = setup()
    expect(router.route({ messageType: 'tool_approval_request', toolName: 'x' }).approval).toBeUndefined()
  })

  it('user_question 은 메시지를 만들지 않고 질문을 돌려준다 (DC-644)', () => {
    const { messages, router } = setup()
    const result = router.route({
      messageType: 'user_question',
      questionId: 'q1',
      question: '진행할까요?',
      options: ['예', '아니오'],
    })
    expect(messages.messages).toHaveLength(0)
    expect(result.question).toEqual({ questionId: 'q1', question: '진행할까요?', options: ['예', '아니오'] })
  })

  it('plan_approval 은 메시지를 만들지 않고 계획을 돌려준다 (DC-776)', () => {
    const { messages, router } = setup()
    const result = router.route({
      messageType: 'plan_approval',
      planId: 'p1',
      summary: '리팩토링 계획',
      filesToChange: ['a.ts', 'b.ts'],
      estimatedSteps: 3,
    })
    expect(messages.messages).toHaveLength(0)
    expect(result.plan).toEqual({
      planId: 'p1',
      summary: '리팩토링 계획',
      filesToChange: ['a.ts', 'b.ts'],
      estimatedSteps: 3,
    })
  })

  it('questionId/planId 가 없으면 인터럽트로 치지 않는다', () => {
    const { router } = setup()
    expect(router.route({ messageType: 'user_question', question: 'x' }).question).toBeUndefined()
    expect(router.route({ messageType: 'plan_approval', summary: 'x' }).plan).toBeUndefined()
  })
})

describe('DEFERRED / DROPPED — 의도적으로 아무것도 안 한다', () => {
  const silent = [
    ChunkType.AGENT_TASK_START,
    ChunkType.AGENT_TASK_END,
    ChunkType.CODE_DIFF,
    ChunkType.SYSTEM,
  ]

  for (const type of silent) {
    it(`${type} 은 메시지도 승인도 만들지 않는다`, () => {
      const { messages, router } = setup()
      const result = router.route(SAMPLE_CHUNKS[type]!)

      expect(messages.messages).toHaveLength(0)
      expect(result.approval).toBeUndefined()
      expect(result.changed).toBe(false)
      // 표에 근거가 있는 드롭이므로 경고를 남기지 않는다
      expect(result.route).not.toBe('unknown')
    })
  }
})

describe('표에 없는 타입 (설계 §5.3)', () => {
  it('예외를 던지지 않고 경고만 남긴다', () => {
    const onUnknownType = vi.fn()
    const { messages, router } = setup(onUnknownType)

    const result = router.route({ messageType: 'aliens_landed', payload: 1 })

    expect(result.route).toBe('unknown')
    expect(messages.messages).toHaveLength(0)
    expect(onUnknownType).toHaveBeenCalledWith('aliens_landed', { messageType: 'aliens_landed', payload: 1 })
  })

  it('기본 동작은 console.error 로 청크 전문을 남기는 것이다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { router } = setup()

    router.route({ messageType: 'aliens_landed' })

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('매핑표'), { messageType: 'aliens_landed' })
    spy.mockRestore()
  })

  it('messageType 이 아예 없으면 조용히 무시한다', () => {
    const onUnknownType = vi.fn()
    const { router } = setup(onUnknownType)

    expect(router.route({ foo: 1 }).route).toBe('unknown')
    expect(onUnknownType).not.toHaveBeenCalled()
  })
})
