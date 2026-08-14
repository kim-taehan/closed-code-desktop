import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'

// `opencode serve` 프로세스 하나의 수명.
//
// **`--port` 를 주지 않는다.** 주면 프로젝트 둘을 열 때 같은 포트를 다투고, 사용자가 이미
// 4096 에 띄워 둔 것과도 부딪힌다. 안 주면 opencode 가 빈 포트를 스스로 잡고 stdout 에
//
//     opencode server listening on http://127.0.0.1:55640
//
// 를 찍는다 (실측 2026-08-14: 둘을 동시에 띄우면 55640·55641 로 갈렸다). **그 한 줄이
// 우리가 주소를 아는 유일한 길이다** — 포트를 우리가 고르지 않았으므로 물어볼 곳이 없다.
//
// ⚠️ **세션 저장소는 서버끼리 공유된다** (실측). A 에서 만든 세션을 B 가 즉시 본다.
// 그래서 이것을 "프로젝트 격리" 라고 부르면 안 된다 — 갈리는 것은 **MCP 등록**(instance
// 수명)과 설정 캐시뿐이고, 대화 목록은 여전히 한 저장소다.
//
// ⚠️ **우리가 띄운 것만 끈다.** 사용자가 손으로 띄운 서버가 같은 기계에 살아 있다 —
// `pkill -f opencode` 같은 넓은 종료는 그것까지 죽인다. 여기서는 받은 자식만 kill 한다.

/** 실행 중인 서버 하나. */
export interface SpawnedServer {
  /** stdout 에서 읽어낸 주소. 끝에 `/` 는 없다 */
  url: string
  pid: number | undefined
  /** SIGTERM → (안 죽으면) SIGKILL. 이미 죽었으면 아무 일도 안 한다 */
  stop(): Promise<void>
}

/**
 * 우리가 실제로 쓰는 것만 추린 자식 프로세스 모양.
 *
 * 진짜 `ChildProcess` 는 구조적으로 이걸 만족한다. 시험이 진짜 프로세스를 띄우지 않고
 * `PassThrough` 로 stdout 을 흉내낼 수 있게 좁혀 뒀다.
 */
export interface ServerChild {
  readonly pid?: number | undefined
  readonly stdout: Readable | null
  readonly stderr: Readable | null
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type SpawnServer = (
  binPath: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ServerChild

export interface StartServerOptions {
  binPath: string
  /** 프로젝트 루트. opencode 는 여기를 기준으로 설정·프로젝트를 잡는다 */
  cwd: string
  /** 기본 127.0.0.1. 0.0.0.0 으로 열면 같은 망의 누구나 이 서버를 쓴다 */
  hostname?: string
  /** 주소 한 줄을 기다리는 시간. 넘기면 죽이고 그때까지 받은 출력을 사유로 준다 */
  timeoutMs?: number
  spawnImpl?: SpawnServer
  log?: (line: string) => void
}

const DEFAULT_TIMEOUT_MS = 30_000
/** SIGTERM 뒤 이만큼 안 죽으면 SIGKILL */
const KILL_GRACE_MS = 5_000
/** 실패 사유에 실을 출력 길이 상한 — 로그가 길면 화면이 통째로 막힌다 */
const MAX_OUTPUT = 4_000

/**
 * 「listening on <url>」 한 줄에서 주소를 뽑는다.
 *
 * 문구 전체를 기대하지 않고 `listening` 과 URL 만 본다 — opencode 판마다 앞뒤 말이 바뀌어도
 * 이 둘은 남았다. ANSI 색 코드가 섞여 들어올 수 있어 URL 뒤는 공백·제어문자에서 끊는다.
 */
export function parseListeningUrl(line: string): string | null {
  if (!line.includes('listening')) return null
  const match = /https?:\/\/[^\s]+/.exec(line)
  return match === null ? null : match[0].replace(/\/+$/, '')
}

const defaultSpawn: SpawnServer = (binPath, args, options) =>
  spawn(binPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * 서버를 띄우고 **주소를 읽을 때까지** 기다린다.
 *
 * 성공 판정을 stdout 한 줄로 하는 이유: 포트를 우리가 안 골랐으니 HTTP 로 찔러 볼 주소가
 * 아직 없다. 그 줄이 곧 "듣기 시작했다" 이므로 따로 확인하지 않는다.
 */
export function startOpencodeServer(options: StartServerOptions): Promise<SpawnedServer> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const args = ['serve', '--hostname', options.hostname ?? '127.0.0.1']

  return new Promise<SpawnedServer>((resolve, reject) => {
    let child: ServerChild
    try {
      child = spawnImpl(options.binPath, args, { cwd: options.cwd, env: process.env })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    let output = ''
    let settled = false
    let exited = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const fail = (reason: string): void =>
      finish(() => {
        // 우리가 띄운 것만 끈다 — 실패해도 좀비를 남기지 않는다
        if (!exited) child.kill('SIGKILL')
        reject(new Error(`${reason}\n${output.trim()}`.trimEnd()))
      })

    // **완성된 줄만 본다.** 청크가 URL 한가운데서 끊길 수 있고, 그때 조각을 주소로 읽으면
    // 포트가 잘린 채로 굳는다 — 잘못된 주소보다 시간초과가 낫다 (그쪽은 화면에 보인다).
    let pending = ''
    const collect = (chunk: Buffer | string): void => {
      const text = chunk.toString()
      if (output.length < MAX_OUTPUT) output += text
      options.log?.(text.trimEnd())
      if (settled) return
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const url = parseListeningUrl(line)
        if (url === null) continue
        finish(() => resolve({ url, pid: child.pid, stop: () => stop(child, () => exited) }))
        return
      }
    }

    // stdout·stderr 를 함께 본다 — 판에 따라 이 줄이 stderr 로 나온 적이 있다
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (error) => fail(`opencode 를 실행하지 못했습니다: ${error.message}`))
    child.on('exit', (code, signal) => {
      exited = true
      fail(`opencode 가 주소를 알리기 전에 끝났습니다 (code=${code} signal=${signal})`)
    })

    const timer = setTimeout(() => fail(`opencode 가 ${timeoutMs / 1000}초 안에 주소를 알리지 않았습니다`), timeoutMs)
  })
}

/** SIGTERM 으로 부탁하고, 유예 안에 안 죽으면 SIGKILL. 이미 죽었으면 즉시 끝난다. */
function stop(child: ServerChild, hasExited: () => boolean): Promise<void> {
  if (hasExited()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    child.on('exit', finish)
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, KILL_GRACE_MS)
  })
}
