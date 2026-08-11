import { describe, expect, it } from 'vitest'
import { chatRequestFrame } from './chatFrames'
import { modelChangeLabel } from './shellRecord'

// chat_request 의 모델 오버라이드 계약 (DC-1320/1322, ws-chat-contract §5-1).
// **trim 후 truthy 일 때만 data.model 주입, 아니면 필드 자체를 생략** — 필드 유무가
// 하위호환 규칙이라, 빈 문자열이 실려 나가면 구버전 runtime 계약이 깨진다.

function dataOf(frame: string): Record<string, unknown> {
  return (JSON.parse(frame) as { data: Record<string, unknown> }).data
}

describe('chatRequestFrame — model 주입/생략 규칙', () => {
  it('모델을 지정하면 data.model 로 실린다 (trim 적용)', () => {
    const data = dataOf(chatRequestFrame('질문', { model: ' gpt-x ' }, { chatId: null }))
    expect(data['model']).toBe('gpt-x')
  })

  it('미지정이면 model 필드 자체가 없다 (하위호환)', () => {
    const data = dataOf(chatRequestFrame('질문', {}, { chatId: null }))
    expect('model' in data).toBe(false)
  })

  it('공백뿐인 값도 생략이다 — 빈 문자열을 보내면 안 된다', () => {
    const data = dataOf(chatRequestFrame('질문', { model: '   ' }, { chatId: null }))
    expect('model' in data).toBe(false)
  })

  it('query 등 기존 필드는 모델 유무와 무관하게 그대로다', () => {
    const data = dataOf(chatRequestFrame('질문', { model: 'm' }, { chatId: null }))
    expect(data['query']).toBe('질문')
  })
})

// activeEditor / dirtyFiles 의 wire 계약 (domains/chat.py:7-16, 56/68).
// runtime 은 populate_by_name=False + extra='ignore' 라 **키를 틀리면 조용히 버린다** —
// 에러가 안 나므로 프레임 자체를 검사하는 이 테스트가 유일한 방어선이다.
describe('chatRequestFrame — activeEditor 계약', () => {
  it('selection 의 wire 키는 snake_case 다 (start_offset/end_offset)', () => {
    // Selection 의 alias 가 필드명과 같아 camelCase 도메인 안의 snake_case 섬이다.
    // camelCase(startOffset/startLine)로 바꾸면 runtime 이 selection 을 통째로 버린다.
    const data = dataOf(
      chatRequestFrame(
        '이 함수 고쳐줘',
        { activeEditor: { filePath: '/w/src/a.ts', selection: { startLine: 12, endLine: 20 } } },
        { chatId: null },
      ),
    )
    const editor = data['activeEditor'] as Record<string, unknown>
    expect(editor['filePath']).toBe('/w/src/a.ts')
    expect(editor['selection']).toEqual({ start_offset: 12, end_offset: 20 })
    // 완화 방향 거부: camelCase 로 "정리" 하면 이 단언이 깨진다
    expect(Object.keys(editor['selection'] as object)).toEqual(['start_offset', 'end_offset'])
  })

  it('값은 1-based 라인 번호를 그대로 싣는다 — 문자 오프셋으로 환산하지 않는다', () => {
    // message_builder.py:18-32 "필드명은 'offset'이지만 실제 값은 IDE에서 line 번호로 전달된다".
    // 이름만 보고 document.offsetAt() 류로 "고치면" LLM 이 엉뚱한 위치를 본다.
    const data = dataOf(
      chatRequestFrame(
        '고쳐줘',
        { activeEditor: { filePath: '/w/a.ts', selection: { startLine: 1, endLine: 1 } } },
        { chatId: null },
      ),
    )
    const selection = (data['activeEditor'] as Record<string, unknown>)['selection']
    expect(selection).toEqual({ start_offset: 1, end_offset: 1 })
  })

  it('selection 이 없으면 selection 키 자체가 없다', () => {
    // start_offset/end_offset 은 둘 다 필수(ge=0)라 반쪽 selection 은 프레임 검증에 걸린다
    const data = dataOf(chatRequestFrame('고쳐줘', { activeEditor: { filePath: '/w/a.ts' } }, { chatId: null }))
    const editor = data['activeEditor'] as Record<string, unknown>
    expect(editor).toEqual({ filePath: '/w/a.ts' })
    expect('selection' in editor).toBe(false)
  })

  it('activeEditor 가 없으면 필드 자체가 없다', () => {
    const data = dataOf(chatRequestFrame('그냥 질문', {}, { chatId: null }))
    expect('activeEditor' in data).toBe(false)
  })
})

describe('chatRequestFrame — dirtyFiles 계약 (생략 규칙이 반대다)', () => {
  it('빈 배열도 그대로 보낸다 — 생략하지 않는다', () => {
    // ⚠️ 나머지 필드는 전부 omit-when-empty 인데 dirtyFiles 만 반대다.
    // `[]` 는 "dirty 없음" 의 명시 신호이고 생략은 "IDE 가 알려주지 않음" 이라 뜻이 다르다
    // (DC-603, vscode MessageFactory.ts:143-145). "일관성" 을 이유로 생략으로 바꾸면
    // runtime 의 direct-write 가드 판단 근거가 사라진다.
    const data = dataOf(chatRequestFrame('질문', { dirtyFiles: [] }, { chatId: null }))
    expect('dirtyFiles' in data).toBe(true)
    expect(data['dirtyFiles']).toEqual([])
  })

  it('값이 있으면 문자열 배열 그대로다 (객체 배열이 아니다)', () => {
    const data = dataOf(chatRequestFrame('질문', { dirtyFiles: ['/w/a.ts', '/w/b.ts'] }, { chatId: null }))
    expect(data['dirtyFiles']).toEqual(['/w/a.ts', '/w/b.ts'])
  })

  it('renderer 가 안 넣었으면(undefined) 필드가 없다', () => {
    const data = dataOf(chatRequestFrame('질문', {}, { chatId: null }))
    expect('dirtyFiles' in data).toBe(false)
  })
})

describe('modelChangeLabel — 전환 구분선 판정', () => {
  it('첫 요청(prev=undefined)에는 긋지 않는다', () => {
    expect(modelChangeLabel(undefined, 'a')).toBeNull()
    expect(modelChangeLabel(undefined, null)).toBeNull()
  })

  it('같은 값이면 긋지 않는다 (기본→기본 포함)', () => {
    expect(modelChangeLabel('a', 'a')).toBeNull()
    expect(modelChangeLabel(null, null)).toBeNull()
  })

  it('기본 ↔ 오버라이드 전환을 한국어 문구로 남긴다', () => {
    expect(modelChangeLabel(null, 'gpt-x')).toBe('모델 변경: 기본 모델 → gpt-x')
    expect(modelChangeLabel('gpt-x', null)).toBe('모델 변경: gpt-x → 기본 모델')
    expect(modelChangeLabel('a', 'b')).toBe('모델 변경: a → b')
  })
})
