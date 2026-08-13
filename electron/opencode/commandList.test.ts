import { describe, expect, it, vi } from 'vitest'
import { fetchCommands } from './commandList'

// `/` 목록 어댑터. 잠그는 것은 **URL 문자열 자체와 응답 모양**이다 —
// 둘 다 잘못 써도 HTTP 200 이 나서, 응답만 보고는 틀린 줄 모른다.

function stubFetch(body: unknown, ok = true) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url)
    return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchImpl)
  return calls
}

const RAW = [
  { name: 'init', description: 'guided AGENTS.md setup', source: 'command', template: '$ARGUMENTS' },
  { name: 'pptx', description: '슬라이드', source: 'skill', template: '# 본문', subtask: true },
]

describe('fetchCommands', () => {
  it('평문 `directory=` 로 묻는다 — 빼면 서버 cwd 의 목록이 온다', async () => {
    const calls = stubFetch(RAW)
    await fetchCommands('http://127.0.0.1:4096', '/tmp/내 프로젝트')

    expect(calls).toEqual(['http://127.0.0.1:4096/command?directory=%2Ftmp%2F%EB%82%B4%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8'])
  })

  it('`/api` 판이 아니다 — 그쪽은 스킬을 빼놓는다 (1.17.18 실측)', async () => {
    const calls = stubFetch(RAW)
    await fetchCommands('http://127.0.0.1:4096/', '/tmp/p')
    expect(calls[0]).toContain('/command?')
    expect(calls[0]).not.toContain('/api/')
  })

  it('배열이 그대로 온다 — 레거시 표면이라 `{data:…}` 래핑이 없다', async () => {
    stubFetch(RAW)
    const result = await fetchCommands('http://127.0.0.1:4096', '/tmp/p')

    expect(result.error).toBeUndefined()
    expect(result.commands).toEqual([
      { name: 'init', description: 'guided AGENTS.md setup', source: 'command', template: '$ARGUMENTS' },
      { name: 'pptx', description: '슬라이드', source: 'skill', template: '# 본문', subtask: true },
    ])
  })

  it('모르는 source 는 명령으로 둔다 — 태그만 덜 정확해지고 목록은 안 빈다', async () => {
    stubFetch([{ name: 'x', template: 't' }])
    const result = await fetchCommands('http://127.0.0.1:4096', '/tmp/p')
    expect(result.commands[0]).toEqual({ name: 'x', description: '', source: 'command', template: 't' })
  })

  it('실패해도 빈 목록으로 돌려준다 — 목록 하나 때문에 대화가 막히면 안 된다', async () => {
    stubFetch(RAW, false)
    const result = await fetchCommands('http://127.0.0.1:4096', '/tmp/p')
    expect(result.commands).toEqual([])
    expect(result.error).toContain('500')
  })

  it('주소나 열린 프로젝트가 없으면 부르지도 않는다', async () => {
    const calls = stubFetch(RAW)
    expect((await fetchCommands('', '/tmp/p')).error).toBeTruthy()
    expect((await fetchCommands('http://127.0.0.1:4096', '')).error).toBeTruthy()
    expect(calls).toEqual([])
  })
})
