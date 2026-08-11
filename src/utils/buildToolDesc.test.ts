import { describe, expect, it } from 'vitest'
import { buildToolChipLabel, buildToolDesc, buildToolInContent } from './buildToolDesc'

// 도구 칩 라벨·설명·IN 행 (설계 §6.6). vscode 와 문자열이 같아야 한다.

describe('buildToolDesc — 도구별 설명 문자열', () => {
  it('read/read_file 은 file_path 를 뽑는다', () => {
    expect(buildToolDesc('read', { file_path: '/a/b.ts' })).toBe('/a/b.ts')
    expect(buildToolDesc('read_file', { file_path: '/x.ts' })).toBe('/x.ts')
  })

  it('대소문자 무관하게 도구 이름을 매칭한다', () => {
    expect(buildToolDesc('READ', { file_path: '/a.ts' })).toBe('/a.ts')
  })

  it('edit/edit_file/create_file 은 file_path 를 뽑는다', () => {
    expect(buildToolDesc('edit', { file_path: '/a.ts' })).toBe('/a.ts')
    expect(buildToolDesc('edit_file', { file_path: '/b.ts' })).toBe('/b.ts')
    expect(buildToolDesc('create_file', { file_path: '/c.ts' })).toBe('/c.ts')
  })

  it('file_path 가 없으면 빈 문자열', () => {
    expect(buildToolDesc('read', { other: 1 })).toBe('')
    expect(buildToolDesc('edit', {})).toBe('')
  })

  it('file_path 값의 앞뒤 공백은 잘린다', () => {
    expect(buildToolDesc('read', '{"file_path": "  /a.ts  "}')).toBe('/a.ts')
  })

  it('glob/grep 은 pattern: "..." 형태로 만든다', () => {
    expect(buildToolDesc('glob', { pattern: '*.ts' })).toBe('pattern: "*.ts"')
    expect(buildToolDesc('grep_search', { pattern: 'foo' })).toBe('pattern: "foo"')
  })

  it('pattern 이 없으면 빈 문자열', () => {
    expect(buildToolDesc('grep', { file_path: 'x' })).toBe('')
  })

  it('bash/run_command 는 설명이 없다 (IN 행에서 따로 보여준다)', () => {
    expect(buildToolDesc('bash', { command: 'ls' })).toBe('')
    expect(buildToolDesc('run_command', { command: 'ls' })).toBe('')
  })

  it('기본 도구는 80자 이하면 원문 그대로', () => {
    const short = 'x'.repeat(80)
    expect(buildToolDesc('unknown_tool', short)).toBe(short)
  })

  it('기본 도구는 80자 초과면 77자 + ASCII 점 세 개', () => {
    const long = 'x'.repeat(81)
    const out = buildToolDesc('unknown_tool', long)
    expect(out).toBe(`${'x'.repeat(77)}...`)
    expect(out).toHaveLength(80)
  })

  it('args 가 객체면 JSON 문자열로 바꿔 다룬다', () => {
    expect(buildToolDesc('unknown', { a: 1 })).toBe('{"a":1}')
  })

  it('args 가 null/undefined 면 빈 문자열', () => {
    expect(buildToolDesc('read', null)).toBe('')
    expect(buildToolDesc('unknown', undefined)).toBe('')
  })
})

describe('buildToolChipLabel — 도구 행 칩 라벨', () => {
  it('bash/run_command 는 실행 "명령" 형태', () => {
    expect(buildToolChipLabel('bash', { command: 'ls -la' })).toBe('실행 "ls -la"')
    expect(buildToolChipLabel('run_command', { command: 'npm test' })).toBe('실행 "npm test"')
  })

  it('명령이 없으면 빈 칩', () => {
    expect(buildToolChipLabel('bash', { other: 1 })).toBe('')
  })

  it('명령이 50자 초과면 47자 + 말줄임표 한 글자(U+2026)', () => {
    const cmd = 'a'.repeat(51)
    const out = buildToolChipLabel('bash', { command: cmd })
    expect(out).toBe(`실행 "${'a'.repeat(47)}…"`)
  })

  it('명령이 50자 이하면 그대로', () => {
    const cmd = 'a'.repeat(50)
    expect(buildToolChipLabel('bash', { command: cmd })).toBe(`실행 "${cmd}"`)
  })

  it('read 는 읽기 접두, edit 는 수정 접두', () => {
    expect(buildToolChipLabel('read', { file_path: '/a.ts' })).toBe('읽기 /a.ts')
    expect(buildToolChipLabel('edit_file', { file_path: '/a.ts' })).toBe('수정 /a.ts')
    expect(buildToolChipLabel('create_file', { file_path: '/a.ts' })).toBe('수정 /a.ts')
  })

  it('그 외 도구는 desc 를 그대로 쓴다', () => {
    expect(buildToolChipLabel('grep', { pattern: 'x' })).toBe('pattern: "x"')
  })
})

describe('buildToolInContent — IN 행 (bash/run_command 전용)', () => {
  it('bash/run_command 외에는 null (IN 행 자체가 없다)', () => {
    expect(buildToolInContent('read', { file_path: '/a.ts' })).toBeNull()
    expect(buildToolInContent('edit', {})).toBeNull()
  })

  it('command 가 있으면 그 값을 쓴다', () => {
    expect(buildToolInContent('bash', { command: 'ls -la' })).toBe('ls -la')
    expect(buildToolInContent('run_command', { command: 'pwd' })).toBe('pwd')
  })

  it('command 를 못 뽑으면 원문 텍스트를 그대로 쓴다', () => {
    expect(buildToolInContent('bash', 'echo hi')).toBe('echo hi')
    expect(buildToolInContent('bash', { other: 1 })).toBe('{"other":1}')
  })
})
