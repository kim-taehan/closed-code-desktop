import { describe, expect, it } from 'vitest'
import { normalizeSendContext } from './editorContext'
import { chatRequestFrame } from './chatFrames'

// autoContext — 최근 저장한 파일을 runtime `<auto_context>` 로 보낸다.
// 중복 제거가 핵심이다: runtime 이 20개에서 자르므로(message_builder.py),
// 이미 다른 필드로 말한 파일이 자리를 차지하면 **진짜 힌트가 밀려난다.**

const ROOT = '/proj'

describe('autoContext 정규화', () => {
  it('상대경로를 절대경로로 바꾼다', () => {
    const out = normalizeSendContext({ autoContext: ['src/a.ts'] }, ROOT)
    expect(out.autoContext).toEqual(['/proj/src/a.ts'])
  })

  it('활성 편집기와 겹치면 뺀다', () => {
    const out = normalizeSendContext(
      { activeEditor: { filePath: 'src/a.ts' }, autoContext: ['src/a.ts', 'src/b.ts'] },
      ROOT,
    )
    expect(out.autoContext, '같은 파일을 두 번 말하고 있다').toEqual(['/proj/src/b.ts'])
  })

  it('contextFiles 와 겹쳐도 뺀다', () => {
    // `@` 멘션·첨부·보고 있는 문서. renderer 는 이 둘을 함께 보지 못하므로 여기서만 걸린다.
    const out = normalizeSendContext(
      { files: [{ filePath: '/proj/src/a.ts', type: 'file' }], autoContext: ['src/a.ts', 'src/b.ts'] },
      ROOT,
    )
    expect(out.autoContext).toEqual(['/proj/src/b.ts'])
  })

  it('git 가짜 탭은 뺀다', () => {
    const out = normalizeSendContext({ autoContext: ['git:staged:src/a.ts', 'src/b.ts'] }, ROOT)
    expect(out.autoContext).toEqual(['/proj/src/b.ts'])
  })

  it('전부 걸러지면 필드 자체를 뺀다', () => {
    // dirtyFiles 와 달리 "없음" 을 알릴 이유가 없다
    const out = normalizeSendContext(
      { activeEditor: { filePath: 'src/a.ts' }, autoContext: ['src/a.ts'] },
      ROOT,
    )
    expect(out).not.toHaveProperty('autoContext')
  })
})

describe('autoContext wire 계약', () => {
  it('경로 문자열이 아니라 EditorRef 배열로 나간다', () => {
    // runtime ChatData.auto_context: List[EditorRef] (domains/chat.py)
    const frame = chatRequestFrame('q', { autoContext: ['/proj/a.ts'] }, { chatId: null })
    const data = JSON.parse(frame).data
    expect(data.autoContext).toEqual([{ filePath: '/proj/a.ts', type: 'file' }])
  })

  it('비면 키가 없다', () => {
    const frame = chatRequestFrame('q', { autoContext: [] }, { chatId: null })
    expect(JSON.parse(frame).data).not.toHaveProperty('autoContext')
  })
})
