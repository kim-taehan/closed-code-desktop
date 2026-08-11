import { describe, expect, it } from 'vitest'
import {
  deriveColumns,
  describeSkipReason,
  extensionDirName,
  formatCell,
  type ExtensionRow,
} from './extensionRows'

// 확장마다 열이 다르다 — 표는 데이터에서 열을 유도한다.

describe('열 유도', () => {
  it('첫 행의 키 순서가 곧 열 순서다', () => {
    const rows: ExtensionRow[] = [{ kind: 'TODO', file: 'a.ts', line: 3, text: '고치기' }]

    expect(deriveColumns(rows)).toEqual(['kind', 'file', 'line', 'text'])
  })

  // 정렬을 끼우면 확장 개발자가 화면을 예측할 수 없다
  it('알파벳 순으로 바꾸지 않는다', () => {
    expect(deriveColumns([{ z: 1, a: 2 }])).toEqual(['z', 'a'])
  })

  // 버리면 데이터를 조용히 숨기는 것이 된다
  it('뒤쪽 행에만 있는 키는 뒤에 덧붙인다', () => {
    const rows: ExtensionRow[] = [{ file: 'a.ts' }, { file: 'b.ts', severity: 'high' }]

    expect(deriveColumns(rows)).toEqual(['file', 'severity'])
  })

  it('같은 키를 두 번 담지 않는다', () => {
    expect(deriveColumns([{ a: 1 }, { a: 2 }, { a: 3 }])).toEqual(['a'])
  })

  it('행이 없으면 열도 없다', () => {
    expect(deriveColumns([])).toEqual([])
  })
})

describe('칸 표시', () => {
  it('문자열·숫자·불리언을 그대로 낸다', () => {
    expect(formatCell('TODO')).toBe('TODO')
    expect(formatCell(12)).toBe('12')
    expect(formatCell(false)).toBe('false')
  })

  it('없는 값은 빈 칸이다', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
  })

  // 객체를 그대로 React 에 넘기면 렌더가 터진다
  it('객체·배열은 한 줄로 접는다', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
    expect(formatCell([1, 2])).toBe('[1,2]')
  })

  it('순환 참조라도 렌더를 터뜨리지 않는다', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic

    expect(formatCell(cyclic)).toBe('[표시할 수 없음]')
  })
})

describe('건너뛴 사유', () => {
  it('아는 사유는 무엇을 고쳐야 하는지로 바꾼다', () => {
    expect(describeSkipReason('missing_main')).toBe('main 이 없습니다')
    expect(describeSkipReason('invalid_json')).toBe('manifest.json 이 JSON 형식이 아닙니다')
  })

  // 로더가 뒤늦게 낸 사유들. 코드가 영어 그대로 노출되면 안 된다.
  it('심링크·이름 검사 사유에도 라벨이 있다', () => {
    expect(describeSkipReason('broken_link')).toBe('링크가 가리키는 폴더가 없습니다')
    expect(describeSkipReason('unsafe_name')).toBe('name 에 경로 문자(/ \\ ..)를 쓸 수 없습니다')
  })

  it('로더가 내는 사유에 라벨이 다 있다', () => {
    // 정본: electron/extensions/registry.ts 의 ExtensionSkipReason
    //     + shared/extensions/manifest.ts 의 ManifestParseFailure
    const reasons = [
      'no_manifest',
      'unreadable',
      'broken_link',
      'invalid_json',
      'not_object',
      'missing_name',
      'unsafe_name',
      'missing_version',
      'missing_main',
    ]

    for (const reason of reasons) {
      expect(describeSkipReason(reason)).not.toContain(reason)
    }
  })

  // 훑기는 통과했는데 **싣기**에서 실패한 것들. 매니페스트가 멀쩡한 확장이 여기로 온다 —
  // 문법 오류난 확장을 깔았을 때 화면에 뜨는 사유가 바로 이 줄들이다.
  it('싣기 단계 사유에도 라벨이 다 있다', () => {
    // 정본: electron/extensions/extensionLoader.ts 의 ExtensionLoadFailure
    const reasons = [
      'main_outside',
      'main_missing',
      'main_not_file',
      'require_failed',
      'no_activate',
      'activate_failed',
    ]

    for (const reason of reasons) {
      expect(describeSkipReason(reason)).not.toContain(reason)
    }
  })

  // 사유 코드가 아니라 **무엇을 고쳐야 하는지**가 보여야 한다
  it('문법 오류난 확장은 코드에 문제가 있다고 알린다', () => {
    expect(describeSkipReason('require_failed')).toBe('확장 코드에 오류가 있어 불러오지 못했습니다')
  })

  // 사전에 없다고 숨기면 사유를 돌려받는 의미가 없다.
  // main 쪽에 사유가 하나 늘어도 화면은 그것을 보여줘야 한다.
  it('모르는 사유는 모른다고 밝히고 코드를 그대로 담는다', () => {
    expect(describeSkipReason('some_new_reason')).toBe('알 수 없는 사유 (some_new_reason)')
  })
})

describe('설치 폴더 이름', () => {
  it('경로의 마지막 조각만 쓴다', () => {
    expect(extensionDirName('/Users/me/.davis-code/desktop-extensions/todo')).toBe('todo')
    expect(extensionDirName('C:\\Users\\me\\.davis-code\\desktop-extensions\\todo')).toBe('todo')
  })

  it('끝에 구분자가 붙어 있어도 이름을 찾는다', () => {
    expect(extensionDirName('/a/b/todo/')).toBe('todo')
  })
})
