import { spawn } from 'node:child_process'

// git 실행기.
//
// **`runShell` 을 재사용하지 않는다** (설계 §5). 이유가 둘이다.
//   (a) 그쪽은 stdout 과 stderr 를 한 덩어리로 합친다. git 이 경고 한 줄을 stderr 로 내면
//       porcelain 파싱이 그 줄에서 깨진다.
//   (b) 그쪽은 `shell: true` 로 문자열을 넘긴다. 파일명에 공백·따옴표·`$` 가 있으면
//       셸이 먼저 건드린다. 여기서는 **인자 배열을 셸 없이** 넘긴다.
//
// 실패해도 예외를 던지지 않는다 — 부르는 쪽이 매번 try 로 감싸게 하지 않으려는 것이다.
// git 이 PATH 에 없어도 앱은 계속 돌아야 한다.

export interface GitResult {
  /** 프로세스 종료 코드. 실행 자체가 안 됐으면 null */
  code: number | null
  stdout: string
  stderr: string
  /** 실행 자체가 안 됐을 때의 사유 (git 없음·타임아웃) */
  failed?: string
  /**
   * **stdout** 이 `MAX_OUTPUT` 에서 잘렸는지. 이름에 스트림을 박아 둔다 —
   * 한 플래그를 두 스트림이 나눠 쓰면 **stderr 만 넘쳐도 서서**, 소비자
   * (`gitHunk` 의 "잘린 패치는 apply 하지 않는다")가 온전한 diff 를 거절한다.
   * stderr 절단은 사람이 읽는 사유 문구라 부르는 쪽의 판정 대상이 아니다.
   *
   * 잘려도 **code 는 0** 이다. stderr 에 문구만 붙던 시절에는 부르는 쪽이
   * 잘린 줄 모르고 넘어갔다 — 화면이 잘리는 것으로 끝나면 그래도 됐지만,
   * **잘린 패치를 `git apply` 에 먹이는 것**은 위험도가 다르다.
   * 그래서 문구가 아니라 명시 필드로 올린다.
   */
  stdoutTruncated?: boolean
}

/** `shellRunner` 와 같은 값을 쓴다 — 두 곳이 다른 한계를 가지면 설명하기 어렵다 */
const MAX_OUTPUT = 100_000
const TIMEOUT_MS = 60_000

/**
 * @param input stdin 으로 먹일 내용 (`git apply -` 처럼 표준입력을 읽는 명령용).
 *   안 넘겨도 stdin 은 **항상 닫는다** — 아래 실측 참고.
 */
export function runGit(args: string[], cwd: string, input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd })

    // stdio 기본값이 `pipe` 라 **자식의 stdin 이 열린 채로 남는다.** 닫아 주지 않으면
    // 표준입력을 읽는 하위명령(`apply --check -`)이 EOF 를 못 받아 `TIMEOUT_MS` 60초를
    // 다 채우고 죽는다 (실측). 그래서 입력이 없어도 `end('')` 로 항상 닫는다.
    // git 이 다 읽기 전에 끝나면 EPIPE 가 오는데, 잡지 않으면 프로세스가 터진다.
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? '')

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let done = false

    const finish = (code: number | null, failed?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({
        code,
        stdout,
        stderr,
        ...(failed ? { failed } : {}),
        ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
      })
    }

    // porcelain 출력은 잘리면 안 되지만, 상한이 없으면 잘못된 명령 하나로 메모리를 먹는다.
    // 잘랐는지는 **스트림별로** 돌려준다 — 한 변수에 모으면 stderr 넘침이 stdout 의
    // 절단으로 둔갑한다.
    const cap = (text: string, chunk: Buffer): { text: string; cut: boolean } => {
      if (text.length >= MAX_OUTPUT) return { text, cut: true }
      const next = text + chunk.toString()
      if (next.length > MAX_OUTPUT) return { text: next.slice(0, MAX_OUTPUT), cut: true }
      return { text: next, cut: false }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const capped = cap(stdout, chunk)
      stdout = capped.text
      if (capped.cut) stdoutTruncated = true
    })
    child.stderr.on('data', (chunk: Buffer) => {
      // stderr 도 상한은 걸되 플래그는 안 세운다 — 위 필드 주석 참고
      stderr = cap(stderr, chunk).text
    })

    child.on('error', (error) => finish(null, error.message))
    child.on('close', (code) => {
      // 문구와 플래그를 **한 판정에서** 낸다. 길이를 따로 재던 시절에는 `>=` 와 `>` 가
      // 갈려 정확히 MAX_OUTPUT 일 때 문구만 붙고 플래그는 안 서는 자리가 있었다.
      if (stdoutTruncated) stderr += '\n(출력이 잘렸습니다)'
      finish(code)
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null, `${TIMEOUT_MS / 1000}초를 넘겨 중단했습니다`)
    }, TIMEOUT_MS)
  })
}

/** 성공했는지. git 은 "변경 없음" 을 1 로 알리는 하위명령이 있어 부르는 쪽이 따로 판단할 때도 있다. */
export function succeeded(result: GitResult): boolean {
  return result.failed === undefined && result.code === 0
}
