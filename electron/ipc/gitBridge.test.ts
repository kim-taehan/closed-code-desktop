import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { EMPTY_GIT_STATE, type GitState } from '../../shared/git/gitState'
import type {
  GitActionResult,
  GitDiffResultPayload,
  GitStatePayload,
} from '../../shared/ipc/gitPayloads'
import type { GitLogResult } from '../../shared/git/gitCommit'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import { runGit } from '../git/gitRunner'

// 소스 관리 핸들러가 **무엇을 하는지** 본다.
//
// `wiring.test.ts` 는 채널이 등록·해제되는지(배선의 존재)만 보고 등록된 함수의 알맹이는
// 통과로 셈한다. 여기서는 등록된 핸들러를 붙잡아 **진짜 저장소**에 대고 부른다 — 열려 있지
// 않은 프로젝트에 무엇을 답하는지, 행동 뒤에 무엇을 밀어주는지가 화면이 그리는 것을 정한다.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const sent: { channel: string; payload: unknown }[] = []
let destroyed = false

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
  BrowserWindow: class {
    isDestroyed() {
      return destroyed
    }
    webContents = {
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    }
  },
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

describe('소스 관리 IPC 핸들러', () => {
  let dir = ''
  let root = ''

  beforeEach(async () => {
    handlers.clear()
    sent.length = 0
    destroyed = false
    dir = await mkdtemp(join(tmpdir(), 'davis-gitbridge-'))
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-gitrepo-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
    await writeFile(join(root, 'a.txt'), 'one\n')
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '첫 커밋'], root)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
    vi.resetModules()
  })

  /** 브리지를 실제로 등록한다. 레지스트리도 진짜다 — rootOf 가 여는 그 목록을 본다. */
  async function setup(): Promise<{ projectId: string; close: () => Promise<void> }> {
    const { GitBridge } = await import('./gitBridge')
    const { ProjectRegistry } = await import('../projects/projectRegistry')
    const { ProjectStore } = await import('../projects/projectStore')
    const { BrowserWindow } = await import('electron')

    const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
    const opened = await registry.open(root)
    if (!opened.ok) throw new Error(opened.message)

    new GitBridge(new BrowserWindow() as never, registry).register()
    return { projectId: opened.project.id, close: () => registry.close(opened.project.id) }
  }

  async function call<T>(channel: string, payload: unknown): Promise<T> {
    const handler = handlers.get(channel)
    if (handler === undefined) throw new Error(`${channel} 핸들러가 등록되지 않았습니다`)
    return (await handler({}, payload)) as T
  }

  function pushes(): { projectId: string; payload: GitStatePayload }[] {
    return sent
      .filter((entry) => entry.channel === Channel.GIT_STATE_PUSH)
      .map((entry) => entry.payload as { projectId: string; payload: GitStatePayload })
  }

  function lastState(): GitState {
    const last = pushes().slice(-1)[0]
    if (last === undefined) throw new Error('밀려온 상태가 없습니다')
    return last.payload.state
  }

  it('열린 프로젝트를 물으면 그 저장소의 실제 상태가 온다', async () => {
    const { projectId } = await setup()
    await writeFile(join(root, 'a.txt'), 'changed\n')

    const { state } = await call<GitStatePayload>(Channel.GIT_STATE, { projectId })

    expect(state.isRepo).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.unstaged.map((file) => file.path)).toEqual(['a.txt'])
  })

  // 🔴 여기서 예외를 던지면 화면이 무엇을 그릴지 알 수 없다 (`gitBridge.read` 주석).
  // 모르는 프로젝트와 **닫은** 프로젝트를 같이 잠근다 — 닫는 순간 목록에서 빠지므로
  // 탭을 닫은 직후 늦게 도착한 조회가 정확히 이 경로로 온다.
  it('모르는·닫은 프로젝트의 상태 조회는 던지지 않고 빈 상태로 온다', async () => {
    const { projectId, close } = await setup()

    const unknown = await call<GitStatePayload>(Channel.GIT_STATE, { projectId: '없는-id' })
    expect(unknown.state).toEqual(EMPTY_GIT_STATE)

    await close()
    const closed = await call<GitStatePayload>(Channel.GIT_STATE, { projectId })
    expect(closed.state).toEqual(EMPTY_GIT_STATE)
    expect(closed.state.isRepo).toBe(false)
  })

  // 같은 파일이라도 어느 묶음에서 눌렀느냐로 **다른 것을 묻는다** (설계 §4).
  it('diff 는 담긴 것과 안 담은 것을 갈라 답한다', async () => {
    const { projectId } = await setup()
    await writeFile(join(root, 'a.txt'), 'one\ntwo\n')
    await runGit(['add', 'a.txt'], root)
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')

    const staged = await call<GitDiffResultPayload>(Channel.GIT_FILE_DIFF, {
      projectId,
      path: 'a.txt',
      staged: true,
    })
    expect(staged.ok).toBe(true)
    expect(staged.diff).toContain('+two')
    expect(staged.diff).not.toContain('+three')

    const unstaged = await call<GitDiffResultPayload>(Channel.GIT_FILE_DIFF, {
      projectId,
      path: 'a.txt',
      staged: false,
    })
    expect(unstaged.diff).toContain('+three')
    expect(unstaged.diff).not.toContain('+two')
  })

  // 행동 뒤에 새 상태를 **프로젝트 겉봉에 담아** 민다 — 탭마다 저장소가 다르므로
  // 겉봉이 없으면 화면이 남의 저장소 상태를 자기 것으로 그린다.
  it('담기는 인덱스를 실제로 바꾸고, 새 상태를 프로젝트 겉봉에 담아 민다', async () => {
    const { projectId } = await setup()
    await writeFile(join(root, 'a.txt'), 'changed\n')

    const result = await call<GitActionResult>(Channel.GIT_STAGE, { projectId, path: 'a.txt' })

    expect(result.ok).toBe(true)
    expect(sent.map((entry) => entry.channel)).toEqual([Channel.GIT_STATE_PUSH])
    const scoped = pushes()[0]!
    expect(scoped.projectId).toBe(projectId)
    expect(scoped.payload.state.staged.map((file) => file.path)).toEqual(['a.txt'])
    expect(scoped.payload.state.unstaged).toEqual([])
  })

  // 실패해도 민다 — 아무것도 안 바뀌었어도 화면을 사실과 맞춰 둔다.
  it('행동이 실패해도 상태를 민다', async () => {
    const { projectId } = await setup()

    const result = await call<GitActionResult>(Channel.GIT_REVERT, {
      projectId,
      path: '없는파일.txt',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
    expect(pushes()).toHaveLength(1)
  })

  // 조회는 사유를 달아 거절한다 (빈 화면을 주면 "변경이 없다"로 오해된다). 행동은
  // 거절하면서 **밀지도 않는다** — 빈 상태를 밀면 화면이 "저장소가 아니다"로 다시
  // 그려져, 닫은 것과 무관한 저장소가 사라진 것처럼 보인다.
  it('닫힌 프로젝트는 조회도 행동도 사유를 달아 거절하고, 아무것도 밀지 않는다', async () => {
    await setup()

    const diff = await call<GitDiffResultPayload>(Channel.GIT_FILE_DIFF, {
      projectId: '없는-id',
      path: 'a.txt',
      staged: false,
    })
    expect(diff).toEqual({ ok: false, diff: '', reason: '열려 있지 않은 프로젝트입니다' })

    const staged = await call<GitActionResult>(Channel.GIT_STAGE, {
      projectId: '없는-id',
      path: 'a.txt',
    })
    const committed = await call<GitActionResult>(Channel.GIT_COMMIT, {
      projectId: '없는-id',
      message: '메시지',
    })

    expect(staged).toEqual({ ok: false, message: '열려 있지 않은 프로젝트입니다' })
    expect(committed).toEqual({ ok: false, message: '열려 있지 않은 프로젝트입니다' })
    expect(sent).toEqual([])
  })

  it('커밋은 담긴 것만 담고, 밀려온 상태가 남은 것을 보여 준다', async () => {
    const { projectId } = await setup()
    await writeFile(join(root, 'a.txt'), 'changed\n')
    await writeFile(join(root, 'b.txt'), '아직 안 담음\n')
    await runGit(['add', 'a.txt'], root)

    const result = await call<GitActionResult>(Channel.GIT_COMMIT, { projectId, message: '둘째' })

    expect(result.ok).toBe(true)
    expect(lastState().staged).toEqual([])
    expect(lastState().unstaged.map((file) => file.path)).toEqual(['b.txt'])
  })

  // ⟳ 는 `refreshWithFetch` 가 읽은 상태를 **그대로** 민다. 여기서 다시 읽으면
  // 두 시점이 섞이고 `fetchFailed` 를 잃는다 — 화살표가 최신인 척한다.
  it('⟳ 는 값을 돌려주지 않고, 원격 확인 실패까지 실은 상태를 민다', async () => {
    const { projectId } = await setup()
    await runGit(['remote', 'add', 'origin', '/그런/경로/없음.git'], root)

    const value = await call<undefined>(Channel.GIT_REFRESH, { projectId })

    expect(value).toBeUndefined()
    expect(lastState().fetchFailed).toBe(true)
    expect(lastState().branch).toBe('main')

    // 닫힌 프로젝트의 ⟳ 는 조용히 아무것도 하지 않는다 — 밀린 것이 안 늘어난다
    await call<undefined>(Channel.GIT_REFRESH, { projectId: '없는-id' })
    expect(pushes()).toHaveLength(1)
  })

  it('창이 닫혔으면 상태를 보내지 않는다 — 행동 결과는 그대로 준다', async () => {
    const { projectId } = await setup()
    await writeFile(join(root, 'a.txt'), 'changed\n')
    destroyed = true

    const result = await call<GitActionResult>(Channel.GIT_STAGE, { projectId, path: 'a.txt' })

    expect(result.ok).toBe(true)
    expect(sent).toEqual([])
  })

  // 히스토리 묶음은 `gitHistoryHandlers` 가 등록하지만 **브리지가 넘긴 두 함수**
  // (rootOf·afterAction)로 돈다. 그 배선이 같은 저장소를 보는지는 여기서만 드러난다.
  it('히스토리·브랜치 배선도 같은 저장소를 본다', async () => {
    const { projectId } = await setup()
    await runGit(['branch', 'feature'], root)

    const log = await call<GitLogResult>(Channel.GIT_LOG, { projectId })
    expect(log.ok).toBe(true)
    expect(log.commits.map((entry) => entry.subject)).toEqual(['첫 커밋'])

    const switched = await call<GitActionResult>(Channel.GIT_SWITCH_BRANCH, {
      projectId,
      name: 'feature',
    })
    expect(switched.ok).toBe(true)
    expect(lastState().branch).toBe('feature')
  })

  // 화면이 그린 덩어리 원문을 **손대지 않고** 넘긴다. 배선에서 trim·재조립하면
  // main 의 원문 대조(`gitHunk.assemble`)가 어긋나 전부 거절된다 — 그때 화면은
  // "그 사이 파일이 바뀌었다"만 받고 아무것도 담기지 않는다.
  it('덩어리 담기는 원문을 그대로 넘겨 그 덩어리만 담는다', async () => {
    const { projectId } = await setup()
    // 앞뒤가 멀어 덩어리가 둘로 갈리는 파일
    const base = ['머리', ...Array.from({ length: 20 }, (_, index) => `줄${index}`), '꼬리']
    await writeFile(join(root, 'a.txt'), base.join('\n') + '\n')
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '바탕'], root)

    const lines = [...base]
    lines[1] = '앞을 고침'
    lines[20] = '뒤를 고침'
    await writeFile(join(root, 'a.txt'), lines.join('\n') + '\n')

    const diff = await runGit(['diff', '--no-color', '--', 'a.txt'], root)
    const hunks = splitHunks(diff.stdout).hunks
    expect(hunks).toHaveLength(2)

    const result = await call<GitActionResult>(Channel.GIT_STAGE_HUNK, {
      projectId,
      path: 'a.txt',
      hunkIndex: 0,
      hunkText: joinHunk(hunks[0]!),
    })

    expect(result.ok).toBe(true)
    const staged = await runGit(['diff', '--staged', '--no-color'], root)
    expect(staged.stdout).toContain('+앞을 고침')
    expect(staged.stdout).not.toContain('+뒤를 고침')
  })
})
