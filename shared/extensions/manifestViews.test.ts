import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

// 매니페스트 3판의 뷰 (E1). 2판은 **오늘 그대로** 읽혀야 한다 — 우리 확장 둘이 5단계까지 2판이다.

const BASE = { name: 'x', version: '1.0.0', main: 'main.js' }

function views(manifestVersion: number, list: unknown[]) {
  const result = parseManifest({ ...BASE, manifestVersion, contributes: { views: list } })
  if (!result.ok) throw new Error(result.reason)
  return result.manifest.contributes?.views
}

describe('3판', () => {
  it('판 3 을 받는다', () => {
    expect(parseManifest({ ...BASE, manifestVersion: 3 }).ok).toBe(true)
  })

  it('웹뷰 뷰를 entry 와 함께 읽는다 — entry 는 ui/ 기준으로 편다', () => {
    expect(
      views(3, [
        { id: 'board', title: '보드', kind: 'webview', entry: 'ui/index.html' },
        { id: 'deep', title: '깊이', kind: 'webview', entry: './ui/./pages/a.html' },
      ]),
    ).toEqual([
      { id: 'board', title: '보드', kind: 'webview', entry: 'ui/index.html' },
      { id: 'deep', title: '깊이', kind: 'webview', entry: 'ui/pages/a.html' },
    ])
  })

  it('entry 가 ui/ 밖이거나 없으면 그 뷰를 버린다', () => {
    const bad = ['index.html', 'ui', 'ui/', '/ui/index.html', 'ui/../main.js', '../ui/index.html', 'lib/ui/index.html']
    expect(views(3, [{ id: 'a', title: 'A', kind: 'webview' }, ...bad.map((entry) => ({ id: entry, title: 'T', kind: 'webview', entry }))])).toEqual([])
  })

  it('3판은 옛 종류(표·트리·목록·html)를 받지 않는다 — 옛 API 는 6단계에서 사라진다', () => {
    expect(views(3, ['table', 'tree', 'list', 'html'].map((kind) => ({ id: kind, title: kind, kind })))).toEqual([])
  })
})

describe('2판은 그대로', () => {
  it('옛 종류를 그대로 읽는다', () => {
    const list = ['table', 'tree', 'list', 'html'].map((kind) => ({ id: kind, title: kind, kind }))
    expect(views(2, list)).toEqual(list)
  })

  it('2판에 webview 를 적어도 받지 않는다 — 판이 뜻을 정한다', () => {
    expect(views(2, [{ id: 'b', title: 'B', kind: 'webview', entry: 'ui/index.html' }])).toEqual([])
  })
})
