import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_BYTES, ProjectFs } from './projectFs'

// openInOs 가 부르는 shell 만 바꿔 끼운다. 팩토리 안에서 지연 호출하므로
// 호이스팅돼도 아래 vi.fn 정의를 안전하게 잡는다.
const showItemInFolder = vi.fn()
const openPath = vi.fn(async (_path: string) => '')
vi.mock('electron', () => ({
  shell: {
    showItemInFolder: (path: string) => showItemInFolder(path),
    openPath: (path: string) => openPath(path),
  },
}))

// fs 경계. 여기가 뚫리면 트리를 통해 프로젝트 밖 파일이 읽힌다.
// renderer 가 경로를 만들어 보내므로 이 판정을 믿을 수 있어야 한다.

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
})

function fs(open: { id: string; root: string }[] = [{ id: 'p1', root: projectRoot }]): ProjectFs {
  return new ProjectFs({ openProjects: open })
}

describe('읽기', () => {
  it('루트를 읽으면 디렉토리가 먼저 온다', async () => {
    const result = await fs().readDir('p1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries.map((entry) => entry.name)).toEqual(['src', 'README.md'])
      expect(result.entries[0]!.isDirectory).toBe(true)
    }
  })

  it('상대경로를 루트 기준으로 돌려준다 — 대화에 그대로 쓸 수 있게', async () => {
    const result = await fs().readDir('p1', 'src')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0]!.path).toBe('src/index.ts')
  })

  it('한 겹만 읽는다 — 큰 저장소에서 전체를 훑으면 멈춘다', async () => {
    const result = await fs().readDir('p1')

    expect(result.ok).toBe(true)
    // src 안의 index.ts 는 펼치기 전까지 나오지 않는다
    if (result.ok) expect(result.entries.map((entry) => entry.name)).not.toContain('index.ts')
  })

  it('없는 디렉토리는 거부한다', async () => {
    expect(await fs().readDir('p1', '없음')).toEqual({ ok: false, reason: 'not_allowed' })
  })
})

describe('파일 읽기', () => {
  it('텍스트 파일을 읽는다', async () => {
    // mtime 도 함께 온다 — 저장할 때 그 사이 바뀌었는지 판단하는 근거다
    expect(await fs().readFile('p1', 'README.md')).toMatchObject({ ok: true, text: '#' })
  })

  it('디렉토리는 파일로 읽지 않는다', async () => {
    expect(await fs().readFile('p1', 'src')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('루트 밖은 읽기도 거부한다 — 목록과 같은 경계다', async () => {
    expect(await fs().readFile('p1', '../secrets/password.txt')).toEqual({
      ok: false,
      reason: 'not_allowed',
    })
  })

  // 내용을 통째로 화면 상태에 올리므로 큰 파일은 앱을 멈춘다
  it('너무 큰 파일은 거부한다', async () => {
    await writeFile(join(projectRoot, 'huge.txt'), 'x'.repeat(MAX_FILE_BYTES + 1), 'utf8')
    expect(await fs().readFile('p1', 'huge.txt')).toEqual({ ok: false, reason: 'too_large' })
  })

  // 깨진 글자를 쏟아내는 것보다 못 연다고 말하는 편이 낫다
  it('바이너리는 거부한다', async () => {
    await writeFile(join(projectRoot, 'blob.bin'), Buffer.from([0x41, 0x00, 0x42]))
    expect(await fs().readFile('p1', 'blob.bin')).toEqual({ ok: false, reason: 'binary' })
  })

  it('없는 파일은 거부한다', async () => {
    expect(await fs().readFile('p1', '없음.txt')).toEqual({ ok: false, reason: 'not_allowed' })
  })
})

describe('감추는 항목', () => {
  it('.git 은 보이지 않는다 — hooks 샘플이 트리를 다 차지한다', async () => {
    await mkdir(join(projectRoot, '.git', 'hooks'), { recursive: true })

    const result = await fs().readDir('p1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries.map((entry) => entry.name)).not.toContain('.git')
  })

  it('node_modules 도 보이지 않는다', async () => {
    await mkdir(join(projectRoot, 'node_modules'), { recursive: true })

    const result = await fs().readDir('p1')
    if (result.ok) expect(result.entries.map((entry) => entry.name)).not.toContain('node_modules')
  })

  // 점으로 시작한다고 전부 감추면 사람이 직접 보는 설정까지 사라진다
  it('.claude 같은 설정 폴더는 남긴다', async () => {
    await mkdir(join(projectRoot, '.claude'), { recursive: true })

    const result = await fs().readDir('p1')
    if (result.ok) expect(result.entries.map((entry) => entry.name)).toContain('.claude')
  })
})

describe('OS 로 열기', () => {
  beforeEach(() => {
    showItemInFolder.mockClear()
    openPath.mockClear()
  })

  it('external 은 기본 앱으로 연다 (shell.openPath)', async () => {
    expect(await fs().openInOs('p1', 'README.md', 'external')).toEqual({ ok: true })
    expect(openPath).toHaveBeenCalledWith(join(projectRoot, 'README.md'))
  })

  it('reveal 은 Finder 에서 위치만 보여준다', async () => {
    expect(await fs().openInOs('p1', 'README.md', 'reveal')).toEqual({ ok: true })
    expect(showItemInFolder).toHaveBeenCalledWith(join(projectRoot, 'README.md'))
    expect(openPath).not.toHaveBeenCalled()
  })

  // shell.openPath 는 실패를 예외가 아니라 에러 메시지 문자열로 준다
  it('openPath 가 에러 메시지를 주면 실패로 돌려준다', async () => {
    openPath.mockResolvedValueOnce('연결된 앱이 없습니다')
    expect(await fs().openInOs('p1', 'README.md', 'external')).toEqual({
      ok: false,
      reason: '연결된 앱이 없습니다',
    })
  })

  it('루트 밖은 열지 않는다 — 읽기와 같은 경계다', async () => {
    expect(await fs().openInOs('p1', '../secrets/password.txt', 'external')).toEqual({
      ok: false,
      reason: 'not_allowed',
    })
    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('경계', () => {
  it('열려 있지 않은 프로젝트는 읽지 않는다', async () => {
    expect(await fs([]).readDir('p1')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('.. 로 밖을 가리키면 거부한다', async () => {
    expect(await fs().readDir('p1', '../secrets')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('겹겹의 .. 도 거부한다', async () => {
    expect(await fs().readDir('p1', 'src/../../secrets')).toEqual({
      ok: false,
      reason: 'not_allowed',
    })
  })

  // 문자열 비교만으로는 못 잡는다 — 경로상으로는 루트 안쪽으로 보인다
  it('루트 안의 심링크가 밖을 가리키면 거부한다', async () => {
    await symlink(outside, join(projectRoot, 'escape'))

    expect(await fs().readDir('p1', 'escape')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  // 접두사만 보면 /a/bc 가 /a/b 안으로 잡힌다
  it('이름이 루트로 시작하는 형제 디렉토리를 안쪽으로 보지 않는다', async () => {
    const sibling = `${projectRoot}-other`
    await mkdir(sibling, { recursive: true })

    expect(await fs().readDir('p1', `../${'project-other'}`)).toEqual({
      ok: false,
      reason: 'not_allowed',
    })
  })

  it('절대경로를 넘겨도 루트 밖이면 거부한다', async () => {
    expect(await fs().readDir('p1', outside)).toEqual({ ok: false, reason: 'not_allowed' })
  })
})
