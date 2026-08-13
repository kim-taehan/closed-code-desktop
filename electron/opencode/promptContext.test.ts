import { describe, expect, it } from 'vitest'
import { withPromptContext } from './promptContext'

// 붙인 문서가 모델에 닿는지. **이 번역이 없으면 첨부가 조용히 사라진다** —
// 실제로 사라졌고(문서를 붙이고 "요약해줘" → "어떤 문서를 요약할까요?"), 그것이 이 파일의 사유다.

describe('withPromptContext', () => {
  it('붙인 파일 경로를 질문 뒤에 적는다', () => {
    const out = withPromptContext('요약해줘', {
      contextFiles: [{ filePath: '/repo/docs/desktop-engineer.md', type: 'file' }],
    })
    expect(out).toContain('요약해줘')
    expect(out).toContain('file: /repo/docs/desktop-engineer.md')
  })

  it('디렉토리는 dir 로 적는다 — 파일과 다루는 법이 다르다', () => {
    const out = withPromptContext('훑어봐', { contextFiles: [{ filePath: '/repo/src', type: 'dir' }] })
    expect(out).toContain('dir: /repo/src')
  })

  it('공백이 든 경로도 한 줄에 그대로 — 한 줄이 곧 한 경로다', () => {
    const out = withPromptContext('열어봐', {
      contextFiles: [{ filePath: '/repo/내 문서/보고서 초안.md', type: 'file' }],
    })
    expect(out).toContain('file: /repo/내 문서/보고서 초안.md')
  })

  it('보고 있는 파일과 고른 줄 범위를 적는다 — "이 부분 고쳐줘" 가 성립하는 근거다', () => {
    const out = withPromptContext('이 함수 고쳐줘', {
      activeEditor: { filePath: '/repo/src/a.ts', selection: { start_offset: 12, end_offset: 40 } },
    })
    expect(out).toContain('viewing: /repo/src/a.ts (12-40줄 선택)')
  })

  it('선택이 없으면 범위는 안 적는다', () => {
    const out = withPromptContext('뭐하는 파일이야', { activeEditor: { filePath: '/repo/src/a.ts' } })
    expect(out).toContain('viewing: /repo/src/a.ts')
    expect(out).not.toContain('줄 선택')
  })

  it('질문에 이미 적힌 경로는 다시 적지 않는다 — `@경로` 로 친 것이 그대로 온다', () => {
    const query = '@/repo/src/a.ts 이거 봐줘'
    const out = withPromptContext(query, { contextFiles: [{ filePath: '/repo/src/a.ts', type: 'file' }] })
    expect(out).toBe(query)
  })

  it('붙일 것이 없으면 질문을 그대로 둔다 — 빈 꼬리표는 첨부가 있는 것처럼 읽힌다', () => {
    expect(withPromptContext('안녕', {})).toBe('안녕')
    expect(withPromptContext('안녕', { contextFiles: [] })).toBe('안녕')
  })

  it('망가진 값은 건너뛴다 — 목록 하나 때문에 질문이 안 나가면 안 된다', () => {
    const out = withPromptContext('요약해줘', {
      contextFiles: [null, { filePath: '' }, { filePath: '/repo/a.md' }, 'a.md'],
      activeEditor: 'nope',
    })
    expect(out).toContain('file: /repo/a.md')
    expect(out.split('\n').filter((line) => line.startsWith('file:'))).toHaveLength(1)
  })
})
