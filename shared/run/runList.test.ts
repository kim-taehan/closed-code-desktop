import { describe, expect, it } from 'vitest'
import { parseRunList, serializeRunList, type RunList } from './runList'

// 이 시험이 겨누는 것은 **읽기와 쓰기가 같은 형식을 쓰는가** 하나다 (`runList.ts` 머리말).
// 둘이 갈리면 타입도 초록이고 각자의 단위 시험도 초록인 채로, 화면에서는 목록이 늘 빈다.

const LIST: RunList = {
  entries: [
    { name: 'dev 서버', command: 'npm run dev', note: '개발 서버' },
    { name: '테스트', command: 'npm test' },
  ],
  manifest: '3f9a1c2b',
  project: '/Users/me/work/repo',
}

describe('serializeRunList / parseRunList', () => {
  it('쓴 것을 그대로 읽는다 — 지문까지', () => {
    expect(parseRunList(serializeRunList(LIST))).toEqual(LIST)
  })

  it('명령 안의 파이프·백틱·개행 없는 특수문자가 그대로 산다', () => {
    const piped: RunList = {
      entries: [{ name: 'log', command: 'npm run dev | tail -n 20', note: 'a | `b`' }],
      manifest: null,
      project: '/tmp/p',
    }
    expect(parseRunList(serializeRunList(piped))).toEqual(piped)
  })

  it('읽을 수 없으면 null — 「비어 있는 목록」과 다른 사실이다', () => {
    expect(parseRunList('')).toBeNull()
    expect(parseRunList('{ 반쯤 쓰다 만 파일')).toBeNull()
    expect(parseRunList('[]')).toBeNull()
    // 판이 다르면 빈 목록으로 읽지 않는다 — 모르는 것을 「없다」로 삼키지 않기 위해서다
    expect(parseRunList('{"version":2,"entries":[]}')).toBeNull()
  })

  it('망가진 줄만 버리고 나머지는 살린다 — 한 줄 때문에 목록 전체를 잃지 않는다', () => {
    const parsed = parseRunList(
      '{"version":1,"project":"/p","manifest":null,"entries":[{"name":"dev"},{"name":"t","command":"npm test"},7]}',
    )
    expect(parsed?.entries).toEqual([{ name: 't', command: 'npm test' }])
  })
})
