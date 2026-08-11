import { describe, expect, it } from 'vitest'
import { buildToolChipLabel, buildToolDesc, buildToolInContent } from './buildToolDesc'
import {
  buildToolResultRows,
  clampForRender,
  isExpandable,
  normalizeFilePaths,
  stringifyResult,
} from './toolResultRows'
import { getToolIconKind } from '../components/ToolIcon'

// 설계 §6.6 의 문자열과 상수. vscode 와 정확히 같아야 한다.

describe('buildToolDesc', () => {
  it('read 는 file_path 를 뽑는다', () => {
    expect(buildToolDesc('read_file', { file_path: 'src/app.ts' })).toBe('src/app.ts')
  })

  it('edit 계열도 file_path 를 뽑는다', () => {
    expect(buildToolDesc('edit_file', { file_path: 'a.ts' })).toBe('a.ts')
    expect(buildToolDesc('create_file', { file_path: 'b.ts' })).toBe('b.ts')
  })

  it('검색 계열은 pattern 을 따옴표로 감싼다', () => {
    expect(buildToolDesc('grep_search', { pattern: 'foo' })).toBe('pattern: "foo"')
    expect(buildToolDesc('glob', { pattern: '*.ts' })).toBe('pattern: "*.ts"')
  })

  it('bash 계열은 빈 문자열이다 — 칩에서 따로 만든다', () => {
    expect(buildToolDesc('run_command', { command: 'ls' })).toBe('')
  })

  it('매칭 실패하면 빈 문자열이다', () => {
    expect(buildToolDesc('read_file', { other: 1 })).toBe('')
  })

  it('그 외 도구는 80자에서 자르고 마침표 셋을 붙인다', () => {
    const long = JSON.stringify({ value: 'x'.repeat(200) })
    const result = buildToolDesc('unknown_tool', long)

    expect(result.length).toBe(80)
    expect(result.endsWith('...')).toBe(true)
  })
})

describe('buildToolChipLabel', () => {
  it('실행 계열은 명령을 따옴표로 감싼다', () => {
    expect(buildToolChipLabel('run_command', { command: 'npm test' })).toBe('실행 "npm test"')
  })

  it('명령이 50자를 넘으면 47자 + 말줄임표 한 글자다', () => {
    const command = 'a'.repeat(60)
    const label = buildToolChipLabel('bash', { command })

    expect(label).toBe(`실행 "${'a'.repeat(47)}…"`)
    // ASCII 점 셋이 아니라 U+2026 한 글자다
    expect(label).toContain('…')
    expect(label).not.toContain('...')
  })

  it('명령이 없으면 빈 라벨이다', () => {
    expect(buildToolChipLabel('run_command', {})).toBe('')
  })

  it('읽기와 수정은 접두어가 붙는다', () => {
    expect(buildToolChipLabel('read_file', { file_path: 'a.ts' })).toBe('읽기 a.ts')
    expect(buildToolChipLabel('edit_file', { file_path: 'b.ts' })).toBe('수정 b.ts')
  })
})

describe('buildToolInContent', () => {
  it('IN 행은 bash 계열에만 있다', () => {
    expect(buildToolInContent('run_command', { command: 'ls -al' })).toBe('ls -al')
    expect(buildToolInContent('bash', { command: 'pwd' })).toBe('pwd')
  })

  it('다른 도구는 IN 행이 없다', () => {
    expect(buildToolInContent('read_file', { file_path: 'a.ts' })).toBeNull()
    expect(buildToolInContent('grep_search', { pattern: 'x' })).toBeNull()
  })

  it('command 를 못 찾으면 인자 전체를 쓴다', () => {
    expect(buildToolInContent('run_command', { other: 1 })).toBe('{"other":1}')
  })
})

describe('getToolIconKind', () => {
  it('이름별로 아이콘이 정해진다', () => {
    expect(getToolIconKind('read_file')).toBe('read')
    expect(getToolIconKind('edit_file')).toBe('edit')
    expect(getToolIconKind('create_file')).toBe('edit')
    expect(getToolIconKind('write')).toBe('edit')
    expect(getToolIconKind('grep_search')).toBe('search')
    expect(getToolIconKind('glob')).toBe('search')
    expect(getToolIconKind('run_command')).toBe('run')
    expect(getToolIconKind('bash')).toBe('run')
  })

  it('_search 로 끝나면 전부 검색 아이콘이다', () => {
    expect(getToolIconKind('rag_search')).toBe('search')
    expect(getToolIconKind('tool_search')).toBe('search')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(getToolIconKind('READ_FILE')).toBe('read')
  })

  it('모르는 도구는 아이콘이 없다', () => {
    expect(getToolIconKind('save_memory')).toBeNull()
  })
})

describe('결과 행 구성', () => {
  it('에러면 ERR 한 줄이다', () => {
    expect(buildToolResultRows({ error: '권한 없음' })).toEqual([
      { label: 'ERR', content: '권한 없음', isError: true },
    ])
  })

  it('stdout 과 stderr 가 있으면 OUT 다음 ERR 이다', () => {
    const rows = buildToolResultRows({ raw: { stdout: '출력', stderr: '경고' } })

    expect(rows.map((row) => row.label)).toEqual(['OUT', 'ERR'])
    expect(rows[1]!.isError).toBe(true)
  })

  it('stdout 만 있으면 OUT 하나다', () => {
    expect(buildToolResultRows({ raw: { stdout: '출력만' } })).toEqual([
      { label: 'OUT', content: '출력만' },
    ])
  })

  it('그 외에는 OUT 한 줄이고 비면 완료 로 채운다', () => {
    expect(buildToolResultRows({ message: '결과' })[0]).toEqual({ label: 'OUT', content: '결과' })
    expect(buildToolResultRows({})[0]).toEqual({ label: 'OUT', content: '완료' })
  })

  it('결과가 없으면 행도 없다', () => {
    expect(buildToolResultRows(undefined)).toEqual([])
  })
})

describe('직렬화와 잘라내기', () => {
  it('null 은 빈 문자열, 문자열은 그대로, 객체는 들여쓴 JSON 이다', () => {
    expect(stringifyResult(null)).toBe('')
    expect(stringifyResult('그대로')).toBe('그대로')
    expect(stringifyResult({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('20,000자를 넘으면 자르고 안내를 붙인다', () => {
    const clamped = clampForRender('x'.repeat(25_000))

    expect(clamped).toContain('결과가 너무 길어 20,000자까지만 표시합니다.')
    expect(clamped.startsWith('x'.repeat(20_000))).toBe(true)
  })

  it('20,000자 이하는 건드리지 않는다', () => {
    const short = 'x'.repeat(19_999)
    expect(clampForRender(short)).toBe(short)
  })

  it('1,000자를 넘거나 20줄을 넘으면 접을 수 있다', () => {
    expect(isExpandable('x'.repeat(1_001))).toBe(true)
    expect(isExpandable('줄\n'.repeat(21))).toBe(true)
    expect(isExpandable('짧음')).toBe(false)
  })

  it('경계값에서는 접히지 않는다', () => {
    expect(isExpandable('x'.repeat(1_000))).toBe(false)
    expect(isExpandable(Array(20).fill('줄').join('\n'))).toBe(false)
  })

  it('경로 구분자를 정리한다', () => {
    expect(normalizeFilePaths('C:\\a\\b')).toBe('C:/a/b')
    expect(normalizeFilePaths('a//b///c')).toBe('a/b/c')
    // 스킴의 // 는 건드리지 않는다
    expect(normalizeFilePaths('http://x/y')).toBe('http://x/y')
  })
})
