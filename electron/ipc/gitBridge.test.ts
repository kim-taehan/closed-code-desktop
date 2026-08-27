import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { EMPTY_GIT_STATE } from '../../shared/git/gitState'
import type { GitActionResult, GitDiffResultPayload, GitStatePayload } from '../../shared/ipc/gitPayloads'
import { runGit } from '../git/gitRunner'
import {
  call,
  makeRepo,
  removeRepo,
  resetHarness,
  sent,
  setup,
  windowState,
} from './gitBridgeTestHarness'

vi.mock('electron', async () => (await import('./gitBridgeTestHarness')).electronMock())

// 소스 관리 핸들러가 **무엇을 답하는지** 본다 — 그리고 언제 입을 다무는지.
//
// `wiring.test.ts` 는 채널이 등록·해제되는지(배선의 존재)만 보고 등록된 함수의 알맹이는
// 통과로 셈한다. 여기서는 등록된 핸들러를 붙잡아 **진짜 저장소**에 대고 부른다 — 열려 있지
// 않은 프로젝트에 무엇을 답하는지가 화면이 그리는 것을 정한다.
//
// **행동(담기·커밋·덩어리·⟳)이 저장소를 실제로 바꾸는지는 `gitBridgeActions.test.ts`** 다.
// 판(가짜 electron·진짜 저장소)은 `gitBridgeTestHarness.ts` 로 같이 쓴다.

describe('소스 관리 IPC — 조회와 그 경계', () => {
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

  it('열린 프로젝트를 물으면 그 저장소의 실제 상태가 온다', async () => {
    const { projectId } = await setup(dir, root)
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
    const { projectId, close } = await setup(dir, root)

    const unknown = await call<GitStatePayload>(Channel.GIT_STATE, { projectId: '없는-id' })
    expect(unknown.state).toEqual(EMPTY_GIT_STATE)

    await close()
    const closed = await call<GitStatePayload>(Channel.GIT_STATE, { projectId })
    expect(closed.state).toEqual(EMPTY_GIT_STATE)
    expect(closed.state.isRepo).toBe(false)
  })

  // 같은 파일이라도 어느 묶음에서 눌렀느냐로 **다른 것을 묻는다** (설계 §4).
  it('diff 는 담긴 것과 안 담은 것을 갈라 답한다', async () => {
    const { projectId } = await setup(dir, root)
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

  // 조회는 사유를 달아 거절한다 (빈 화면을 주면 "변경이 없다"로 오해된다). 행동은
  // 거절하면서 **밀지도 않는다** — 빈 상태를 밀면 화면이 "저장소가 아니다"로 다시
  // 그려져, 닫은 것과 무관한 저장소가 사라진 것처럼 보인다.
  it('닫힌 프로젝트는 조회도 행동도 사유를 달아 거절하고, 아무것도 밀지 않는다', async () => {
    await setup(dir, root)

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

  it('창이 닫혔으면 상태를 보내지 않는다 — 행동 결과는 그대로 준다', async () => {
    const { projectId } = await setup(dir, root)
    await writeFile(join(root, 'a.txt'), 'changed\n')
    windowState.destroyed = true

    const result = await call<GitActionResult>(Channel.GIT_STAGE, { projectId, path: 'a.txt' })

    expect(result.ok).toBe(true)
    expect(sent).toEqual([])
  })
})
