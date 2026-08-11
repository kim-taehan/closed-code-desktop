import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit } from './gitRunner'
import { readGitState } from './gitStatus'
import {
  createBranch,
  deleteBranch,
  forceDeleteBranch,
  mergeBranch,
  parseBranchRefs,
  readBranches,
  switchBranch,
  trackRemoteBranch,
} from './gitBranch'

// 진짜 저장소를 바꾼다 (`gitActions.test.ts` 와 같은 결). 브랜치는 흉내로는
// 못 잡는 자리가 많다 — 전환 실패 조건·병합이 에디터를 띄우는지가 그렇다.
//
// ⚠ **원격을 만드는 케이스에는 타임아웃을 따로 준다** (`REMOTE_TIMEOUT`). bare 저장소를
//   더 만들고 push/clone 까지 도는 케이스는 git 하위 프로세스를 10개 안팎 띄우는데,
//   `vitest.config.ts` 에 `testTimeout` 이 없어 기본 5000ms 다 — 전수 실행처럼 워커에
//   부하가 걸리면 넘어가 산발 실패한다 (QA F2 실측). 잡던 것은 그대로 두고 시간만 준다.
const REMOTE_TIMEOUT = 30_000

describe('브랜치', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-branch-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function commit(file: string, body: string, message: string): Promise<void> {
    await writeFile(join(root, file), body)
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', message], root)
  }

  it('목록에 현재 브랜치 표시와 시각이 온다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')
    await createBranch(root, 'feat/x')

    const result = await readBranches(root)

    expect(result.ok).toBe(true)
    const names = result.branches.map((entry) => entry.name)
    expect(names).toContain('main')
    expect(names).toContain('feat/x')

    const current = result.branches.find((entry) => entry.current)
    expect(current?.name).toBe('feat/x')
    // 로컬 이름에 `/` 가 있어도 원격이 아니다
    expect(current?.remote).toBe(false)
    expect(current?.date).not.toBe('')
  })

  it('원격 브랜치는 remote 로 표시되고 추적 문구가 실린다', async () => {
    const remote = await realpath(await mkdtemp(join(tmpdir(), 'davis-bare-')))
    try {
      await runGit(['init', '--bare'], remote)
      await commit('a.txt', 'x\n', '첫 커밋')
      await runGit(['remote', 'add', 'origin', remote], root)
      await runGit(['push', '-u', 'origin', 'main'], root)
      await commit('b.txt', 'y\n', '둘째 커밋')

      const result = await readBranches(root)
      const local = result.branches.find((entry) => entry.name === 'main')
      const tracked = result.branches.find((entry) => entry.name === 'origin/main')

      expect(local?.remote).toBe(false)
      // git 이 낸 문구 그대로 — 숫자로 풀지 않는다 ([gone] 같은 상태를 흘리지 않으려고)
      expect(local?.track).toBe('[ahead 1]')
      expect(tracked?.remote).toBe(true)
      expect(tracked?.current).toBe(false)
      // origin/HEAD 는 브랜치가 아니라 심볼릭 참조라 목록에 없어야 한다
      expect(result.branches.map((entry) => entry.name)).not.toContain('origin/HEAD')
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  }, REMOTE_TIMEOUT)

  it('만들고 전환하면 상태의 브랜치가 바뀐다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')

    expect((await createBranch(root, 'feat')).ok).toBe(true)
    expect((await readGitState(root)).branch).toBe('feat')

    expect((await switchBranch(root, 'main')).ok).toBe(true)
    expect((await readGitState(root)).branch).toBe('main')
  })

  it('같은 이름으로 또 만들면 ok:false 에 git 메시지가 실린다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')
    await createBranch(root, 'feat')
    await switchBranch(root, 'main')

    const result = await createBranch(root, 'feat')
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  // ⚠ 작업 중 변경이 **전환할 브랜치와 겹칠 때만** 실패한다 (겹치지 않으면 git 이
  // 수정을 데려간다). 그래서 같은 파일을 양쪽에서 다르게 만든 뒤 시험한다.
  it('겹치는 작업 중 변경이 있으면 전환이 git 원문 그대로 실패한다', async () => {
    await commit('a.txt', 'main\n', '첫 커밋')
    await createBranch(root, 'feat')
    await commit('a.txt', 'feat\n', '갈라진 커밋')
    await switchBranch(root, 'main')
    await writeFile(join(root, 'a.txt'), 'dirty\n')

    const result = await switchBranch(root, 'feat')

    expect(result.ok).toBe(false)
    // git 이 낸 문장을 고쳐 쓰지 않는다 — 사용자가 검색해 찾을 수 있어야 한다
    expect(result.message).toContain('would be overwritten')
    expect(result.message).toContain('a.txt')
    // 전환은 일어나지 않았고 작업 내용도 그대로다
    expect((await readGitState(root)).branch).toBe('main')
  })

  // 🔴 `--no-edit` 이 빠지면 편집기가 떠서 60초 타임아웃을 다 채운다.
  // 이 케이스가 몇 초 안에 끝나는 것 자체가 회귀 감시다.
  it('병합이 편집기 없이 끝나고 병합 커밋이 생긴다', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await createBranch(root, 'feat')
    await commit('f.txt', 'feat\n', 'feat 커밋')
    await switchBranch(root, 'main')
    await commit('m.txt', 'main\n', 'main 커밋')

    const started = Date.now()
    const result = await mergeBranch(root, 'feat')

    expect(result.ok).toBe(true)
    // 편집기에 매달렸다면 60초를 넘겼을 값이다 (완화 방향 회귀를 여기서 막는다)
    expect(Date.now() - started).toBeLessThan(20_000)
    const log = await runGit(['log', '--pretty=%s'], root)
    expect(log.stdout).toContain("Merge branch 'feat'")
  })

  // ⚠ `git merge` 는 충돌 설명을 **stdout 으로만** 낸다 (stderr 0바이트, exit 1, 실측).
  // stderr 만 보면 이 문장이 통째로 `git 명령이 실패했습니다` 로 뒤바뀐다.
  // `toBeTruthy()` 로는 못 잡는다 — 그 대체 문구도 truthy 다. 그래서 원문을 짚는다.
  it('병합 충돌 메시지가 git 원문 그대로 온다 (stdout 으로 오는 자리)', async () => {
    await commit('a.txt', 'base\n', '첫 커밋')
    await createBranch(root, 'feat')
    await commit('a.txt', 'feat\n', 'feat 쪽 수정')
    await switchBranch(root, 'main')
    await commit('a.txt', 'main\n', 'main 쪽 수정')

    const result = await mergeBranch(root, 'feat')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('CONFLICT')
    expect(result.message).toContain('a.txt')
    expect(result.message).not.toBe('git 명령이 실패했습니다')
    expect((await readGitState(root)).unstaged).toContainEqual(
      expect.objectContaining({ path: 'a.txt', status: 'conflicted' }),
    )
  })

  // 안전한 쪽(-d)은 병합 안 된 브랜치를 거절한다. 강제(-D)는 지운다.
  // 둘이 함수 이름으로 갈려 있어야 호출부에서 플래그 하나 차이로 잘못 부를 수 없다.
  it('안전한 삭제는 병합 안 된 브랜치를 거절하고 강제 삭제는 지운다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')
    await createBranch(root, 'tmp')
    await commit('z.txt', 'z\n', '아직 병합 안 된 커밋')
    await switchBranch(root, 'main')

    const safe = await deleteBranch(root, 'tmp')
    expect(safe.ok).toBe(false)
    expect(safe.message).toBeTruthy()
    expect((await readBranches(root)).branches.map((entry) => entry.name)).toContain('tmp')

    expect((await forceDeleteBranch(root, 'tmp')).ok).toBe(true)
    expect((await readBranches(root)).branches.map((entry) => entry.name)).not.toContain('tmp')
  })

  // ⚠ `%(refname:short)` 는 `refs/remotes/origin/HEAD` 를 **`origin`** 으로 줄인다.
  // 짧은 이름으로 `/HEAD` 를 걸러 봐야 안 걸려서 clone 한 저장소마다 `origin` 이라는
  // 가짜 행이 뜬다. clone 을 실제로 떠야만 나오는 자리라 여기서 만든다.
  it('clone 한 저장소의 목록에 origin 가짜 행이 없다', async () => {
    const origin = await realpath(await mkdtemp(join(tmpdir(), 'davis-origin-')))
    const cloned = await realpath(await mkdtemp(join(tmpdir(), 'davis-clone-')))
    const work = join(cloned, 'work')
    try {
      await commit('a.txt', 'x\n', '첫 커밋')
      await runGit(['init', '--bare'], origin)
      await runGit(['remote', 'add', 'origin', origin], root)
      await runGit(['push', '-u', 'origin', 'main'], root)
      // bare 저장소의 HEAD 는 `init --bare` 가 정한 기본값(환경에 따라 master)이라
      // 그대로 clone 하면 체크아웃할 브랜치를 못 찾아 **로컬 브랜치도 origin/HEAD 도
      // 안 생긴다** — 그러면 이 케이스가 재현하려던 자리 자체가 안 만들어진다.
      await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], origin)
      await runGit(['clone', origin, work], cloned)

      const names = (await readBranches(work)).branches.map((entry) => entry.name)

      expect(names).toContain('main')
      expect(names).toContain('origin/main')
      // 심볼릭 참조가 브랜치인 척 끼어들면 안 된다
      expect(names).not.toContain('origin')
      expect(names).not.toContain('origin/HEAD')
    } finally {
      await rm(origin, { recursive: true, force: true })
      await rm(cloned, { recursive: true, force: true })
    }
  }, REMOTE_TIMEOUT)

  // 위 가짜 행을 눌렀을 때 벌어지던 일 — git 은 이걸 exit 0 으로 받아 줘서
  // 쓰레기 로컬 브랜치가 생기고 전환까지 되는데 화면은 성공으로 읽는다.
  it('원격 이름만 넘어오면 로컬 브랜치를 만들지 않고 거절한다', async () => {
    await commit('a.txt', 'x\n', '첫 커밋')

    const result = await trackRemoteBranch(root, 'origin')

    expect(result.ok).toBe(false)
    expect((await readBranches(root)).branches.map((entry) => entry.name)).not.toContain('origin')
    expect((await readGitState(root)).branch).toBe('main')
  })

  it('원격 브랜치를 로컬로 받아 전환한다', async () => {
    const remote = await realpath(await mkdtemp(join(tmpdir(), 'davis-bare2-')))
    try {
      await runGit(['init', '--bare'], remote)
      await commit('a.txt', 'x\n', '첫 커밋')
      await runGit(['remote', 'add', 'origin', remote], root)
      await runGit(['push', '-u', 'origin', 'main'], root)
      // 원격에만 있는 브랜치를 만든다
      await createBranch(root, 'feature/deep')
      await commit('b.txt', 'y\n', '원격용 커밋')
      await runGit(['push', 'origin', 'feature/deep'], root)
      await switchBranch(root, 'main')
      await forceDeleteBranch(root, 'feature/deep')

      // 원격 이름만 떼고 나머지는 그대로 로컬 이름이 된다
      expect((await trackRemoteBranch(root, 'origin/feature/deep')).ok).toBe(true)
      expect((await readGitState(root)).branch).toBe('feature/deep')
      expect((await readGitState(root)).upstream).toBe('origin/feature/deep')
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  }, REMOTE_TIMEOUT)

  // 저장소가 아니면 **빈 목록이 아니라 실패**로 온다. 빈 목록으로 삼키면 화면에서
  // "브랜치가 하나도 없는 저장소" 와 구분이 사라진다 (`gitLog` 와 같은 판단).
  it('저장소가 아닌 폴더의 브랜치 목록은 ok:false 로 오고 배열 모양은 지킨다', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'davis-nobranch-')))
    try {
      const result = await readBranches(plain)

      expect(result.ok).toBe(false)
      expect(result.branches).toEqual([])
      expect(result.message).toBeTruthy()
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })

  // 폴더가 사라지면 git 은 실행조차 안 된다 (spawn ENOENT, `GitResult.failed`) —
  // 0 아닌 exit 코드와 다른 앞단 경로다. 던지면 패널이 통째로 죽는다.
  it('폴더가 사라진 저장소의 전환은 예외 대신 ok:false 로 온다', async () => {
    const result = await switchBranch(join(root, '사라진-폴더'), 'main')

    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

describe('for-each-ref 파싱', () => {
  it('필드가 비어도 자리가 안 밀린다', () => {
    // `\0` 바로 뒤에 숫자가 오면 8진 이스케이프로 읽혀 빌드가 막힌다 — 조각을 이어 붙인다
    const fields = ['*', 'refs/heads/main', 'main', '2026-07-31 10:00:00 +0900', '']
    const stdout = `${fields.join('\0')}\n`
    expect(parseBranchRefs(stdout)).toEqual([
      {
        name: 'main',
        remote: false,
        date: '2026-07-31 10:00:00 +0900',
        track: '',
        current: true,
      },
    ])
  })

  it('빈 출력은 빈 배열이다 (커밋 없는 저장소)', () => {
    expect(parseBranchRefs('')).toEqual([])
  })
})
