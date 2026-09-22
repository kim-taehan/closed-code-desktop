import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionSessionStore, isExtensionSession, useExtensionSessionStore } from './extensionSessions'
import { listSessions } from './historyApi'

// 확장 세션 장부와 **이력 숨김** (확장 재설계 U-A 안 B, 결정 F3).

const dirs: string[] = []
function ledgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ext-ai-sessions-'))
  dirs.push(dir)
  return join(dir, 'nested', 'extension-ai-sessions.json')
}

afterEach(() => {
  useExtensionSessionStore(null)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 서버가 준 목록 — 사용자 대화 둘 사이에 확장 세션 하나 */
const serverList = [
  { id: 'ses_user1', title: '사용자 대화' },
  { id: 'ses_ext1', title: 'ext:code-map' },
  { id: 'ses_user2', title: '또 다른 대화' },
]
const getter = <T>(path: string): Promise<T> => {
  expect(path).toContain('directory=')
  return Promise.resolve(serverList as T)
}

describe('이력 목록에서 확장 세션을 뺀다', () => {
  it('장부에 적힌 id 만 빠지고 순서는 그대로다', async () => {
    const store = new ExtensionSessionStore(ledgerPath())
    store.set('code-map', 'p1', 'ses_ext1')
    useExtensionSessionStore(store)

    const listed = await listSessions(getter, '/tmp/p1')
    expect(listed.map((session) => session.id)).toEqual(['ses_user1', 'ses_user2'])
  })

  it('제목이 ext: 로 시작해도 장부에 없으면 빼지 않는다 — 제목으로 짐작하지 않는다', async () => {
    useExtensionSessionStore(new ExtensionSessionStore(ledgerPath()))
    const listed = await listSessions(getter, '/tmp/p1')
    expect(listed).toHaveLength(3)
  })
})

describe('장부', () => {
  it('앱을 다시 켜도 같은 세션을 쓰고 계속 숨긴다', () => {
    const path = ledgerPath()
    new ExtensionSessionStore(path).set('code-map', 'p1', 'ses_ext1')

    const reopened = new ExtensionSessionStore(path)
    useExtensionSessionStore(reopened)
    expect(reopened.get('code-map', 'p1')).toBe('ses_ext1')
    expect(reopened.get('code-map', 'p2')).toBeUndefined()
    expect(isExtensionSession('ses_ext1')).toBe(true)
  })

  it('확장을 지우면 그 확장의 줄만 빠지고, 그 세션은 이력에 계속 안 뜬다', () => {
    const path = ledgerPath()
    const store = new ExtensionSessionStore(path)
    useExtensionSessionStore(store)
    store.set('code-map', 'p1', 'ses_ext1')
    store.set('code-map', 'p2', 'ses_ext2')
    store.set('todo', 'p1', 'ses_todo')

    store.forget('code-map')

    expect(store.get('code-map', 'p1')).toBeUndefined()
    expect(store.get('todo', 'p1')).toBe('ses_todo')
    expect(['ses_ext1', 'ses_ext2', 'ses_todo'].map(isExtensionSession)).toEqual([true, true, true])
    expect(new ExtensionSessionStore(path).get('code-map', 'p2'), '지운 것이 파일에도 남지 않는다').toBeUndefined()
  })

  it('깨진 파일은 빈 장부로 시작한다', () => {
    const path = ledgerPath()
    new ExtensionSessionStore(path).set('code-map', 'p1', 'ses_ext1')
    writeFileSync(path, '{깨짐', 'utf8')
    expect(new ExtensionSessionStore(path).get('code-map', 'p1')).toBeUndefined()
  })
})
