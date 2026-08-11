import { spawn } from 'node:child_process'

// `!명령` 로컬 실행.
//
// **LLM 을 거치지 않는다** (desktop2·CLI REPL 과 같은 규칙).
// 에이전트의 run_command 와 다른 길이다 — 그쪽은 승인·PathScope 를 거치지만
// 이건 사용자가 자기 손으로 친 명령이라 그대로 실행한다.
//
// 실행 위치는 **프로젝트 폴더**다. 어디서 도는지 모르면 상대경로를 쓸 수 없다.

export interface ShellResult {
  command: string
  code: number | null
  output: string
  /** 실행 자체가 안 됐을 때 (셸이 없음 등) */
  failed?: string
}

/** 출력이 길면 앞부분만 남긴다 — 화면과 IPC 를 통째로 막지 않게 */
const MAX_OUTPUT = 100_000
const TIMEOUT_MS = 60_000

export function runShell(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    // 셸을 거친다 — 파이프·리다이렉션을 쓰는 것이 이 기능의 목적이다
    const child = spawn(command, { cwd, shell: true })

    let output = ''
    let done = false

    const finish = (code: number | null, failed?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ command, code, output: output.trimEnd(), ...(failed ? { failed } : {}) })
    }

    const collect = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT) return
      output += chunk.toString()
      if (output.length > MAX_OUTPUT) {
        output = `${output.slice(0, MAX_OUTPUT)}\n… (출력이 잘렸습니다)`
      }
    }

    // stdout·stderr 를 함께 모은다 — 터미널에서 보는 것과 같게
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => finish(null, error.message))
    child.on('close', (code) => finish(code))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null, `${TIMEOUT_MS / 1000}초를 넘겨 중단했습니다`)
    }, TIMEOUT_MS)
  })
}
