import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionApi,
  METHOD_HTTP_FETCH,
  METHOD_READ_FILE,
  METHOD_SECRETS_GET,
  METHOD_STORAGE_SET,
} from './extensionApi'

// 자식 쪽 대리자가 **부모에게 싣는 것** — `http.fetch`·`secrets`·`projectId` 를 받게 된 `workspace`·`storage`.
// 확장 이름은 API 층이 채우고, 확장이 실어 보낸 이름은 덮지 못한다 (남의 허용 목록·토큰·켜짐으로 가는 길).

function spy(answer: unknown = undefined) {
  const call = vi.fn(async (_method: string, _params?: unknown) => answer)
  return { call, code: createExtensionApi(call, 'jira') }
}

describe('이름은 API 층이 채운다', () => {
  it('http.fetch — init 에 extension 을 실어도 제 이름으로 간다, 모르는 칸은 버린다', async () => {
    const { call, code } = spy({ status: 200, headers: {}, body: '' })

    await code.http.fetch('https://jira/x', { method: 'POST', body: 'b', projectId: 'P', extension: 'evil', junk: 1 } as never)

    expect(call.mock.calls[0]).toEqual([
      METHOD_HTTP_FETCH,
      { url: 'https://jira/x', method: 'POST', body: 'b', projectId: 'P', extension: 'jira' },
    ])
  })

  it('secrets — 제 이름으로 묻는다', async () => {
    const { call, code } = spy('t')
    expect(await code.secrets.get('token')).toBe('t')
    expect(call.mock.calls[0]).toEqual([METHOD_SECRETS_GET, { extension: 'jira', key: 'token' }])
  })

  it('workspace·storage 의 target 은 projectId 만 싣는다', async () => {
    const { call, code } = spy('x')

    await code.workspace.readFile('a.ts', { projectId: 'Q', extension: 'evil' } as never)
    await code.storage.set('k', 1, { projectId: 'Q', extension: 'evil' } as never)

    expect(call.mock.calls).toEqual([
      [METHOD_READ_FILE, { projectId: 'Q', extension: 'jira', path: 'a.ts' }],
      [METHOD_STORAGE_SET, { projectId: 'Q', extension: 'jira', key: 'k', value: 1 }],
    ])
  })
})

describe('답의 모양', () => {
  it('http.fetch 답에 status 가 없으면 던진다', async () => {
    await expect(spy({}).code.http.fetch('https://jira')).rejects.toThrow(/status/)
  })

  it('secrets.get 답이 문자열도 undefined 도 아니면 던진다', async () => {
    await expect(spy(42).code.secrets.get('k')).rejects.toThrow(/문자열이 아닙니다/)
  })
})
