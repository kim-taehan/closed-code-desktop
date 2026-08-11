import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runGit, succeeded } from './gitRunner'

describe('git 실행기', () => {
  it('stdout 과 stderr 를 섞지 않는다', async () => {
    const result = await runGit(['--version'], tmpdir())

    expect(succeeded(result)).toBe(true)
    expect(result.stdout).toMatch(/^git version/)
    // 여기서 섞이면 porcelain 파싱이 남의 줄을 먹는다
    expect(result.stderr).toBe('')
  })

  it('없는 하위명령은 0 아닌 code 와 stderr 로 온다 — 예외가 아니다', async () => {
    const result = await runGit(['이런건없다'], tmpdir())

    expect(result.failed).toBeUndefined()
    expect(result.code).not.toBe(0)
    expect(result.stderr).not.toBe('')
    expect(result.stdout).toBe('')
  })

  it('git 이 없으면 예외 대신 failed 로 알린다', async () => {
    // PATH 를 비워 git 을 못 찾게 한다. 앱이 죽으면 안 된다.
    const path = process.env['PATH']
    process.env['PATH'] = ''
    try {
      const result = await runGit(['--version'], tmpdir())
      expect(result.failed).toBeDefined()
      expect(result.code).toBeNull()
      expect(succeeded(result)).toBe(false)
    } finally {
      process.env['PATH'] = path
    }
  })

  it('인자를 셸에 넘기지 않는다 — 파일명에 셸 문자가 있어도 그대로 전달된다', async () => {
    // 셸을 거쳤다면 `;` 뒤가 별도 명령으로 돌거나 따옴표가 벗겨진다.
    // git 은 이 경로를 그냥 "없는 파일" 로 보고 알려야 한다.
    const result = await runGit(['ls-files', '--error-unmatch', 'a b;echo $HOME.txt'], tmpdir())

    expect(result.code).not.toBe(0)
    expect(result.stdout).not.toContain(process.env['HOME'] ?? '///')
  })
})

// stdin 을 열어 둔 채로 두면 표준입력을 읽는 하위명령이 60초 타임아웃까지 매달린다.
// 아래 두 케이스가 그 회귀를 막는다 — `end()` 를 지우면 vitest 기본 5초 제한에 먼저 걸린다.
describe('git 실행기 — 표준입력', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'davis-run-')))
    await runGit(['init', '-b', 'main'], root)
    await runGit(['config', 'user.email', 'test@example.com'], root)
    await runGit(['config', 'user.name', '테스트'], root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('패치를 stdin 으로 먹인 `apply --check -` 가 매달리지 않고 끝난다', async () => {
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '첫 커밋'], root)
    // 진짜 git 이 낸 패치를 그대로 되먹인다 — 손으로 쓴 패치는 검증이 되지 않는다
    await writeFile(join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n')
    const patch = await runGit(['diff', '--no-color'], root)
    await runGit(['restore', '--', 'a.txt'], root)

    const started = Date.now()
    const result = await runGit(['apply', '--check', '-'], root, patch.stdout)

    expect(succeeded(result)).toBe(true)
    // 60초 타임아웃을 채우고 오는 것과 구분한다. 옛 코드였다면 `failed` 로 왔다.
    expect(result.failed).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('입력을 안 넘겨도 stdin 을 읽는 명령이 매달리지 않는다', async () => {
    const started = Date.now()
    const result = await runGit(['apply', '--check', '-'], root)

    // 빈 입력이라 git 은 실패하지만, **타임아웃이 아니라 제 발로** 끝나야 한다
    expect(result.failed).toBeUndefined()
    expect(result.code).not.toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('출력이 상한을 넘으면 stdoutTruncated 로 알린다 — code 는 0 이다', async () => {
    await writeFile(join(root, 'big.txt'), '')
    await runGit(['add', '-A'], root)
    await runGit(['commit', '-m', '첫 커밋'], root)
    // 100KB 상한을 확실히 넘긴다 (한 줄 20B × 10000 = 200KB)
    await writeFile(join(root, 'big.txt'), 'x'.repeat(19).concat('\n').repeat(10_000))

    const result = await runGit(['diff', '--no-color'], root)

    expect(result.stdoutTruncated).toBe(true)
    // 잘렸다고 실패로 오지 않는다 — 부르는 쪽이 code 만 보면 놓치는 자리다
    expect(result.code).toBe(0)
    expect(succeeded(result)).toBe(true)
  })

  it('상한 안쪽 출력에는 stdoutTruncated 가 없다', async () => {
    const result = await runGit(['--version'], root)

    expect(result.stdoutTruncated).toBeUndefined()
  })

  /** 정확한 크기의 blob 을 만들어 그대로 뱉게 한다 — stdout 길이를 글자 단위로 맞추려는 우회 */
  async function catBlobOf(size: number) {
    await writeFile(join(root, 'blob.bin'), 'x'.repeat(size))
    const hashed = await runGit(['hash-object', '-w', 'blob.bin'], root)
    return runGit(['cat-file', '-p', hashed.stdout.trim()], root)
  }

  it('정확히 상한이면 플래그도 문구도 안 붙는다 — 경계에서 둘이 같은 말을 한다', async () => {
    const result = await catBlobOf(100_000)

    expect(result.stdout.length).toBe(100_000)
    expect(result.stdoutTruncated).toBeUndefined()
    // 길이를 따로 재던 시절(`>=` vs `>`)에는 여기서 문구만 붙어 플래그와 반대를 말했다
    expect(result.stderr).not.toContain('잘렸습니다')
  })

  it('상한을 1글자 넘기면 플래그와 문구가 함께 선다', async () => {
    const result = await catBlobOf(100_001)

    expect(result.stdout.length).toBe(100_000)
    expect(result.stdoutTruncated).toBe(true)
    expect(result.stderr).toContain('잘렸습니다')
  })

  it('stderr 만 넘쳐도 stdoutTruncated 는 안 선다 — 온전한 diff 를 거절하지 않게', async () => {
    // 없는 파일을 고치는 hunk 를 잔뜩 먹인다. git 이 파일마다 error 한 줄을 stderr 로 낸다.
    const patch = Array.from(
      { length: 4_000 },
      (_, at) => `diff --git a/no-${at}.txt b/no-${at}.txt\n--- a/no-${at}.txt\n+++ b/no-${at}.txt\n@@ -1 +1 @@\n-a\n+b\n`,
    ).join('')

    const result = await runGit(['apply', '--check', '-'], root, patch)

    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBe(100_000)
    // 한 플래그를 두 스트림이 나눠 쓰던 시절이면 여기서 true 가 되어 떨어진다
    expect(result.stdoutTruncated).toBeUndefined()
  })
})
