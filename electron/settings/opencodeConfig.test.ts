import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  disposeInstance,
  globalConfigPath,
  readOpencodeConfig,
  writeOpencodeConfig,
} from './opencodeConfig'

// opencode 설정 파일 읽기/쓰기.
//
// **가장 나쁜 결과는 여기서 쓴 파일 때문에 opencode 가 안 뜨는 것이다** — 설정이 깨지면
// 서버가 시작하지 않는다. 그래서 "깨진 JSON 은 안 쓴다"·"덮어쓰기 전 사본을 남긴다" 를 잠근다.

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ocfg-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('globalConfigPath', () => {
  it('XDG_CONFIG_HOME 을 따른다 — 없으면 ~/.config', () => {
    const before = process.env['XDG_CONFIG_HOME']
    process.env['XDG_CONFIG_HOME'] = '/tmp/xdg'
    expect(globalConfigPath()).toBe('/tmp/xdg/opencode/opencode.json')
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    expect(globalConfigPath()).toMatch(/opencode\/opencode\.json$/)
  })
})

describe('readOpencodeConfig', () => {
  it('프로젝트 파일 원문을 준다', async () => {
    await writeFile(join(dir, 'opencode.json'), '{ "model": "a/b" }')
    const result = await readOpencodeConfig(dir, '')
    const project = result.files.find((file) => file.scope === 'project')
    expect(project?.content).toBe('{ "model": "a/b" }')
    expect(project?.error).toBeUndefined()
  })

  it('없는 파일은 오류가 아니다 — 아직 안 만든 상태를 그대로 보인다', async () => {
    const result = await readOpencodeConfig(dir, '')
    const project = result.files.find((file) => file.scope === 'project')
    expect(project?.content).toBeNull()
    expect(project?.error).toBeUndefined()
  })

  it('열린 프로젝트가 없으면 전역만 본다', async () => {
    const result = await readOpencodeConfig('', '')
    expect(result.files.map((file) => file.scope)).toEqual(['global'])
  })

  it('서버 주소가 없으면 유효 설정은 사유와 함께 빈다 — 파일은 그대로 준다', async () => {
    const result = await readOpencodeConfig(dir, '')
    expect(result.effective).toBeUndefined()
    expect(result.effectiveError).toBeTruthy()
    expect(result.files.length).toBeGreaterThan(0)
  })
})

describe('disposeInstance', () => {
  it('평문 `directory=` 로 instance 를 버린다 — 이게 설정을 다시 읽히는 유일한 길이다', async () => {
    const calls: { url: string; method?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method })
      return { ok: true, status: 200 } as unknown as Response
    })

    const result = await disposeInstance('/tmp/내 프로젝트', 'http://127.0.0.1:4096/')
    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:4096/instance/dispose?directory=%2Ftmp%2F%EB%82%B4%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8',
        method: 'POST',
      },
    ])
    vi.unstubAllGlobals()
  })

  it('열린 프로젝트나 주소가 없으면 부르지 않는다', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return { ok: true, status: 200 } as unknown as Response
    })
    expect((await disposeInstance('', 'http://x')).ok).toBe(false)
    expect((await disposeInstance('/tmp/p', '')).ok).toBe(false)
    expect(calls).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('writeOpencodeConfig', () => {
  it('깨진 JSON 은 쓰지 않는다 — 그 파일로는 opencode 가 안 뜬다', async () => {
    const path = join(dir, 'opencode.json')
    await writeFile(path, '{ "model": "그대로" }')

    const result = await writeOpencodeConfig(path, '{ 깨짐')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('JSON')
    // 원본이 그대로여야 한다
    expect(await readFile(path, 'utf8')).toBe('{ "model": "그대로" }')
  })

  it('덮어쓰기 전에 .bak 을 남긴다', async () => {
    const path = join(dir, 'opencode.json')
    await writeFile(path, '{ "model": "before" }')

    const result = await writeOpencodeConfig(path, '{ "model": "after" }')
    expect(result.ok).toBe(true)
    expect(result.backupPath).toBe(`${path}.bak`)
    expect(await readFile(path, 'utf8')).toBe('{ "model": "after" }')
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('{ "model": "before" }')
  })

  it('없던 파일은 폴더까지 만들어 새로 쓴다 — 사본은 없다', async () => {
    const path = join(dir, 'nested', 'opencode', 'opencode.json')
    const result = await writeOpencodeConfig(path, '{}')
    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeUndefined()
    expect(await readFile(path, 'utf8')).toBe('{}')
  })

  it('성공하면 다시 띄워야 한다고 알린다 — 서버는 읽은 설정을 들고 있다', async () => {
    await mkdir(join(dir, 'x'), { recursive: true })
    const result = await writeOpencodeConfig(join(dir, 'x', 'opencode.json'), '{}')
    expect(result.needsReload).toBe(true)
  })
})
