import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFs } from './projectFs'

// openInOs 가 부르는 shell 만 바꿔 끼운다. 팩토리 안에서 지연 호출하므로
// 호이스팅돼도 아래 vi.fn 정의를 안전하게 잡는다.
const showItemInFolder = vi.fn()
const openPath = vi.fn(async (_path: string) => '')
// 휴지통은 **진짜로 부르지 않는다** — 시험이 사용자 휴지통을 채우면 안 되고,
// OS 마다 되는 조건이 달라 초록/빨강이 기계를 탄다. 그 자리에 도달했나만 잰다.
const trashItem = vi.fn(async (_path: string) => {})
vi.mock('electron', () => ({
  shell: {
    showItemInFolder: (path: string) => showItemInFolder(path),
    openPath: (path: string) => openPath(path),
    trashItem: (path: string) => trashItem(path),
  },
}))

// **만들기·이름변경·휴지통** (`fsAction`). 읽기 쪽은 `projectFs.test.ts` 가 본다 —
// 저 파일이 300줄 상한에 닿아 갈랐다.
//
// 여기서 잠그는 것은 둘이다: **경계**(루트 밖은 못 건드린다)와 **덮어쓰지 않는다**.
// 이 클래스가 오래도록 「덮어쓰기만」 하던 자리라, 새로 연 문마다 그 둘을 다시 잰다.

let workDir = ''
let projectRoot = ''
let outside = ''

beforeEach(async () => {
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'davis-fs-')))
  projectRoot = join(workDir, 'project')
  outside = join(workDir, 'secrets')

  await mkdir(join(projectRoot, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), '#', 'utf8')
  await writeFile(join(projectRoot, 'src', 'index.ts'), '', 'utf8')
  await writeFile(join(outside, 'password.txt'), 'secret', 'utf8')
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
  // 스파이는 시험을 넘어 산다 — 안 비우면 앞 시험의 호출이 「부르지 않았다」를 깬다
  trashItem.mockClear()
})

function fs(open: { id: string; root: string }[] = [{ id: 'p1', root: projectRoot }]): ProjectFs {
  return new ProjectFs({ openProjects: open })
}

// 만들기·이름변경·휴지통 (`fsAction`). 이 파일이 오래도록 「덮어쓰기만」 하던 자리라,
// 여기서 잠그는 것은 **경계**와 **덮어쓰지 않는다** 둘이다.
describe('만들고 옮기고 버린다', () => {
  const read = async (path: string) => (await import('node:fs/promises')).readFile(path, 'utf8')
  const there = async (path: string) =>
    (await import('node:fs/promises')).stat(path).then(() => true, () => false)

  describe('새 파일', () => {
    it('빈 파일을 만든다', async () => {
      expect(await fs().fsAction('p1', { kind: 'newFile', path: 'src/새것.ts' })).toEqual({ ok: true })
      expect(await read(join(projectRoot, 'src', '새것.ts'))).toBe('')
    })

    // **있는 파일을 조용히 비우는 것이 이 조작의 최악이다.**
    it('있는 파일을 덮지 않는다', async () => {
      const before = await read(join(projectRoot, 'README.md'))

      expect(await fs().fsAction('p1', { kind: 'newFile', path: 'README.md' })).toEqual({
        ok: false,
        reason: 'exists',
      })
      expect(await read(join(projectRoot, 'README.md'))).toBe(before)
    })

    it('루트 밖에는 못 만든다', async () => {
      expect(await fs().fsAction('p1', { kind: 'newFile', path: '../secrets/새것.txt' })).toEqual({
        ok: false,
        reason: 'not_allowed',
      })
      expect(await there(join(outside, '새것.txt'))).toBe(false)
    })
  })

  describe('새 폴더', () => {
    it('있는 폴더 안에 만든다', async () => {
      expect(await fs().fsAction('p1', { kind: 'newDir', path: 'src/새폴더' })).toEqual({ ok: true })
      expect(await there(join(projectRoot, 'src', '새폴더'))).toBe(true)
    })

    // **부모가 없으면 안 만든다.** 경계를 재는 길이 「부모를 실경로로 펴는 것」이라
    // (`resolveNewInside`) 부모가 없으면 잴 수가 없다. 우클릭 메뉴는 늘 있는 폴더 위에서
    // 열리므로 실제로 막히는 자리가 아니고, 여기를 열려면 **어디까지 만들어도 되는지**를
    // 다시 판정해야 한다 — 경계 코드를 늘릴 값이 아직 없다.
    it('중간 폴더를 말없이 만들지 않는다', async () => {
      expect(await fs().fsAction('p1', { kind: 'newDir', path: 'src/a/b' })).toEqual({
        ok: false,
        reason: 'not_allowed',
      })
      expect(await there(join(projectRoot, 'src', 'a'))).toBe(false)
    })

    it('루트 밖에는 못 만든다', async () => {
      expect(await fs().fsAction('p1', { kind: 'newDir', path: '../secrets/새폴더' })).toEqual({
        ok: false,
        reason: 'not_allowed',
      })
    })
  })

  describe('이름 바꾸기', () => {
    it('같은 폴더 안에서 이름을 바꾼다', async () => {
      expect(
        await fs().fsAction('p1', { kind: 'rename', path: 'README.md', to: '읽어보기.md' }),
      ).toEqual({ ok: true })
      expect(await there(join(projectRoot, 'README.md'))).toBe(false)
      expect(await read(join(projectRoot, '읽어보기.md'))).toBe('#')
    })

    // `rename` 은 목적지가 있으면 **말없이 지운다.** 오타 한 번에 남의 파일이 사라지는 자리다.
    it('있는 이름으로는 못 바꾼다 — 덮어쓰지 않는다', async () => {
      expect(
        await fs().fsAction('p1', { kind: 'rename', path: 'src/index.ts', to: 'README.md' }),
      ).toEqual({ ok: false, reason: 'exists' })
      expect(await read(join(projectRoot, 'README.md'))).toBe('#')
    })

    it('없는 것은 못 옮긴다', async () => {
      expect(await fs().fsAction('p1', { kind: 'rename', path: '없음.md', to: 'a.md' })).toEqual({
        ok: false,
        reason: 'missing',
      })
    })

    it('루트 밖으로는 못 옮긴다', async () => {
      expect(
        await fs().fsAction('p1', { kind: 'rename', path: 'README.md', to: '../secrets/훔침.md' }),
      ).toEqual({ ok: false, reason: 'not_allowed' })
      expect(await there(join(projectRoot, 'README.md'))).toBe(true)
    })
  })

  describe('휴지통', () => {
    // **지우지 않는다.** 되돌릴 수 없는 조작을 앱이 대신 결정하지 않는다.
    it('OS 휴지통으로 보낸다 — unlink 하지 않는다', async () => {
      expect(await fs().fsAction('p1', { kind: 'trash', path: 'README.md' })).toEqual({ ok: true })
      expect(trashItem).toHaveBeenCalledWith(join(projectRoot, 'README.md'))
    })

    it('없는 것은 버릴 수 없다', async () => {
      expect(await fs().fsAction('p1', { kind: 'trash', path: '없음.md' })).toEqual({
        ok: false,
        reason: 'missing',
      })
      expect(trashItem).not.toHaveBeenCalled()
    })

    // 경계 밖은 `resolveInside` 가 걸러 `missing` 이 된다 — 어느 쪽이든 휴지통까지 안 간다
    it('루트 밖은 손대지 않는다', async () => {
      await fs().fsAction('p1', { kind: 'trash', path: '../secrets/password.txt' })
      expect(trashItem).not.toHaveBeenCalled()
      expect(await there(join(outside, 'password.txt'))).toBe(true)
    })
  })

  it('안 열린 프로젝트는 아무것도 못 한다', async () => {
    expect(await fs([]).fsAction('p1', { kind: 'newFile', path: 'a.ts' })).toEqual({
      ok: false,
      reason: 'not_allowed',
    })
  })
})
