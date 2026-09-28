import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from './projectRegistry'
import { ProjectStore } from './projectStore'

// 프로젝트 탭 끌어 옮기기. 화면은 새 순서 전체를 보내고, 레지스트리는 **지금 열린 것의 순열**만 받는다.

let workDir = ''

function registry(): ProjectRegistry {
  const store = new ProjectStore(join(workDir, 'projects.json'), () => {})
  return new ProjectRegistry({ store, maxOpen: 5 })
}

/** 세 개를 연다. 활성은 마지막에 연 c */
async function openThree(reg: ProjectRegistry): Promise<[string, string, string]> {
  const ids: string[] = []
  for (const name of ['a', 'b', 'c']) {
    const path = join(workDir, name)
    await mkdir(path, { recursive: true })
    const result = await reg.open(await realpath(path))
    if (!result.ok) throw new Error(result.message)
    ids.push(result.project.id)
  }
  return ids as [string, string, string]
}

const order = (reg: ProjectRegistry) => reg.openProjects.map((project) => project.id)

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'davis-reorder-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('열린 탭 순서 바꾸기', () => {
  it('열린 것의 순열이면 그 순서를 받는다', async () => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)

    expect(await reg.reorder([c, a, b])).toBe(true)
    expect(order(reg)).toEqual([c, a, b])
  })

  it('활성은 그대로다 — 순서만 바뀐다', async () => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)

    await reg.reorder([b, c, a])
    expect(reg.active?.id).toBe(c)
  })

  // 화면이 낡은 목록으로 보낸 것들 — 그 사이 닫히거나 열린 것이 있었다
  it.each([
    ['빠진 것이 있으면', (a: string, b: string) => [a, b]],
    ['같은 id 가 두 번이면', (a: string, b: string) => [a, b, b]],
    ['모르는 id 가 섞이면', (a: string, b: string) => [a, b, 'ghost']],
  ])('%s 버리고 순서를 안 바꾼다', async (_label, make) => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)

    expect(await reg.reorder(make(a, b))).toBe(false)
    expect(order(reg)).toEqual([a, b, c])
  })

  it('닫힌 프로젝트 id 를 끼우면 버린다 — 최근 목록에 있어도 열린 것이 아니다', async () => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)
    await reg.close(b)

    expect(await reg.reorder([c, b, a])).toBe(false)
    expect(await reg.reorder([c, a])).toBe(true)
    expect(order(reg)).toEqual([c, a])
  })

  it('다시 켜도 순서가 남는다', async () => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)
    await reg.reorder([b, c, a])

    const after = registry()
    await after.restore()
    expect(order(after)).toEqual([b, c, a])
    expect(after.active?.id).toBe(c)
  })

  it('옮긴 뒤 새로 연 것은 맨 뒤에 붙는다', async () => {
    const reg = registry()
    const [a, b, c] = await openThree(reg)
    await reg.reorder([c, b, a])

    const path = join(workDir, 'd')
    await mkdir(path, { recursive: true })
    const opened = await reg.open(await realpath(path))
    if (!opened.ok) throw new Error(opened.message)
    expect(order(reg)).toEqual([c, b, a, opened.project.id])
  })
})
