import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import type { RunListResultPayload } from '../../shared/ipc/runBridgeSurface'
import { diskFingerprint } from '../run/runManifestDisk'
import { writeRunList } from '../run/runListStore'
import { registerRunListHandlers } from './runListHandlers'

// 화면이 목록을 읽는 문. 겨누는 것은 셋이다:
//   · **닫힌 프로젝트에는 아무것도 안 준다** — 앱 저장소는 프로젝트 경계가 없어, 이 판정이
//     빠지면 아무 id 나 물어도 남의 목록이 나온다 (파일 쪽은 `ProjectFs` 가 막아 주던 자리다)
//   · 「없다」와 「비어 있다」를 가른다
//   · **「다시 확인할까요?」 판정이 여기서 난다** — 지문을 재는 곳이 둘이면 값이 갈린다

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    },
  },
}))

async function read(projectId: string): Promise<RunListResultPayload> {
  const handler = handlers.get(Channel.RUN_LIST_READ)
  if (handler === undefined) throw new Error('핸들러가 등록되지 않았다')
  return (await handler(null, { projectId })) as RunListResultPayload
}

describe('RUN_LIST_READ', () => {
  let dir: string
  let root: string

  beforeEach(async () => {
    handlers.clear()
    dir = await mkdtemp(join(tmpdir(), 'run-read-store-'))
    root = await mkdtemp(join(tmpdir(), 'run-read-project-'))
    registerRunListHandlers({ rootOf: (id) => (id === 'A' ? root : null), dir })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })

  it('적어 둔 목록을 준다. 지문이 그대로면 다시 묻지 않는다', async () => {
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}', 'utf8')
    await writeRunList(dir, {
      entries: [{ name: 'dev', command: 'npm run dev' }],
      manifest: await diskFingerprint(root),
      project: root,
    })

    expect(await read('A')).toEqual({
      found: true,
      entries: [{ name: 'dev', command: 'npm run dev' }],
      stale: false,
    })
  })

  it('매니페스트가 바뀌면 stale — 화면이 "다시 확인할까요?" 를 띄운다', async () => {
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}', 'utf8')
    await writeRunList(dir, {
      entries: [{ name: 'dev', command: 'npm run dev' }],
      manifest: await diskFingerprint(root),
      project: root,
    })
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"next dev"}}', 'utf8')

    expect((await read('A')).stale).toBe(true)
  })

  it('지문이 없으면 묻지 않는다 — 우리가 적은 것이 아닌 목록을 덮어쓰자고 청하지 않는다', async () => {
    await writeRunList(dir, { entries: [], manifest: null, project: root })

    // 비어 있는 것과 없는 것은 다른 사실이다 — 여기서 갈린다
    expect(await read('A')).toEqual({ found: true, entries: [], stale: false })
  })

  it('아직 적은 것이 없으면 「없다」', async () => {
    expect(await read('A')).toEqual({ found: false, entries: [], stale: false })
  })

  // 저장소에는 프로젝트 경계가 없다 — 이 판정이 유일한 문이다
  it('닫힌(모르는) 프로젝트에는 아무것도 주지 않는다', async () => {
    await writeRunList(dir, {
      entries: [{ name: 'dev', command: 'npm run dev' }],
      manifest: null,
      project: root,
    })

    expect(await read('모르는id')).toEqual({ found: false, entries: [], stale: false })
  })
})
