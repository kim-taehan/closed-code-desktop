import { describe, expect, it } from 'vitest'
import { normalizeSendContext } from './editorContext'

// renderer→main 경로 정규화 계약.
//
// runtime 은 절대경로를 기대하고(`dirty_files` 는 `Path(p).resolve()` 로 정규화된다 —
// turn_transaction/service.py:188-190), 상대경로가 그대로 나가도 **에러 없이 가드가 안 걸린다**.
// 그래서 여기서 잠근다.

const ROOT = '/Users/me/proj'

describe('normalizeSendContext — 상대경로 → 절대경로', () => {
  it('activeEditor.filePath 를 프로젝트 루트 기준 절대경로로 바꾼다', () => {
    const out = normalizeSendContext({ activeEditor: { filePath: 'src/a.ts' } }, ROOT)
    expect(out.activeEditor?.filePath).toBe('/Users/me/proj/src/a.ts')
  })

  it('dirtyFiles 도 전부 절대경로로 바꾼다', () => {
    const out = normalizeSendContext({ dirtyFiles: ['src/a.ts', 'docs/b.md'] }, ROOT)
    expect(out.dirtyFiles).toEqual(['/Users/me/proj/src/a.ts', '/Users/me/proj/docs/b.md'])
  })

  it('이미 절대경로면 손대지 않는다 (루트를 두 번 붙이지 않는다)', () => {
    const out = normalizeSendContext(
      { activeEditor: { filePath: '/elsewhere/a.ts' }, dirtyFiles: ['/elsewhere/b.ts'] },
      ROOT,
    )
    expect(out.activeEditor?.filePath).toBe('/elsewhere/a.ts')
    expect(out.dirtyFiles).toEqual(['/elsewhere/b.ts'])
  })

  it('selection 은 값을 건드리지 않고 그대로 통과시킨다 (라인 번호다)', () => {
    const out = normalizeSendContext(
      { activeEditor: { filePath: 'a.ts', selection: { startLine: 3, endLine: 9 } } },
      ROOT,
    )
    expect(out.activeEditor?.selection).toEqual({ startLine: 3, endLine: 9 })
  })
})

describe('normalizeSendContext — `git:` 가짜 탭 제외', () => {
  // git diff 탭은 실제 파일이 아니라 탭 식별자다 (useOpenFiles.ts:53-56 `diffTabKey`).
  // renderer 가 걸러 보내는 것을 믿지 않고 main 에서도 막는다 — 새어 나가면 runtime 이
  // 존재하지 않는 경로를 붙들고, `extra='ignore'` 라 아무도 항의하지 않는다.

  it('git diff 탭을 보고 있으면 activeEditor 를 통째로 뺀다', () => {
    const out = normalizeSendContext({ activeEditor: { filePath: 'git:unstaged:src/a.ts' } }, ROOT)
    expect('activeEditor' in out).toBe(false)
  })

  it('staged 접두사도 같다', () => {
    const out = normalizeSendContext({ activeEditor: { filePath: 'git:staged:src/a.ts' } }, ROOT)
    expect('activeEditor' in out).toBe(false)
  })

  it('dirtyFiles 에서도 걸러낸다 — 진짜 파일만 남는다', () => {
    const out = normalizeSendContext(
      { dirtyFiles: ['src/a.ts', 'git:staged:src/a.ts', 'git:unstaged:src/b.ts'] },
      ROOT,
    )
    expect(out.dirtyFiles).toEqual(['/Users/me/proj/src/a.ts'])
  })

  it('전부 걸러져도 빈 배열로 남긴다 — undefined 로 접지 않는다', () => {
    // `[]` 는 "dirty 없음" 의 명시 신호다 (DC-603). 접으면 그 신호가 사라진다.
    const out = normalizeSendContext({ dirtyFiles: ['git:staged:a.ts'] }, ROOT)
    expect(out.dirtyFiles).toEqual([])
  })
})

describe('normalizeSendContext — 나머지 필드', () => {
  it('images·files·model·attachments 는 그대로 통과한다', () => {
    const out = normalizeSendContext(
      { model: 'gpt-x', files: [{ filePath: '/w/a.ts', type: 'file' }], attachments: [] },
      ROOT,
    )
    expect(out.model).toBe('gpt-x')
    expect(out.files).toEqual([{ filePath: '/w/a.ts', type: 'file' }])
    expect(out.attachments).toEqual([])
  })

  it('안 준 필드는 키가 생기지 않는다 — 생략 규칙이 프레임까지 이어져야 한다', () => {
    const out = normalizeSendContext({}, ROOT)
    expect('activeEditor' in out).toBe(false)
    expect('dirtyFiles' in out).toBe(false)
  })
})
