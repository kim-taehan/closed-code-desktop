import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExtensionStorage } from './storageStore'

// **겹쳐 쓰기.** `storageStore.test.ts` 에서 갈라냈다 — 저쪽은 값이 새는지(확장·프로젝트
// 경계)를 보고, 이쪽은 **동시에 쓰면 잃는지**를 본다.
//
// 잡는 회귀: `set` 은 「읽고-고쳐-쓰기」인데 한 프로젝트의 키를 파일 하나에 모아 둔다.
// 겹쳐 들어오면 둘 다 같은 옛 덩어리를 읽어 각자 자기 키만 얹어 쓰므로 **나중 것이 앞 것을
// 통째로 덮는다.** 확장이 여러 갈래로 도는 것은 흔한 일이라(테스트 시나리오 확장은 넷을
// 겹쳐 돌린다) 저장한 결과가 조용히 사라질 수 있었다.

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ext-storage-race-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const EXT = 'test-scenario'
const PROJECT = '/프로젝트/가'

describe('겹쳐 쓰기', () => {
  it('동시에 넣은 키가 **하나도 안 사라진다**', async () => {
    const storage = createExtensionStorage(root)
    const keys = Array.from({ length: 24 }, (_, at) => `scenario:대상${at}`)

    await Promise.all(keys.map((key, at) => storage.set(EXT, PROJECT, key, { items: at })))

    for (const [at, key] of keys.entries()) {
      expect(await storage.get(EXT, PROJECT, key)).toEqual({ items: at })
    }
  })

  it('겹쳐 쓰는 중에도 임시 파일 다툼으로 터지지 않는다', async () => {
    const storage = createExtensionStorage(root)

    // 하나라도 거부되면 여기서 터진다 — 예전에는 `rename` 이 ENOENT 로 실패했다
    await expect(
      Promise.all(Array.from({ length: 30 }, (_, at) => storage.set(EXT, PROJECT, `k${at}`, at))),
    ).resolves.toHaveLength(30)
  })

  it('같은 키를 겹쳐 쓰면 **마지막 것이 남는다** — 순서대로 한 줄로 선다', async () => {
    const storage = createExtensionStorage(root)

    await Promise.all([1, 2, 3, 4, 5].map((one) => storage.set(EXT, PROJECT, '건수', one)))

    expect(await storage.get(EXT, PROJECT, '건수')).toBe(5)
  })

  it('한 번 터져도 뒤에 선 것들이 함께 막히지 않는다', async () => {
    const storage = createExtensionStorage(root)
    // 상한(8MB)을 넘겨 일부러 거절당한다
    const toobig = 'ㄱ'.repeat(9 * 1024 * 1024)

    const failing = storage.set(EXT, PROJECT, '큰것', toobig)
    const after = storage.set(EXT, PROJECT, '작은것', '멀쩡함')

    await expect(failing).rejects.toThrow('저장 용량')
    await expect(after).resolves.toBeUndefined()
    expect(await storage.get(EXT, PROJECT, '작은것')).toBe('멀쩡함')
  })

  it('다른 프로젝트끼리는 서로 기다리지 않는다 — 파일이 다르다', async () => {
    const storage = createExtensionStorage(root)

    await Promise.all([
      storage.set(EXT, '/프로젝트/가', '건수', 1),
      storage.set(EXT, '/프로젝트/나', '건수', 2),
    ])

    expect(await storage.get(EXT, '/프로젝트/가', '건수')).toBe(1)
    expect(await storage.get(EXT, '/프로젝트/나', '건수')).toBe(2)
  })
})
