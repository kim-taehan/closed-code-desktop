import type { LogEntry, LogSource } from '../../shared/ipc/logPayloads'

// 앱이 뱉는 로그를 한 군데 모은다.
//
// **앱 하나에 로그도 하나**라 단일 인스턴스로 둔다. 프로젝트별로 나누지 않는다 —
// runtime 은 여러 프로젝트가 함께 쓰고, 데스크탑 로그는 애초에 프로젝트가 없다.
//
// 파일로 쓰지 않는다. 로그를 보는 목적이 "방금 뭐가 잘못됐나" 라서
// 최근 것만 있으면 되고, 파일을 만들면 지우는 책임이 따라온다.

/** 넘치면 오래된 것부터 버린다. 한 줄 200자로 잡아도 몇 MB 안 된다. */
const CAP = 2000

type Listener = (entry: LogEntry) => void

class LogStore {
  private readonly entries: LogEntry[] = []
  private readonly listeners = new Set<Listener>()
  private seq = 0

  /**
   * 여러 줄이 한 덩어리로 들어와도 줄 단위로 쪼갠다 —
   * 프로세스 출력은 버퍼 경계가 줄과 안 맞아서 한 번에 여러 줄이 온다.
   */
  add(source: LogSource, chunk: string): void {
    for (const line of chunk.split('\n')) {
      const text = line.trimEnd()
      if (text === '') continue

      const entry: LogEntry = { seq: (this.seq += 1), at: Date.now(), source, text }
      this.entries.push(entry)
      if (this.entries.length > CAP) this.entries.shift()
      // 리스너 하나가 던져도(예: 창이 닫히는 중 webContents.send) 나머지를 막지 않는다.
      // 던진 예외가 위로 새면 captureConsole 이 그걸 또 로그로 잡아 무한 루프가 된다.
      for (const listener of this.listeners) {
        try {
          listener(entry)
        } catch {
          /* 로그를 내보내다 실패해도 앱이 죽으면 안 된다 */
        }
      }
    }
  }

  all(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries.length = 0
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const logStore = new LogStore()

/**
 * 메인 프로세스의 console 출력을 데스크탑 로그로 끌어온다.
 *
 * 호출부를 고치지 않고 이미 찍고 있는 것들을 그대로 모으려는 것이다.
 * **원래 콘솔에도 계속 내보낸다** — 터미널에서 보던 것이 사라지면 개발이 불편하다.
 */
export function captureConsole(target: Console = console): () => void {
  const levels = ['log', 'info', 'warn', 'error'] as const
  const original = levels.map((level) => [level, target[level]] as const)

  // 재진입 가드. 로그를 내보내는 도중(webContents.send)에 console 이 다시 불리면
  // (전송 실패로 Electron 이 warn 을 찍는 등) 여기로 되돌아와 무한 재귀 → 스택 오버플로가 된다.
  // 그때는 원래 콘솔로만 내보내고 logStore 로는 다시 넣지 않는다.
  let inside = false

  for (const [level, fn] of original) {
    target[level] = (...args: unknown[]) => {
      if (!inside) {
        inside = true
        try {
          logStore.add('desktop', args.map(stringify).join(' '))
        } finally {
          inside = false
        }
      }
      fn.apply(target, args)
    }
  }

  return () => {
    for (const [level, fn] of original) target[level] = fn
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    // 순환 참조 등 — 로그를 만들다 앱이 죽으면 안 된다
    return String(value)
  }
}
