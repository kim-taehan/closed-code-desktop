import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from './projectStore'

// 저장소는 앱을 죽이지 않는 것이 제1 책임이다.
// 손상된 파일·없는 파일·못 쓰는 경로 어느 것도 예외로 새어 나가면 안 된다.

let dir = ''
let filePath = ''
const errors: string[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'davis-projects-'))
  filePath = join(dir, 'projects.json')
  errors.length = 0
})

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => {})
  await rm(dir, { recursive: true, force: true })
})

function store(): ProjectStore {
  return new ProjectStore(filePath, (message) => errors.push(message))
}

const SAMPLE = {
  id: 'p1',
  root: '/tmp/proj',
  name: 'proj',
  favorite: false,
  lastOpenedAt: 100,
}

describe('읽기', () => {
  it('파일이 없으면 빈 상태로 시작한다 — 첫 실행은 오류가 아니다', async () => {
    expect(await store().load()).toEqual({ projects: [], openIds: [], activeId: null })
    expect(errors).toHaveLength(0)
  })

  it('저장한 것을 그대로 되읽는다', async () => {
    const state = { projects: [SAMPLE], openIds: ['p1'], activeId: 'p1' }
    await store().save(state)

    expect(await store().load()).toEqual(state)
  })

  it('손상된 JSON 은 빈 상태로 시작하고 앱을 죽이지 않는다', async () => {
    await writeFile(filePath, '{ 이건 JSON 이 아니다', 'utf8')

    expect(await store().load()).toEqual({ projects: [], openIds: [], activeId: null })
    expect(errors[0]).toContain('읽지 못했습니다')
  })

  it('망가진 항목 하나 때문에 나머지를 버리지 않는다', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ projects: [SAMPLE, { name: 'id 도 root 도 없음' }, null, 7] }),
      'utf8',
    )

    const loaded = await store().load()
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0]!.id).toBe('p1')
  })

  it('빠진 필드는 안전한 기본값으로 채운다', async () => {
    await writeFile(filePath, JSON.stringify({ projects: [{ id: 'p2', root: '/tmp/x' }] }), 'utf8')

    expect((await store().load()).projects[0]).toEqual({
      id: 'p2',
      root: '/tmp/x',
      name: '/tmp/x',
      favorite: false,
      lastOpenedAt: 0,
    })
  })

  it('projects 가 배열이 아니면 빈 목록으로 본다', async () => {
    await writeFile(filePath, JSON.stringify({ projects: 'nope', activeId: 42 }), 'utf8')

    expect(await store().load()).toEqual({ projects: [], openIds: [], activeId: null })
  })
})

describe('쓰기', () => {
  it('쓸 수 없어도 예외를 던지지 않는다 — 복원은 편의지 정확성이 아니다', async () => {
    const readOnly = new ProjectStore(join(dir, 'nope', 'projects.json'), (m) => errors.push(m))
    await chmod(dir, 0o500)

    await expect(readOnly.save({ projects: [], openIds: [], activeId: null })).resolves.toBeUndefined()
    expect(errors[0]).toContain('쓰지 못했습니다')
  })
})
