import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// **훅이 안 도는 경우의 그물.** 강제 종료(SIGKILL)·크래시·전원 차단에는 `before-quit` 도
// `window-all-closed` 도 안 돈다. 그때 우리가 띄운 `opencode serve` 가 사용자 PC 에 남는다.
// 현장에서 쌓이면 포트와 메모리를 먹는다.
//
// ## 왜 PID 파일인가 — stdin 을 물리는 방법을 먼저 재 봤고, 안 됐다 (실측 2026-08-14)
//
// 부모(node)가 `opencode serve` 를 띄우고 부모를 `kill -9` 한 뒤 3초 뒤 자식 생사를 확인했다.
// **`stdio[0]` 을 `pipe` 로 물려도, `ignore` 로 둬도 자식은 그대로 살아남았다** (opencode
// 1.18.18, macOS 24.2). 즉 "부모가 죽으면 stdin EOF 로 자식도 끝난다" 는 기대는 여기서 거짓이다.
// 그래서 남는 길은 **띄운 PID 를 적어 두고 다음 실행 때 거두는 것**뿐이다.
//
// ## 남의 프로세스를 죽이지 않기 위한 두 겹
//
// PID 는 재사용된다. 적어 둔 번호만 믿고 죽이면 그 사이 그 번호를 물려받은 **남의**
// 프로세스를 죽인다. 그래서 죽이기 전에 두 가지를 본다:
//   1. 그 PID 가 살아 있나 (`process.kill(pid, 0)`)
//   2. **그 PID 의 명령줄이 우리가 띄운 그 실행 파일 + `serve` 인가** (`ps -o command=`)
//
// 남는 위험은 "그 사이 같은 opencode 바이너리로 사용자가 손수 띄운 것이 하필 그 PID 를
// 물려받은" 경우뿐이고, 그건 받아들인다. **`pkill -f opencode` 같은 넓은 종료는 절대 안 쓴다** —
// 그건 사용자가 손으로 띄운 서버를 반드시 죽인다.
//
// ## ⚠️ 이 대조가 통하는 **성립 조건** (실측 2026-08-16, contract-qa)
//
// 진짜 `opencode serve` 로 재 보면 맞는다:
//
//     ps  → /Users/…/.bun/bin/opencode serve --hostname 127.0.0.1
//     bin → /Users/…/.bun/bin/opencode                     ✓ includes · ✓ serve
//
// **맞는 이유는 `ps` 의 argv[0] 이 우리가 spawn 에 넘긴 그 문자열 그대로이기 때문이다.**
// 우리가 넘기는 것은 `binary.ts` 가 찾은 경로(`join(dir, 'opencode')`)이고, 그것을 그대로
// `bin` 으로 적는다 — 두 문자열이 같은 출처라 부분문자열 대조가 통한다.
//
// **그 조건이 깨지는 날이 있다.** `binary.ts` 가 나중에 realpath 로 심볼릭 링크를 풀어
// (`~/.bun/install/global/node_modules/.bin/opencode` 같은 실체 경로로) 적기 시작하면,
// argv[0] 은 여전히 링크 경로라 텍스트가 갈리고 이 대조는 **조용히 거짓**이 된다.
// 그때의 증상은 "우리 서버가 남의 것으로 보인다" 이고, 화면에는
// **"서버가 자꾸 하나씩 는다"** 로만 나타난다 — 회수도 안 되고 재시작도 안 된다.
// `binary.ts` 의 경로 해석을 고칠 때는 반드시 이 자리를 함께 본다.

/** 우리가 띄운 서버 하나의 흔적. 파일에 그대로 적힌다. */
export interface ServerRecord {
  pid: number
  url: string
  /** 어느 프로젝트에서 띄웠나 — 로그에만 쓴다 */
  root: string
  /** 우리가 실행한 파일 경로. **명령줄 대조의 기준**이다 */
  bin: string
  startedAt: number
}

/** `ps` 로 명령줄을 읽는다. 못 읽으면 null — 그때는 **죽이지 않는다.** */
function commandOf(pid: number): string | null {
  // win32 에는 `ps` 가 없다. 대조할 방법이 없으면 회수도 하지 않는다 —
  // 확인 못 한 PID 를 죽이는 것보다 유령 하나를 남기는 쪽이 낫다.
  if (process.platform === 'win32') return null
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    // 그 PID 가 없으면 ps 는 종료 코드 1 이다 — 없는 것도 여기로 온다
    return null
  }
}

/** 살아 있고, 명령줄이 우리가 띄운 그 모양인가. 둘 다 참일 때만 거둔다. */
export function isOurServer(record: ServerRecord, command = commandOf(record.pid)): boolean {
  if (command === null || command === '') return false
  return command.includes(record.bin) && command.includes('serve')
}

export class ServerPidStore {
  constructor(private readonly path: string) {}

  /**
   * 흔적을 남긴다. **동기로 쓴다** — 띄운 직후에 앱이 죽어도 그 PID 는 파일에 있어야 한다.
   * 비동기로 미루면 정확히 그 창에서 유령이 난다.
   */
  add(record: ServerRecord): void {
    this.write([...this.list().filter((kept) => kept.pid !== record.pid), record])
  }

  /**
   * **그 PID 가 우리가 띄운 opencode 서버로 지금 살아 있나.** Doctor 사다리 ②의 갈래가
   * 이 한 물음으로 갈린다 (재시작이냐 갈아타기냐 — 설계 2026-08-16 §1).
   *
   * 회수(`reap`)와 **같은 두 겹**을 쓴다: 기록에 있고 + 명령줄이 우리가 띄운 그 모양인가.
   * 죽이기 직전에만 물어보던 것을 "죽여도 되나" 를 미리 묻는 자리에서도 쓰는 것이라,
   * 판정 기준이 갈리지 않게 `isOurServer` 하나를 공유한다.
   *
   * **모르면 false 다** — 기록이 없든, 프로세스가 죽었든, 그 번호를 남이 물려받았든
   * 전부 "우리 것이 아니다" 로 답한다. 안전한 쪽으로 틀린다.
   */
  owns(pid: number | null): boolean {
    if (pid === null) return false
    const record = this.list().find((kept) => kept.pid === pid)
    return record !== undefined && isOurServer(record)
  }

  /** 곱게 거둔 것은 지운다. 안 지우면 다음 실행이 남의 PID 를 들여다본다. */
  forget(pid: number): void {
    this.write(this.list().filter((record) => record.pid !== pid))
  }

  list(): ServerRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      return Array.isArray(parsed) ? parsed.filter(isRecord) : []
    } catch {
      // 없거나 망가진 파일은 빈 목록이다 — 이것 때문에 앱이 안 뜨면 안 된다
      return []
    }
  }

  /**
   * 지난 실행이 남긴 유령을 거둔다. **앱 시작 때 한 번** 부른다.
   *
   * 남은 기록은 무조건 지운다 — 죽였든, 이미 없든, 남의 것이라 손대지 않았든
   * 그 줄은 더 이상 우리 것을 가리키지 않는다. 남겨 두면 그 PID 를 영원히 다시 본다.
   */
  reap(log?: (line: string) => void): { killed: number[]; skipped: number[] } {
    const killed: number[] = []
    const skipped: number[] = []
    for (const record of this.list()) {
      if (!isOurServer(record)) {
        skipped.push(record.pid)
        continue
      }
      try {
        process.kill(record.pid, 'SIGTERM')
        killed.push(record.pid)
        log?.(`지난 실행이 남긴 opencode 서버를 거둡니다: pid=${record.pid} ${record.url} (${record.root})`)
      } catch {
        skipped.push(record.pid)
      }
    }
    this.write([])
    return { killed, skipped }
  }

  private write(records: ServerRecord[]): void {
    try {
      writeFileSync(this.path, JSON.stringify(records), 'utf8')
    } catch {
      // 흔적을 못 남겨도 앱은 떠야 한다. 이 실패의 대가는 "유령이 남을 수 있다" 뿐이다.
    }
  }
}

function isRecord(value: unknown): value is ServerRecord {
  const record = value as ServerRecord
  return (
    typeof record?.pid === 'number' &&
    typeof record?.bin === 'string' &&
    typeof record?.url === 'string'
  )
}
