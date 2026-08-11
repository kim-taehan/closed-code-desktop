// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOpenHtmlTab, htmlTabKey } from './useOpenHtmlTab'
import type { ActiveTab, OpenFile } from './useOpenFiles'

// **확장 화면 탭을 앞으로 끌어오는 규칙.**
//
// 잡는 회귀: 예전에는 밀어 올릴 때마다 그 탭을 골랐다. 확장이 **진행 상황을 몇 초마다
// 밀기** 시작하면서 그 자리가 함정이 됐다 — 수 분짜리 작업 동안 사용자가 다른 파일을
// 보려고 탭을 옮겨도 다음 갱신이 곧바로 도로 끌어온다.
//
// 규칙: **처음 열 때 한 번만** 고른다. 그 뒤로는 내용만 갈아끼운다.

const KEY = htmlTabKey('test-scenario', 'testScenario.result')

/** 훅과 그 훅이 건드리는 상태 둘을 함께 쥔다 — 실제 자리(`useOpenFiles`)와 같은 짜임새다. */
function bed() {
  let files: OpenFile[] = []
  // 앱이 처음 서는 자리와 같다 (`useOpenFiles` 의 초기값)
  let active: ActiveTab = 'chat'

  const { result } = renderHook(() =>
    useOpenHtmlTab(
      (update) => {
        files = typeof update === 'function' ? update(files) : update
      },
      (update) => {
        active = typeof update === 'function' ? update(active) : update
      },
    ),
  )

  return {
    open: (html: string, key = KEY) => act(() => result.current(key, '결과', html)),
    get files() {
      return files
    },
    get active() {
      return active
    },
    /** 사용자가 다른 탭으로 옮긴 것 */
    goElsewhere: () => {
      active = 'src/다른파일.ts'
    },
  }
}

describe('확장 화면 탭', () => {
  it('처음 밀면 탭을 만들고 앞으로 끌어온다', () => {
    const app = bed()

    app.open('<p>도는 중</p>')

    expect(app.files).toEqual([{ path: KEY, text: '', label: '결과', html: '<p>도는 중</p>' }])
    expect(app.active).toBe(KEY)
  })

  it('다시 밀면 내용만 갈아끼운다 — 탭이 늘지 않는다', () => {
    const app = bed()

    app.open('<p>1/7</p>')
    app.open('<p>4/7</p>')

    expect(app.files).toHaveLength(1)
    expect(app.files[0]?.html).toBe('<p>4/7</p>')
  })

  // 이 시험이 이 파일의 존재 이유다
  it('사용자가 다른 탭으로 옮기면 갱신이 와도 끌어오지 않는다', () => {
    const app = bed()
    app.open('<p>1/7</p>')

    app.goElsewhere()
    app.open('<p>4/7</p>')
    app.open('<p>7/7</p>')

    expect(app.active).toBe('src/다른파일.ts')
    // 그래도 내용은 최신이다 — 돌아오면 끝난 것이 보인다
    expect(app.files[0]?.html).toBe('<p>7/7</p>')
  })

  it('확장 화면이 여럿이면 각자 한 번씩 끌어온다', () => {
    const app = bed()
    const other = htmlTabKey('current-analysis', 'currentAnalysis.programs')

    app.open('<p>결과</p>')
    app.goElsewhere()
    app.open('<p>프로그램</p>', other)

    expect(app.active).toBe(other)
    expect(app.files).toHaveLength(2)
  })
})
