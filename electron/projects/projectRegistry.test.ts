import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from './projectRegistry'
import { ProjectStore } from './projectStore'

// 목록 판단의 정본. 여기서 틀리면 세션도 화면도 같이 틀린다.

let workDir = ''
let clock = 1000

function tick(): number {
  clock += 10
  return clock
}

// macOS 는 /var 가 /private/var 심링크라 realpath 가 경로를 바꾼다.
// 레지스트리도 realpath 로 정규화하므로 기대값을 같은 기준으로 맞춘다.
async function makeDir(name: string): Promise<string> {
  const path = join(workDir, name)
  await mkdir(path, { recursive: true })
  return realpath(path)
}

function registry(maxOpen = 5): ProjectRegistry {
  const store = new ProjectStore(join(workDir, 'projects.json'), () => {})
  return new ProjectRegistry({ store, now: tick, maxOpen })
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'davis-registry-'))
  clock = 1000
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('열기', () => {
  it('폴더를 열면 basename 이 이름이 된다', async () => {
    const root = await makeDir('my-project')
    const result = await registry().open(root)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.name).toBe('my-project')
      expect(result.project.favorite).toBe(false)
      expect(result.alreadyOpen).toBe(false)
    }
  })

  it('폴더가 아니면 거부한다', async () => {
    const file = join(workDir, 'file.txt')
    await writeFile(file, 'x', 'utf8')

    const result = await registry().open(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_a_directory')
  })

  it('없는 경로는 거부한다', async () => {
    expect((await registry().open(join(workDir, '없음'))).ok).toBe(false)
  })

  // 설계 §4.3 — 사용자 의도는 "이 프로젝트를 보고 싶다" 이므로 오류를 띄울 자리가 아니다
  it('같은 프로젝트를 다시 열면 새로 만들지 않고 전환한다', async () => {
    const root = await makeDir('proj')
    const reg = registry()
    const first = await reg.open(root)
    const second = await reg.open(root)

    expect(reg.all).toHaveLength(1)
    expect(second.ok && second.alreadyOpen).toBe(true)
    if (first.ok && second.ok) {
      expect(second.project.id).toBe(first.project.id)
      expect(second.project.lastOpenedAt).toBeGreaterThan(first.project.lastOpenedAt)
    }
  })

  it('심링크로 들어와도 같은 프로젝트로 본다', async () => {
    const root = await makeDir('real')
    const link = join(workDir, 'link')
    await symlink(root, link)

    const reg = registry()
    await reg.open(root)
    const viaLink = await reg.open(link)

    expect(reg.all).toHaveLength(1)
    expect(viaLink.ok && viaLink.alreadyOpen).toBe(true)
  })

  it('이름을 바꿔도 같은 경로면 중복으로 잡는다', async () => {
    const root = await makeDir('proj')
    const reg = registry()
    const opened = await reg.open(root)
    if (opened.ok) await reg.rename(opened.project.id, '내 프로젝트')

    await reg.open(root)
    expect(reg.all).toHaveLength(1)
    expect(reg.all[0]!.name).toBe('내 프로젝트')
  })
})

describe('동시 열기 상한', () => {
  it('상한을 넘으면 거부하고 기존 것은 그대로 둔다', async () => {
    const reg = registry(2)
    await reg.open(await makeDir('a'))
    await reg.open(await makeDir('b'))

    const third = await reg.open(await makeDir('c'))

    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.reason).toBe('too_many_open')
    // 자동으로 닫지 않는다 — 돌고 있는 작업이 조용히 죽으면 안 된다 (설계 §4.4)
    expect(reg.openProjects).toHaveLength(2)
  })

  it('이미 열린 것을 다시 여는 것은 상한과 무관하다', async () => {
    const reg = registry(2)
    const first = await reg.open(await makeDir('a'))
    await reg.open(await makeDir('b'))

    if (first.ok) expect((await reg.open(first.project.root)).ok).toBe(true)
  })

  it('닫으면 자리가 난다', async () => {
    const reg = registry(2)
    const first = await reg.open(await makeDir('a'))
    await reg.open(await makeDir('b'))
    if (first.ok) await reg.close(first.project.id)

    expect((await reg.open(await makeDir('c'))).ok).toBe(true)
  })
})

describe('탭 순서', () => {
  // 탭을 누를 때마다 자리가 바뀌면 다음에 누를 곳을 예측할 수 없다
  it('연 순서를 지킨다 — 전환해도 자리가 바뀌지 않는다', async () => {
    const reg = registry()
    const first = await reg.open(await makeDir('a'))
    await reg.open(await makeDir('b'))
    await reg.open(await makeDir('c'))

    if (first.ok) await reg.activate(first.project.id)

    expect(reg.openProjects.map((p) => p.name)).toEqual(['a', 'b', 'c'])
  })

  it('즐겨찾기해도 탭 순서는 그대로다', async () => {
    const reg = registry()
    await reg.open(await makeDir('a'))
    const second = await reg.open(await makeDir('b'))
    if (second.ok) await reg.setFavorite(second.project.id, true)

    expect(reg.openProjects.map((p) => p.name)).toEqual(['a', 'b'])
    // 최근 목록은 여전히 즐겨찾기가 위다
    expect(reg.all.map((p) => p.name)).toEqual(['b', 'a'])
  })
})

describe('닫기와 활성', () => {
  it('닫아도 목록에는 남는다 — 다시 열 수 있어야 한다', async () => {
    const reg = registry()
    const opened = await reg.open(await makeDir('a'))
    if (opened.ok) await reg.close(opened.project.id)

    expect(reg.openProjects).toHaveLength(0)
    expect(reg.all).toHaveLength(1)
  })

  it('활성 프로젝트를 닫으면 남은 것으로 넘어간다', async () => {
    const reg = registry()
    await reg.open(await makeDir('a'))
    const second = await reg.open(await makeDir('b'))
    if (second.ok) await reg.close(second.project.id)

    expect(reg.active?.name).toBe('a')
  })

  it('열려 있지 않은 프로젝트는 활성으로 만들지 않는다', async () => {
    const reg = registry()
    const opened = await reg.open(await makeDir('a'))
    if (opened.ok) {
      await reg.close(opened.project.id)
      expect(await reg.activate(opened.project.id)).toBe(false)
    }
  })
})

describe('즐겨찾기와 이름', () => {
  it('이름을 바꾼다', async () => {
    const reg = registry()
    const opened = await reg.open(await makeDir('a'))
    if (opened.ok) {
      expect(await reg.rename(opened.project.id, '  새 이름  ')).toBe(true)
      expect(reg.all[0]!.name).toBe('새 이름')
    }
  })

  it('빈 이름은 거부한다 — 이름 없는 항목은 고를 수 없다', async () => {
    const reg = registry()
    const opened = await reg.open(await makeDir('a'))
    if (opened.ok) {
      expect(await reg.rename(opened.project.id, '   ')).toBe(false)
      expect(reg.all[0]!.name).toBe('a')
    }
  })

  it('즐겨찾기를 켜면 목록에서 위로 온다', async () => {
    const reg = registry()
    const first = await reg.open(await makeDir('a'))
    await reg.open(await makeDir('b'))
    if (first.ok) await reg.setFavorite(first.project.id, true)

    expect(reg.all.map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('없는 id 는 조용히 실패한다', async () => {
    const reg = registry()
    expect(await reg.rename('없음', 'x')).toBe(false)
    expect(await reg.setFavorite('없음', true)).toBe(false)
  })
})

describe('복원', () => {
  it('저장된 목록과 활성 프로젝트를 되살린다', async () => {
    const root = await makeDir('a')
    const before = registry()
    await before.open(root)

    const after = registry()
    await after.restore()

    expect(after.all).toHaveLength(1)
    expect(after.active?.root).toBe(root)
    expect(after.openProjects).toHaveLength(1)
  })

  it('사라진 폴더는 목록에서 걸러낸다', async () => {
    const root = await makeDir('사라질것')
    const before = registry()
    await before.open(root)
    await rm(root, { recursive: true, force: true })

    const after = registry()
    await after.restore()

    expect(after.all).toHaveLength(0)
    expect(after.active).toBeNull()
  })

  it('저장된 것이 없으면 빈 상태로 시작한다', async () => {
    const reg = registry()
    await reg.restore()

    expect(reg.all).toEqual([])
    expect(reg.active).toBeNull()
  })
})

