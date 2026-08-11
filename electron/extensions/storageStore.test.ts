import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExtensionStorage } from './storageStore'

// 확장 저장소를 **진짜 디스크에** 굴린다. 여기서 잡으려는 것은 하나다 —
// 확장끼리·프로젝트끼리 값이 새는가.

let root: string
const created: string[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ext-storage-'))
  created.push(root)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

describe('확장 저장소', () => {
  it('넣은 것을 그대로 돌려준다', async () => {
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/프로젝트/가', 'scenarios', [{ id: 'TS-F-001' }])

    expect(await storage.get('test-scenario', '/프로젝트/가', 'scenarios')).toEqual([{ id: 'TS-F-001' }])
  })

  it('확장이 다르면 같은 키라도 서로 안 보인다', async () => {
    // 자식은 확장 전부를 한 프로세스에 싣는다 — 안 가르면 `results` 같은 흔한 키가 충돌한다.
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/프로젝트/가', 'results', '시나리오')
    await storage.set('program-map', '/프로젝트/가', 'results', '프로그램')

    expect(await storage.get('test-scenario', '/프로젝트/가', 'results')).toBe('시나리오')
    expect(await storage.get('program-map', '/프로젝트/가', 'results')).toBe('프로그램')
  })

  it('프로젝트가 다르면 서로 안 보인다', async () => {
    // A 를 분석한 결과가 B 에서 보이면 사람이 그것을 B 의 산출물로 읽는다.
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/프로젝트/가', 'results', '가의 것')

    expect(await storage.get('test-scenario', '/프로젝트/나', 'results')).toBeUndefined()
    expect(await storage.get('test-scenario', null, 'results')).toBeUndefined()
  })

  it('넣은 적 없는 키는 undefined, 일부러 넣은 null 은 null', async () => {
    // 둘을 합치면 "저장한 적 없음" 과 "비었다고 저장함" 이 구분되지 않는다.
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/가', '있음', null)

    expect(await storage.get('test-scenario', '/가', '있음')).toBeNull()
    expect(await storage.get('test-scenario', '/가', '없음')).toBeUndefined()
  })

  it('undefined 를 넣으면 그 키를 지운다', async () => {
    const storage = createExtensionStorage(root)
    await storage.set('test-scenario', '/가', 'k', 1)

    await storage.set('test-scenario', '/가', 'k', undefined)

    expect(await storage.get('test-scenario', '/가', 'k')).toBeUndefined()
  })

  it('한 프로젝트의 키 여럿이 서로를 지우지 않는다', async () => {
    // 파일 하나에 모으므로, 읽고-고치고-쓰기가 깨지면 앞 키가 사라진다.
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/가', 'list', ['a'])
    await storage.set('test-scenario', '/가', 'scenarios', ['b'])

    expect(await storage.get('test-scenario', '/가', 'list')).toEqual(['a'])
    expect(await storage.get('test-scenario', '/가', 'scenarios')).toEqual(['b'])
  })

  it('상한을 넘으면 사유와 함께 거절한다', async () => {
    // 삼키면 다음 실행에서 "저장했는데 없다" 로만 보인다.
    const storage = createExtensionStorage(root)

    await expect(storage.set('test-scenario', '/가', 'big', 'x'.repeat(9 * 1024 * 1024))).rejects.toThrow('상한')
  })

  it('파일이 깨져 있어도 확장이 멈추지 않는다', async () => {
    // 저장 중 앱이 죽어 반쪽 JSON 이 남았을 때. 다음 저장이 덮어쓴다.
    const storage = createExtensionStorage(root)
    await storage.set('test-scenario', '/가', 'k', 1)
    const dirs = await readdir(root)
    const files = await readdir(join(root, dirs[0] as string))
    await writeFile(join(root, dirs[0] as string, files[0] as string), '{깨짐', 'utf8')

    expect(await storage.get('test-scenario', '/가', 'k')).toBeUndefined()
    await storage.set('test-scenario', '/가', 'k', 2)
    expect(await storage.get('test-scenario', '/가', 'k')).toBe(2)
  })

  it('임시 파일을 남기지 않는다', async () => {
    const storage = createExtensionStorage(root)

    await storage.set('test-scenario', '/가', 'k', 1)

    const dirs = await readdir(root)
    const files = await readdir(join(root, dirs[0] as string))
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
