// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScmHistory } from './ScmHistory'
import type {
  GitCommitDetailResult,
  GitCommitSummary,
  GitLogResult,
} from '../../shared/git/gitCommit'
import type { ScmViewHandle } from '../state/useScmView'

// 히스토리 갈래가 잠그는 것.
//  1. 커밋을 고르면 그 커밋의 파일 목록과 diff 가 뜬다
//  2. 커밋 0개 저장소는 오류가 아니라 빈 상태다
//  3. diff 가 잘렸으면 **화면에 말한다**
//  4. 있지도 않은 행동 버튼을 그리지 않는다

afterEach(cleanup)

const gitLog = vi.fn<() => Promise<GitLogResult>>()
const gitCommitDetail = vi.fn<() => Promise<GitCommitDetailResult>>()

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@ head',
  '-old',
  '+new',
  '',
].join('\n')

function commit(patch: Partial<GitCommitSummary> = {}): GitCommitSummary {
  return {
    hash: 'abc1234567890',
    shortHash: 'abc1234',
    author: '김태한',
    date: '2026-07-31T14:20:33+09:00',
    refs: [],
    subject: '확장 표준을 정리한다',
    ...patch,
  }
}

function viewHandle(patch: Partial<ScmViewHandle> = {}): ScmViewHandle {
  return {
    view: 'history',
    selectView: vi.fn(),
    file: null,
    selectFile: vi.fn(),
    commit: null,
    selectCommit: vi.fn(),
    ...patch,
  }
}

beforeEach(() => {
  gitLog.mockReset().mockResolvedValue({ ok: true, commits: [commit()], hasMore: false })
  gitCommitDetail.mockReset().mockResolvedValue({
    ok: true,
    detail: {
      commit: commit(),
      files: [{ path: 'src/a.ts', insertions: 1, deletions: 1 }],
      diff: DIFF,
      truncated: false,
    },
  })
  ;(window as unknown as { davis: unknown }).davis = { gitLog, gitCommitDetail }
})

describe('ScmHistory — 목록', () => {
  it('커밋 한 줄에 해시·작성자·시각과 메시지를 보인다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('확장 표준을 정리한다')).toBeTruthy()
    expect(screen.getByText(/abc1234 · 김태한 · 2026-07-31/)).toBeTruthy()
  })

  it('%D 라벨을 원문 그대로 배지로 낸다 — HEAD -> main 을 줄이지 않는다', async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [commit({ refs: ['HEAD -> main', 'origin/main', 'tag: v1.0'] })],
      hasMore: false,
    })
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('HEAD -> main')).toBeTruthy()
    expect(screen.getByText('origin/main')).toBeTruthy()
    expect(screen.getByText('tag: v1.0')).toBeTruthy()
  })

  // 종류만 색으로 가른다 — 네 갈래가 실제로 갈리는지 본다 (로컬 브랜치가 원격 색이면 거짓말이다)
  it('라벨 종류를 색으로 가른다 — 로컬·원격·태그·HEAD', async () => {
    gitLog.mockResolvedValue({
      ok: true,
      commits: [commit({ refs: ['HEAD -> main', 'origin/main', 'tag: v1.0', 'develop'] })],
      hasMore: false,
    })
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect((await screen.findByText('HEAD -> main')).className).toContain('scm-badge--head')
    expect(screen.getByText('origin/main').className).toContain('scm-badge--remote')
    expect(screen.getByText('tag: v1.0').className).toContain('scm-badge--tag')
    expect(screen.getByText('develop').className).toContain('scm-badge--local')
  })

  // 못 읽은 것과 커밋이 없는 것은 다른 사실이다 — 빈 상태 문구로 뭉뚱그리면 안 된다
  it('커밋을 못 읽으면 사유를 빨갛게 낸다', async () => {
    gitLog.mockResolvedValue({ ok: false, commits: [], hasMore: false, message: 'fatal: bad revision' })
    const { container } = render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('fatal: bad revision')).toBeTruthy()
    expect(container.querySelector('.git-empty--error')).toBeTruthy()
    expect(screen.queryByText('아직 커밋이 없습니다.')).toBeNull()
  })

  it('사유가 비어 있어도 못 읽었다는 것은 말한다', async () => {
    gitLog.mockResolvedValue({ ok: false, commits: [], hasMore: false })
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('커밋을 읽지 못했습니다')).toBeTruthy()
  })

  // 🔴 갓 만든 저장소가 빨간 오류로 맞이하면 안 된다
  it('커밋이 하나도 없으면 오류가 아니라 빈 상태다', async () => {
    gitLog.mockResolvedValue({ ok: true, commits: [], hasMore: false })
    const { container } = render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('아직 커밋이 없습니다.')).toBeTruthy()
    expect(container.querySelector('.git-empty--error')).toBeNull()
  })

  it('다음 쪽이 있을 때만 더 보기를 그린다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle()} />)
    await screen.findByText('확장 표준을 정리한다')
    expect(screen.queryByText('더 보기')).toBeNull()

    cleanup()
    gitLog.mockResolvedValue({ ok: true, commits: [commit()], hasMore: true })
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('더 보기')).toBeTruthy()
  })

  it('커밋을 누르면 그 해시를 알린다', async () => {
    const view = viewHandle()
    render(<ScmHistory projectId="p1" view={view} />)

    fireEvent.click(await screen.findByText('확장 표준을 정리한다'))

    expect(view.selectCommit).toHaveBeenCalledWith('abc1234567890')
  })
})

describe('ScmHistory — 고른 커밋', () => {
  it('아무것도 안 골랐으면 안내만 한다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle()} />)

    expect(await screen.findByText('왼쪽에서 커밋을 고르면 내용이 보입니다.')).toBeTruthy()
    expect(gitCommitDetail).not.toHaveBeenCalled()
  })

  it('고르면 파일 목록과 diff 가 뜬다 — 덩어리 머리에 파일 이름이 붙는다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle({ commit: 'abc1234567890' })} />)

    await waitFor(() =>
      expect(gitCommitDetail).toHaveBeenCalledWith({ projectId: 'p1', ref: 'abc1234567890' }),
    )
    // 경로는 폴더/파일 두 조각으로 그려진다 (GitFileRow 와 같은 규칙) — title 로 짚는다
    expect(await screen.findByTitle('src/a.ts')).toBeTruthy()
    expect(screen.getByText(/src\/a\.ts @@ -1,2 \+1,2 @@ head/)).toBeTruthy()
    expect(screen.getByText('new')).toBeTruthy()
  })

  // 🔴 조용히 자르면 "이 커밋은 여기까지 바꿨다" 로 잘못 읽힌다
  it('diff 가 잘렸으면 화면에 말한다', async () => {
    gitCommitDetail.mockResolvedValue({
      ok: true,
      detail: { commit: commit(), files: [], diff: DIFF, truncated: true },
    })
    render(<ScmHistory projectId="p1" view={viewHandle({ commit: 'abc1234567890' })} />)

    expect(await screen.findByText(/100KB 에서 잘렸습니다/)).toBeTruthy()
  })

  it('잘리지 않았으면 그 문구를 그리지 않는다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle({ commit: 'abc1234567890' })} />)
    await screen.findByTitle('src/a.ts')

    expect(screen.queryByText(/잘렸습니다/)).toBeNull()
  })

  // 채널이 없는 행동은 그리지 않는다 (되돌리기·이 시점 파일 열기·여기서 브랜치 만들기)
  it('상세에 없는 기능의 버튼을 만들지 않는다', async () => {
    render(<ScmHistory projectId="p1" view={viewHandle({ commit: 'abc1234567890' })} />)
    await screen.findByTitle('src/a.ts')

    expect(screen.queryByText(/이 커밋 되돌리기|여기서 브랜치 만들기|이 시점 파일 열기/)).toBeNull()
  })

  it('바이너리 파일은 +0 −0 대신 바이너리라고 적는다', async () => {
    gitCommitDetail.mockResolvedValue({
      ok: true,
      detail: {
        commit: commit(),
        files: [{ path: 'logo.png' }],
        diff: '',
        truncated: false,
      },
    })
    render(<ScmHistory projectId="p1" view={viewHandle({ commit: 'abc1234567890' })} />)

    expect(await screen.findByText('바이너리')).toBeTruthy()
  })
})
