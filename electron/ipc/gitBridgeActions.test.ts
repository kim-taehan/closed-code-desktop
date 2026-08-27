import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'
import type { GitLogResult } from '../../shared/git/gitCommit'
import { splitHunks, joinHunk } from '../../shared/git/hunkSplit'
import { runGit } from '../git/gitRunner'
import {
  call,
  lastState,
  makeRepo,
  pushes,
  removeRepo,
  resetHarness,
  sent,
  setup,
} from './gitBridgeTestHarness'

vi.mock('electron', async () => (await import('./gitBridgeTestHarness')).electronMock())

// 소스 관리 **행동**이 저장소를 실제로 바꾸고, 그 뒤에 무엇을 미는지 본다.
//
// 조회 쪽(무엇을 답하나·언제 거절하나)은 `gitBridge.test.ts` 에 있고 판은 함께 쓴다
// (`gitBridgeTestHarness.ts`). 여기 있는 것들의 공통점은 **저장소를 건드린 뒤 화면을
// 사실과 맞추는 두 걸음**이라, 뒤 걸음이 빠지면 결과는 맞는데 화면만 옛것으로 남는다.

describe('소스 관리 IPC — 행동과 밀기', () => {
  let dir = ''
  let root = ''

  beforeEach(async () => {
    resetHarness()
    ;({ dir, root } = await makeRepo())
  })

  afterEach(async () => {
    await removeRepo(dir, root)
    vi.resetModules()
  })

  // 행동 뒤에 새 상태를 **프로젝트 겉봉에 담아** 민다 — 탭마다 저장소가 다르므로
  // 겉봉이 없으면 화면이 남의 저장소 상태를 자기 것으로 그린다.
  it('담기는 인덱스를 실제로 바꾸고, 새 상태를 프로젝트 겉봉에 담아 민다', async () => {
    const { projectId } = await setup(dir, root)
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
    const { projectId } = await setup(dir, root)

    const result = await call<GitActionResult>(Channel.GIT_REVERT, {
      projectId,
      path: '없는파일.txt',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
    expect(pushes()).toHaveLength(1)
  })

  it('커밋은 담긴 것만 담고, 밀려온 상태가 남은 것을 보여 준다', async () => {
    const { projectId } = await setup(dir, root)
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
    const { projectId } = await setup(dir, root)
    await runGit(['remote', 'add', 'origin', '/그런/경로/없음.git'], root)

    const value = await call<undefined>(Channel.GIT_REFRESH, { projectId })

    expect(value).toBeUndefined()
    expect(lastState().fetchFailed).toBe(true)
    expect(lastState().branch).toBe('main')

    // 닫힌 프로젝트의 ⟳ 는 조용히 아무것도 하지 않는다 — 밀린 것이 안 늘어난다
    await call<undefined>(Channel.GIT_REFRESH, { projectId: '없는-id' })
    expect(pushes()).toHaveLength(1)
  })

  // 히스토리 묶음은 `gitHistoryHandlers` 가 등록하지만 **브리지가 넘긴 두 함수**
  // (rootOf·afterAction)로 돈다. 그 배선이 같은 저장소를 보는지는 여기서만 드러난다.
  it('히스토리·브랜치 배선도 같은 저장소를 본다', async () => {
    const { projectId } = await setup(dir, root)
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
    const { projectId } = await setup(dir, root)
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
