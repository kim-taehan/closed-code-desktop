import { describe, expect, it } from 'vitest'
import type { ToolResult } from '../../shared/ipc/messageTypes'
import {
  COLLAPSE_CHARS,
  COLLAPSE_LINES,
  MAX_RENDER_CHARS,
  buildToolResultRows,
  clampForRender,
  isExpandable,
  normalizeFilePaths,
  prepareForRender,
  stringifyResult,
} from './toolResultRows'

// toolResultRows 는 도구 결과를 OUT/ERR 행으로 나누고 화면용으로 잘라낸다.
// 우선순위: 에러 → stdout/stderr 스트림 → message/raw 폴백.

describe('stringifyResult — 결과 직렬화', () => {
  it('undefined/null 은 빈 문자열', () => {
    expect(stringifyResult(undefined)).toBe('')
    expect(stringifyResult(null)).toBe('')
  })

  it('문자열은 그대로', () => {
    expect(stringifyResult('그대로')).toBe('그대로')
  })

  it('객체는 보기 좋게 들여쓴 JSON', () => {
    expect(stringifyResult({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('숫자·불리언도 JSON 직렬화', () => {
    expect(stringifyResult(42)).toBe('42')
    expect(stringifyResult(true)).toBe('true')
  })
})

describe('buildToolResultRows — 결과 행 구성', () => {
  it('결과가 없으면 빈 배열', () => {
    expect(buildToolResultRows(undefined)).toEqual([])
  })

  it('에러가 있으면 ERR 한 줄', () => {
    const rows = buildToolResultRows({ error: '터졌다' })
    expect(rows).toEqual([{ label: 'ERR', content: '터졌다', isError: true }])
  })

  it('stdout 만 있으면 OUT 한 줄', () => {
    const result: ToolResult = { raw: { stdout: '출력' } }
    expect(buildToolResultRows(result)).toEqual([{ label: 'OUT', content: '출력' }])
  })

  it('stderr 만 있으면 ERR 한 줄', () => {
    const result: ToolResult = { raw: { stderr: '경고' } }
    expect(buildToolResultRows(result)).toEqual([{ label: 'ERR', content: '경고', isError: true }])
  })

  it('둘 다 있으면 OUT → ERR 순서', () => {
    const result: ToolResult = { raw: { stdout: '나감', stderr: '틀림' } }
    expect(buildToolResultRows(result)).toEqual([
      { label: 'OUT', content: '나감' },
      { label: 'ERR', content: '틀림', isError: true },
    ])
  })

  it('스트림 키가 빈 문자열뿐이면 스트림 행이 안 생겨 message/raw 폴백으로 간다', () => {
    // stdout/stderr 가 있지만 빈 문자열이라 rows 가 비어 폴백. message 가 없으니 raw 를 직렬화.
    const result: ToolResult = { raw: { stdout: '', stderr: '' } }
    expect(buildToolResultRows(result)).toEqual([
      { label: 'OUT', content: '{\n  "stdout": "",\n  "stderr": ""\n}' },
    ])
  })

  it('스트림이 없고 message 가 있으면 message 로 OUT', () => {
    const result: ToolResult = { message: '요약 문구', raw: { data: 1 } }
    expect(buildToolResultRows(result)).toEqual([{ label: 'OUT', content: '요약 문구' }])
  })

  it('message 도 스트림도 없으면 raw 를 직렬화해 OUT', () => {
    const result: ToolResult = { raw: [1, 2] }
    expect(buildToolResultRows(result)).toEqual([{ label: 'OUT', content: '[\n  1,\n  2\n]' }])
  })

  it('아무 내용도 없으면 "완료"', () => {
    expect(buildToolResultRows({})).toEqual([{ label: 'OUT', content: '완료' }])
  })
})

describe('clampForRender — 너무 긴 결과 잘라내기', () => {
  it('상한 이하면 그대로', () => {
    const short = 'x'.repeat(100)
    expect(clampForRender(short)).toBe(short)
  })

  it('정확히 상한이면 그대로', () => {
    const exact = 'x'.repeat(MAX_RENDER_CHARS)
    expect(clampForRender(exact)).toBe(exact)
  })

  it('상한을 넘으면 잘라내고 안내 문구를 붙인다', () => {
    const long = 'x'.repeat(MAX_RENDER_CHARS + 10)
    const out = clampForRender(long)
    expect(out.startsWith('x'.repeat(MAX_RENDER_CHARS))).toBe(true)
    expect(out).toContain('결과가 너무 길어')
    expect(out.length).toBeLessThan(long.length + 100)
  })
})

describe('isExpandable — 접었다 펼 수 있는가', () => {
  it('짧고 줄 수도 적으면 거짓', () => {
    expect(isExpandable('한 줄')).toBe(false)
  })

  it('문자 수가 상한을 넘으면 참', () => {
    expect(isExpandable('x'.repeat(COLLAPSE_CHARS + 1))).toBe(true)
  })

  it('문자 수가 정확히 상한이면 거짓 (엄격 초과)', () => {
    expect(isExpandable('x'.repeat(COLLAPSE_CHARS))).toBe(false)
  })

  it('줄 수가 상한을 넘으면 참', () => {
    const many = Array.from({ length: COLLAPSE_LINES + 1 }, () => 'a').join('\n')
    expect(isExpandable(many)).toBe(true)
  })

  it('줄 수가 정확히 상한이면 거짓', () => {
    const exact = Array.from({ length: COLLAPSE_LINES }, () => 'a').join('\n')
    expect(isExpandable(exact)).toBe(false)
  })
})

describe('normalizeFilePaths — 경로 구분자 정리', () => {
  it('역슬래시를 슬래시로', () => {
    expect(normalizeFilePaths('a\\b\\c')).toBe('a/b/c')
  })

  it('콜론 뒤가 아닌 중복 슬래시는 하나로', () => {
    expect(normalizeFilePaths('a//b///c')).toBe('a/b/c')
  })

  it('콜론 뒤의 // 는 보존한다 (http://)', () => {
    expect(normalizeFilePaths('http://host/a')).toBe('http://host/a')
  })
})

describe('prepareForRender — 잘라낸 뒤 경로 정리 (순서 중요)', () => {
  it('경로 정리가 적용된다', () => {
    expect(prepareForRender('a\\b//c')).toBe('a/b/c')
  })

  it('상한을 넘으면 자른 뒤 경로까지 정리한다', () => {
    const long = 'a\\b'.repeat(MAX_RENDER_CHARS)
    const out = prepareForRender(long)
    expect(out).not.toContain('\\')
    expect(out).toContain('결과가 너무 길어')
  })
})
