import { describe, expect, it } from 'vitest'
import { describeView } from './currentView'

// 모델이 이 문장으로 "이거", "여기" 를 푼다. **무엇을 말하지 않는가**도 검사한다 —
// 없는 것을 아는 척하면 모델이 엉뚱한 파일을 고친다.

describe('describeView', () => {
  it('앞에 나와 있고 파일을 보고 있으면 그 파일을 가리켜 준다', () => {
    const text = describeView({ focused: true, activeFile: { path: 'src/App.tsx', line: 42 } })
    expect(text).toContain('src/App.tsx')
    expect(text).toContain('42번째 줄')
    expect(text).toContain('"이거"')
  })

  it('줄을 모르면 줄을 말하지 않는다', () => {
    const text = describeView({ focused: true, activeFile: { path: 'src/App.tsx' } })
    expect(text).toContain('src/App.tsx')
    expect(text).not.toContain('번째 줄')
  })

  // 대화 탭에 있으면 편집기가 없다. 이때 "아무 파일도 안 보고 있다" 로 끝내면
  // 모델이 화면을 못 본다고 결론 내리므로, 되물으라는 말까지 준다.
  it('대화창을 보고 있으면 되물으라고 한다', () => {
    const text = describeView({ focused: true, activeFile: null })
    expect(text).toContain('대화창')
    expect(text).toContain('되물으')
  })

  // 파일 탭은 프로젝트를 옮기면 비워진다 — 뒤에 있는 프로젝트는 알 수 있는 값이 없다
  it('뒤에 있는 프로젝트면 모른다고 말한다', () => {
    const text = describeView({ focused: false, activeFile: null })
    expect(text).toContain('다른 프로젝트')
    expect(text).toContain('알 수 없습니다')
  })
})
