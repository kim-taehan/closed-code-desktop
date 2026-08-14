import { describe, expect, it } from 'vitest'
import { activeEditorOf, isRealFilePath, type EditorSelection } from './editorContext'
import { diffTabKey, type OpenFile } from './useOpenFiles'
import { htmlTabKey } from './useOpenHtmlTab'

// 채팅 요청에 실을 편집기 컨텍스트의 형태 규칙.
// runtime 은 모르는 키를 조용히 버리고 형식이 어긋나도 알려주지 않으므로 여기서 잠근다.

const file = (path: string): OpenFile => ({ path, text: '' })
const range: EditorSelection = { startLine: 3, endLine: 9 }

describe('실제 파일 경로 판정', () => {
  it('보통 파일은 통과한다', () => {
    expect(isRealFilePath('src/a.ts')).toBe(true)
  })

  // git diff 탭은 접두사가 붙은 가짜 경로다 — 그대로 보내면 없는 파일을 가리킨다
  it('git diff 탭은 거른다 (담김·변경 양쪽)', () => {
    expect(isRealFilePath(diffTabKey('src/a.ts', true))).toBe(false)
    expect(isRealFilePath(diffTabKey('src/a.ts', false))).toBe(false)
  })

  // 확장 화면 탭도 가짜 경로다. **`files` 에 들어가므로** 「목록에 없어서 걸린다」는
  // 방어가 안 통한다 — 실측(2026-08-14): 확장 판을 열어 둔 채 대화를 보내면
  // 입력창에 `ext:screen-scenario:screenScenario.board 함께 보냄` 이 붙어 나갔다.
  it('확장 화면 탭은 거른다', () => {
    expect(isRealFilePath(htmlTabKey('screen-scenario', 'screenScenario.board'))).toBe(false)
  })
})

describe('활성 편집기 참조 — 파일 아닌 탭', () => {
  it('확장 화면 탭이 활성이면 아무것도 안 싣는다', () => {
    const key = htmlTabKey('screen-scenario', 'screenScenario.board')

    // **탭 목록에 실제로 들어 있는 상태**로 잰다. 안 넣고 재면 `files.some` 이 먼저
    // 끊어, 겨누려던 관문(`isRealFilePath`)이 돌지도 않고 초록이 난다.
    expect(activeEditorOf([file(key)], key, {})).toBeNull()
  })
})

describe('활성 편집기 참조', () => {
  it('선택이 없으면 selection 키 자체를 만들지 않는다', () => {
    const found = activeEditorOf([file('src/a.ts')], 'src/a.ts', {})
    expect(found).toEqual({ filePath: 'src/a.ts' })
    expect(found && 'selection' in found).toBe(false)
  })

  it('선택이 있으면 1-based 라인 범위를 그대로 싣는다', () => {
    expect(activeEditorOf([file('src/a.ts')], 'src/a.ts', { 'src/a.ts': range })).toEqual({
      filePath: 'src/a.ts',
      selection: { startLine: 3, endLine: 9 },
    })
  })

  it('경로를 절대경로로 바꾸지 않는다 — 변환은 main 이 한다', () => {
    expect(activeEditorOf([file('src/a.ts')], 'src/a.ts', {})?.filePath).toBe('src/a.ts')
  })

  // 대화·로그 탭은 files 에 없다. 탭 이름을 하나씩 배제하지 않아도 걸린다.
  it('파일이 아닌 탭이면 없다', () => {
    expect(activeEditorOf([file('src/a.ts')], 'chat', {})).toBeNull()
    expect(activeEditorOf([file('src/a.ts')], 'logs', {})).toBeNull()
  })

  it('git diff 탭을 보고 있으면 없다', () => {
    const key = diffTabKey('src/a.ts', false)
    expect(activeEditorOf([file(key)], key, {})).toBeNull()
  })

  it('다른 파일의 선택이 활성 파일에 새지 않는다', () => {
    expect(activeEditorOf([file('a.ts'), file('b.ts')], 'a.ts', { 'b.ts': range })).toEqual({
      filePath: 'a.ts',
    })
  })
})
