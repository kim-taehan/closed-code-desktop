import { describe, expect, it, vi } from 'vitest'
import { handleRpc, SERVER_NAME } from './rpc'

// 공여(develop-desktop/electron/mcp/rpc.test.ts)를 그대로 옮겼다. 프로토콜 처리가 안 바뀌었으니
// 테스트도 안 바뀐다 — 바뀐 것(서버 이름)만 케이스를 하나 더했다.

const never: () => Promise<string> = () => Promise.reject(new Error('부르면 안 된다'))

describe('handleRpc', () => {
  it('initialize 는 도구를 쓸 수 있다고 답한다', async () => {
    const response = await handleRpc({ id: 1, method: 'initialize', params: {} }, never)
    const result = response?.result as { capabilities: { tools: unknown } }
    expect(result.capabilities.tools).toBeDefined()
  })

  // opencode 가 도구 이름을 `sanitize(서버이름)_sanitize(도구이름)` 으로 짓는다
  // (1.17.18 실측: `s.replace(/[^a-zA-Z0-9_-]/g,"_")`). 이름이 바뀌면 모델이 배운
  // 이름도 바뀌므로 여기 못 박아 둔다.
  it('서버 이름은 sanitize 를 타도 그대로다', () => {
    expect(SERVER_NAME.replace(/[^a-zA-Z0-9_-]/g, '_')).toBe(SERVER_NAME)
  })

  // 우리 버전을 고집하면 새 클라이언트가 악수 단계에서 끊는다
  it('상대가 부른 프로토콜 버전을 그대로 돌려준다', async () => {
    const response = await handleRpc(
      { id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      never,
    )
    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe('2099-01-01')
  })

  // 실측: opencode 1.17.18 이 부르는 값이다. 우리 상수(2025-06-18)보다 새 버전이라,
  // 상대 것을 되돌려 주지 않으면 여기서 갈린다.
  it('opencode 가 부르는 2025-11-25 도 그대로 돌려준다', async () => {
    const response = await handleRpc(
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      never,
    )
    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25')
  })

  it('도구 목록', async () => {
    const response = await handleRpc({ id: 2, method: 'tools/list' }, never)
    const result = response?.result as { tools: { name: string }[] }
    expect(result.tools.map((tool) => tool.name)).toEqual(['open_file', 'open_terminal'])
  })

  it('슬래시 커맨드로 open 을 내놓는다', async () => {
    const response = await handleRpc({ id: 6, method: 'prompts/list' }, never)
    const result = response?.result as { prompts: { name: string }[] }
    expect(result.prompts.map((prompt) => prompt.name)).toEqual(['open'])
  })

  // prompt 는 도구를 대신하지 않는다 — 모델이 읽고 open_file 을 부르게 만드는 말이다
  it('prompts/get 은 open_file 을 부르라는 사용자 메시지를 만든다', async () => {
    const response = await handleRpc(
      { id: 7, method: 'prompts/get', params: { name: 'open', arguments: { path: 'src/a.ts' } } },
      never,
    )
    const result = response?.result as { messages: { role: string; content: { text: string } }[] }
    expect(result.messages[0]?.role).toBe('user')
    expect(result.messages[0]?.content.text).toContain('open_file')
    expect(result.messages[0]?.content.text).toContain('src/a.ts')
  })

  it('줄 번호를 주면 그것까지 말에 담는다', async () => {
    const response = await handleRpc(
      {
        id: 8,
        method: 'prompts/get',
        params: { name: 'open', arguments: { path: 'src/a.ts', line: '12' } },
      },
      never,
    )
    const result = response?.result as { messages: { content: { text: string } }[] }
    expect(result.messages[0]?.content.text).toContain('12번째 줄')
  })

  it('경로 없이 부르면 되물으라고 한다', async () => {
    const response = await handleRpc(
      { id: 9, method: 'prompts/get', params: { name: 'open', arguments: {} } },
      never,
    )
    const result = response?.result as { messages: { content: { text: string } }[] }
    expect(result.messages[0]?.content.text).toContain('물어본 뒤')
  })

  it('tools/call 은 이름과 인자를 그대로 넘긴다', async () => {
    const run = vi.fn().mockResolvedValue('열었습니다')
    const response = await handleRpc(
      { id: 3, method: 'tools/call', params: { name: 'open_file', arguments: { path: 'a.ts' } } },
      run,
    )

    expect(run).toHaveBeenCalledWith('open_file', { path: 'a.ts' })
    expect(response?.result).toEqual({ content: [{ type: 'text', text: '열었습니다' }] })
  })

  // 프로토콜 오류로 올리면 모델에게는 "고장" 으로만 보여 고쳐 부를 수가 없다
  it('도구가 실패하면 오류가 아니라 isError 결과로 내려간다', async () => {
    const response = await handleRpc(
      { id: 4, method: 'tools/call', params: { name: 'open_file', arguments: {} } },
      () => Promise.reject(new Error('경로가 없습니다')),
    )

    expect(response?.error).toBeUndefined()
    expect(response?.result).toEqual({
      content: [{ type: 'text', text: '경로가 없습니다' }],
      isError: true,
    })
  })

  it('모르는 메서드는 -32601 이다', async () => {
    const response = await handleRpc({ id: 5, method: 'resources/list' }, never)
    expect(response?.error?.code).toBe(-32601)
  })

  it('알림에는 답하지 않는다 — 짝 없는 id 를 보내면 클라이언트가 헷갈린다', async () => {
    expect(await handleRpc({ method: 'notifications/initialized' }, never)).toBeNull()
  })
})
