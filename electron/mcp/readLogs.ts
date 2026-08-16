import type { OutputSnapshot } from '../pty/outputBuffer'

// `read_logs` 가 받은 인자를 검사하고, 붙들어 둔 출력을 **잘라서** 모델이 읽을 글로 만든다.
// 순수 함수만 있다 — 프로세스도 앱 상태도 모른다 (`openFile.ts`·`openTerminal.ts` 와 같은 결).
//
// ## 통째로 주면 안 된다
//
// 개발 서버 로그는 몇 분이면 수천 줄이고 모델의 기억을 그것으로 채운다 (설계 §3).
// 그래서 **자르는 방법이 셋**이고, 셋이 다 있어야 긴 로그를 나눠 물을 수 있다:
//
// | 자르기 | 무엇에 쓰나 |
// |---|---|
// | `tail` — 마지막 N줄 | "지금 어디까지 왔나" · 기본값이 이것이다 |
// | `level` — 심각도 | 수천 줄에서 **문제만** 집는다 |
// | `since` — 지난번에 본 이후 | 고치고 다시 물을 때. 같은 것을 두 번 안 읽는다 |
//
// **적용 순서는 since → level → tail 이다.** 이 순서여야 "지난번 이후에 난 오류의 마지막
// 20줄" 이 뜻대로 나온다. 뒤집으면(tail 을 먼저) 마지막 20줄 안에 오류가 없을 때 빈손이 된다.
//
// ## 잘랐다는 사실을 숨기지 않는다
//
// 머리말에 **전체 줄 수**를 함께 준다. 조용히 자르면 모델이 "이게 전부" 로 읽고, 없는 줄을
// 근거로 결론을 낸다 — 이 레포의 기존 규칙(`ToolResult.truncated`)과 같은 자리다.
// 버퍼가 이미 버린 줄(`dropped`)은 **다시 읽을 수 없다**는 것까지 말해 준다: 잘린 것과
// 사라진 것은 모델이 할 수 있는 일이 다르다 (하나는 다시 물으면 되고 하나는 안 된다).

/** 기본으로 실을 줄 수. 100줄이면 한 화면 몫이고 컨텍스트를 태우지 않는다. */
const DEFAULT_TAIL = 100
/** 아무리 많이 달래도 여기까지. 이 도구의 존재 이유가 "반드시 잘라서" 라서 상한이 있다. */
const MAX_TAIL = 1000
/**
 * 한 줄의 글자 상한. 줄 수만 세면 **한 줄짜리 로그가 상한을 통째로 무시한다** —
 * 번들러·base64·미니파이된 스택은 한 줄이 수십 KB다.
 */
const MAX_LINE_CHARS = 2000

/** `all` 은 안 거른다. `warn` 은 경고와 오류를, `error` 는 오류만. */
export type LogLevel = 'all' | 'warn' | 'error'

export interface ReadLogsQuery {
  name: string
  tail: number
  level: LogLevel
  /** 절대 줄 번호. 그 번호부터(0 기준) 뒤만 본다. 없으면 처음부터 */
  since: number | null
}

/**
 * 인자를 읽는다. 틀린 값은 **조용히 고치지 않고 던진다** — 모델이 준 것과 다른 것을
 * 돌려주면 그 차이는 어디에도 안 보이고, 모델은 자기가 물은 것에 대한 답으로 읽는다.
 */
export function readLogsQuery(args: Record<string, unknown>): ReadLogsQuery {
  const name = args['name']
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('name 이 없습니다 — 어느 프로세스의 로그인지 이름으로 말해야 합니다')
  }

  return {
    name: name.trim(),
    tail: tailOf(args['tail']),
    level: levelOf(args['level']),
    since: sinceOf(args['since']),
  }
}

/**
 * 붙들어 둔 출력을 모델이 읽을 글로 만든다.
 *
 * 머리말이 이 함수의 절반이다 — 무엇을 얼마나 잘랐는지, 다음에 무엇을 주면 이어 볼 수
 * 있는지가 거기 있다.
 */
export function formatLogs(query: ReadLogsQuery, snapshot: OutputSnapshot): string {
  const { dropped, total } = snapshot
  const notes: string[] = [
    `\`${query.name}\` 가 지금까지 낸 줄은 모두 ${total}줄입니다.`,
  ]

  // 1) since — 절대 줄 번호로 자른다. `lines[i]` 의 번호는 `dropped + i` 다.
  let lines = snapshot.lines.map((text, index) => ({ at: dropped + index, text }))
  if (query.since !== null) {
    if (query.since > total) {
      // 전체가 지난번보다 줄었다 = 같은 이름으로 **다른 프로세스**가 도는 것이다
      // (탭을 닫았다 다시 띄우면 버퍼가 새로 생긴다).
      notes.push(
        `⚠️ since(${query.since})가 전체 줄 수보다 큽니다 — 그 사이에 프로세스가 다시 뜬 것 같습니다. since 없이 다시 부르세요.`,
      )
    }
    const lost = Math.max(0, dropped - query.since)
    if (lost > 0) {
      notes.push(
        `⚠️ 지난번에 본 뒤로 나온 것 중 ${lost}줄은 버퍼 상한을 넘겨 **이미 사라졌습니다** — 다시 읽을 수 없습니다.`,
      )
    }
    lines = lines.filter((line) => line.at >= (query.since ?? 0))
  } else if (dropped > 0) {
    notes.push(
      `⚠️ 앞의 ${dropped}줄은 버퍼 상한을 넘겨 **이미 사라졌습니다** — 다시 읽을 수 없습니다.`,
    )
  }

  // 2) level — 심각도로 거른다
  if (query.level !== 'all') {
    const wanted = lines.filter((line) => atLeast(severityOf(line.text), query.level))
    notes.push(
      `심각도 ${query.level} 이상만 골라 ${lines.length}줄 중 ${wanted.length}줄이 남았습니다.`,
    )
    lines = wanted
  }

  // 3) tail — 마지막 N줄
  if (lines.length > query.tail) {
    notes.push(
      `**앞부분을 잘랐습니다** — 조건에 맞는 ${lines.length}줄 중 마지막 ${query.tail}줄만 실었습니다. 더 보려면 tail 을 키우거나 level 로 좁히세요.`,
    )
    lines = lines.slice(-query.tail)
  }

  notes.push(
    `이어서 볼 때는 \`since: ${total}\` 로 부르세요 — 그 뒤에 새로 나온 것만 옵니다.`,
  )

  if (lines.length === 0) return `${notes.join('\n')}\n\n(조건에 맞는 줄이 없습니다)`
  return `${notes.join('\n')}\n\n---\n${lines.map((line) => render(line.text)).join('\n')}`
}

/**
 * 심각도를 낱말로 짐작한다.
 *
 * ⚠️ **짐작이지 판정이 아니다.** 프로세스마다 로그 형식이 다르고 표준이 없다. 여기 있는
 * 낱말은 흔한 영어 표기를 모은 것이고, **실제 개발 서버 출력으로 재 본 것이 아니다** —
 * 실측으로 늘려야 할 자리다 (설계 §7 미결 1과 같은 종류).
 *
 * **색은 안 본다.** 버퍼가 ANSI 를 남겨 둔 덕에 볼 수는 있지만(`outputBuffer.ts`), 셸
 * 프롬프트와 `ls` 출력이 늘 색을 달고 있어 **거짓 오류가 쏟아진다.** 진단하는 모델에게는
 * 놓치는 것보다 없는 오류를 만드는 쪽이 나쁘다. 필요해지면 실측을 근거로 켠다.
 */
function severityOf(line: string): LogLevel {
  const text = stripAnsi(line)
  if (/\b(error|errors|fatal|exception|traceback|panic|failed|failure)\b/i.test(text)) return 'error'
  if (/\b(warn|warning|warnings|deprecated|deprecation)\b/i.test(text)) return 'warn'
  return 'all'
}

/** `all`(=평범한 줄) < `warn` < `error`. 물은 값 이상이면 싣는다. */
function atLeast(severity: LogLevel, wanted: LogLevel): boolean {
  const rank = { all: 0, warn: 1, error: 2 }
  return rank[severity] >= rank[wanted]
}

/**
 * 실을 글자. **ANSI 는 여기서 벗긴다** — 모델에게 색은 읽을 수 없는 잡음이고 컨텍스트만
 * 먹는다. 버퍼가 원본을 들고 있으므로 되돌릴 수 없는 손실은 아니다.
 */
function render(text: string): string {
  const line = stripAnsi(text)
  if (line.length <= MAX_LINE_CHARS) return line
  return `${line.slice(0, MAX_LINE_CHARS)}… (이 줄은 ${line.length - MAX_LINE_CHARS}자 더 있습니다)`
}

/** CSI(색·커서)와 OSC(창 제목) 둘만 벗긴다 — 터미널 출력에서 실제로 오는 것이 이 둘이다. */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
}

function tailOf(asked: unknown): number {
  if (asked === undefined || asked === null) return DEFAULT_TAIL
  if (typeof asked !== 'number' || !Number.isInteger(asked) || asked <= 0) {
    throw new Error('tail 은 1 이상의 정수여야 합니다')
  }
  return Math.min(asked, MAX_TAIL)
}

function levelOf(asked: unknown): LogLevel {
  if (asked === undefined || asked === null) return 'all'
  // `info` 는 "안 거른다" 는 뜻으로 온다 — 모델이 흔히 쓰는 말이라 받아 준다
  if (asked === 'info' || asked === 'all') return 'all'
  if (asked === 'warn' || asked === 'error') return asked
  throw new Error('level 은 error · warn · all 중 하나여야 합니다')
}

function sinceOf(asked: unknown): number | null {
  if (asked === undefined || asked === null) return null
  if (typeof asked !== 'number' || !Number.isInteger(asked) || asked < 0) {
    throw new Error('since 는 0 이상의 정수여야 합니다 — 지난번 답에 실린 값을 그대로 주세요')
  }
  return asked
}
