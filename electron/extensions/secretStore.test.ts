import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretStore, type SecretCipher } from './secretStore'
import { createExtensionApi } from './extensionApi'
import { dispatchExtensionApi, portsOf } from './serviceDispatch'
import { createRequest } from './rpc'
import { ExtensionWorkspace } from './workspaceApi'

// `code.secrets` — 확장의 비밀을 **OS 보안 저장소로 암호화해** 둔다 (하이닉스 요구사항 확장 §5-1, H1).
// vitest 에서 electron 은 가짜라 `safeStorage` 대신 뒤집어 감싸는 가짜 암호기를 끼운다 —
// 여기서 잠그는 것은 「암호기를 **반드시** 거친다」와 「못 쓰면 평문으로 떨어지지 않는다」다.

let root = ''

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ext-secrets-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function cipher(available = true): SecretCipher & { used: number } {
  const state = {
    used: 0,
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => {
      state.used += 1
      return Buffer.from([...Buffer.from(plain, 'utf8')].map((byte) => byte ^ 0x5a))
    },
    decryptString: (encrypted: Buffer) => Buffer.from([...encrypted].map((byte) => byte ^ 0x5a)).toString('utf8'),
  }
  return state
}

async function files(): Promise<string[]> {
  return readdir(root).catch(() => [])
}

describe('암호화', () => {
  it('파일에 평문이 없다 — 값도 키 이름도', async () => {
    const store = createSecretStore(root, cipher())

    await store.set('jira', 'jiraToken', 'ATATT-평문이면-안-된다')

    const [only] = await files()
    const bytes = await readFile(join(root, only as string))
    expect(bytes.includes(Buffer.from('ATATT-평문이면-안-된다'))).toBe(false)
    expect(bytes.includes(Buffer.from('jiraToken'))).toBe(false)
    expect(await store.get('jira', 'jiraToken')).toBe('ATATT-평문이면-안-된다')
  })

  it('OS 보안 저장소를 못 쓰면 거절하고 **아무것도 쓰지 않는다** (평문으로 떨어지지 않는다)', async () => {
    const store = createSecretStore(root, cipher(false))

    await expect(store.set('jira', 'jiraToken', 'x')).rejects.toThrow(/평문으로 저장하지 않습니다/)
    await expect(store.get('jira', 'jiraToken')).rejects.toThrow(/OS 보안 저장소를 쓸 수 없어/)
    expect(await files()).toEqual([])
  })

  it('없는 키는 undefined, 지우면 다시 undefined', async () => {
    const store = createSecretStore(root, cipher())
    expect(await store.get('jira', 'jiraToken')).toBeUndefined()
    await store.set('jira', 'jiraToken', 't')
    await store.delete('jira', 'jiraToken')
    expect(await store.get('jira', 'jiraToken')).toBeUndefined()
  })

  it('forget 은 그 확장의 파일만 지운다', async () => {
    const store = createSecretStore(root, cipher())
    await store.set('jira', 'k', '1')
    await store.set('other', 'k', '2')

    await store.forget('jira')

    expect(await store.get('jira', 'k')).toBeUndefined()
    expect(await store.get('other', 'k')).toBe('2')
    expect(await files()).toHaveLength(1)
  })
})

describe('확장 사이 격리 (자식 API → 부모 분기)', () => {
  /** 두 확장이 **같은 부모**를 부른다. 이름은 자식 쪽 API 가 채운다 */
  function two() {
    const deps = portsOf(
      { workspace: new ExtensionWorkspace(() => null), secrets: createSecretStore(root, cipher()) },
      {
        projectId: () => null,
        allowedIn: async () => undefined,
        emitRows: () => {},
        emitHtml: () => {},
        emitTree: () => {},
        emitProgress: () => {},
        notifyChild: () => {},
      },
    )
    const call = (method: string, params?: unknown) => dispatchExtensionApi(deps, createRequest(method, params))
    return { mine: createExtensionApi(call, 'jira'), theirs: createExtensionApi(call, 'other') }
  }

  it('남의 비밀은 안 보인다 — 같은 키라도 확장마다 칸이 다르다', async () => {
    const { mine, theirs } = two()

    await mine.secrets.set('token', 'mine-secret')

    expect(await theirs.secrets.get('token')).toBeUndefined()
    await theirs.secrets.set('token', 'theirs-secret')
    expect(await mine.secrets.get('token')).toBe('mine-secret')
  })

  it('프로젝트를 안 본다 — 겉봉이 없어도(activate·타이머) 쓰고 읽는다', async () => {
    const { mine } = two()
    await mine.secrets.set('token', 't')
    expect(await mine.secrets.get('token')).toBe('t')
  })
})
