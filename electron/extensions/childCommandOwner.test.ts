import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createChildHandler } from './childHandlers'
import { METHOD_LOAD_EXTENSIONS, METHOD_RUN_COMMAND, type RpcRequest } from './rpc'
import type { ExtensionSource } from './extensionLoader'
import type { ExtensionApi } from './extensionApi'

// **확장 화면에서 온 명령이 남의 확장 것을 돌리지 못하는가** (설계 §5).
//
// 명령표는 확장 전부가 나눠 쓰는 한 장이다. 그래서 이 결함은 **확장이 둘 이상 실려야**
// 드러난다 — 하나만 놓고 보면 어느 확장의 명령이든 늘 맞는 것처럼 보인다.
// (하네스 원칙: 회귀 그물과 결함 탐지기는 다르다.)
//
// 실제 디렉토리를 만든다. 싣기가 `resolveInside`·`isFile` 로 디스크를 보므로
// (`extensionLoader.ts` — main 이 루트 안인지 보증하는 자리) 가짜 경로로는 안 실린다.

let extensionsDir: string

beforeAll(async () => {
  extensionsDir = await mkdtemp(join(tmpdir(), 'ext-owner-'))
})

async function makeExtension(name: string): Promise<ExtensionSource> {
  const dir = join(extensionsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'main.js'), '', 'utf8')
  return {
    dir,
    manifest: { manifestVersion: 2, name, displayName: name, version: '1.0.0', main: 'main.js' },
  }
}

/** 두 확장이 각자 명령 하나씩을 등록한 자식 처리기 */
async function loaded(): Promise<{
  handle: (request: RpcRequest) => Promise<unknown>
  가: ReturnType<typeof vi.fn>
  나: ReturnType<typeof vi.fn>
}> {
  const 가 = vi.fn(() => '가 돌았다')
  const 나 = vi.fn(() => '나 돌았다')

  const handle = createChildHandler(() => ({}) as unknown as ExtensionApi, {
    requireModule: (path: string) => ({
      activate: () => ({ commands: path.includes('가') ? { '가.run': 가 } : { '나.run': 나 } }),
    }),
  })

  const sources = [await makeExtension('가'), await makeExtension('나')]
  const result = await handle({ kind: 'request', id: 'l', method: METHOD_LOAD_EXTENSIONS, params: { extensions: sources } })
  // 싣기가 조용히 실패하면 아래 시험이 **전부 「없는 명령」으로 초록**이 된다
  expect(result).toEqual({ loaded: ['가', '나'], failed: [] })

  return { handle, 가, 나 }
}

const request = (params: unknown): RpcRequest => ({
  kind: 'request',
  id: 'r1',
  method: METHOD_RUN_COMMAND,
  params,
})

describe('확장 화면에서 온 명령의 주인 확인', () => {
  it('자기 확장의 명령은 돈다', async () => {
    const { handle, 가 } = await loaded()

    await handle(request({ commandId: '가.run', extension: '가' }))

    expect(가).toHaveBeenCalledTimes(1)
  })

  it('**남의 확장 명령은 거부한다** — 다리는 모든 확장 화면이 함께 쓴다', async () => {
    const { handle, 나 } = await loaded()

    // 확장 「가」의 화면이 확장 「나」의 명령을 부른다
    await expect(handle(request({ commandId: '나.run', extension: '가' }))).rejects.toThrow('남의 확장')
    expect(나).not.toHaveBeenCalled()
  })

  it('주인이 안 실려 오면 확인하지 않는다 — 사이드바 단추의 옛 경로', async () => {
    const { handle, 나 } = await loaded()

    await handle(request({ commandId: '나.run' }))

    expect(나).toHaveBeenCalledTimes(1)
  })

  it('없는 명령은 주인을 실어도 없는 명령이다', async () => {
    const { handle } = await loaded()

    await expect(handle(request({ commandId: '없다.run', extension: '가' }))).rejects.toThrow(
      '등록되지 않은 명령',
    )
  })
})
