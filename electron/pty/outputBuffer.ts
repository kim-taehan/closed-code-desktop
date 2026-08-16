// 프로세스 하나가 뱉은 것을 붙들어 두는 링버퍼.
//
// 이 기능의 무게중심은 실행이 아니라 **보유**다 (설계 2026-08-16 §0) — 개발 서버는 안
// 끝나므로 "명령이 끝나면 결과를 준다" 는 길이 통째로 없다. 지나간 출력을 나중에 물으려면
// 누군가 들고 있어야 하고, 그게 여기다.
//
// `electron/logs/logStore.ts` 와 **같은 결이되 다른 물건**이다. 저쪽은 앱 하나에 하나(앱
// 자체 진단용)라 단일 인스턴스지만, 이쪽은 **프로세스마다 하나**다 — 로그를 묻는 단위가
// 프로세스이기 때문이다 (`read_logs(name, …)`).
//
// ## 넘치면 버리되 **버렸다는 사실을 남긴다**
//
// 조용히 자르면 다음 층(`read_logs`)이 "이게 전부" 로 읽는다. 이 레포에는 이미 같은 규칙이
// 있다 — `ToolResult.truncated`. 그래서 `snapshot()` 은 남은 줄만이 아니라 **버린 수와 전체
// 수**를 함께 준다.

/** 넘치면 오래된 것부터 버린다. 한 줄 200자로 잡아도 몇 MB 안 된다 (`logStore` 와 같은 값). */
const CAP = 2000

export interface OutputSnapshot {
  /** 지금 들고 있는 줄. 아직 개행이 안 온 마지막 조각도 한 줄로 함께 온다 */
  lines: string[]
  /** 상한을 넘겨 버린 줄 수. **0 이 아니면 `lines` 가 전부가 아니다** */
  dropped: number
  /** 이 프로세스가 지금까지 낸 전체 줄 수 (`dropped + lines.length`) */
  total: number
}

export class OutputBuffer {
  private readonly lines: string[] = []
  /**
   * 아직 개행이 안 온 마지막 조각.
   *
   * pty 는 버퍼 경계가 줄과 안 맞아서 한 덩어리가 줄 가운데서 끊긴다. 조각을 그대로 한 줄로
   * 세면 `npm run dev` 한 번에 없는 줄이 수십 개 생긴다 — 그래서 다음 덩어리와 이어 붙인다.
   */
  private pending = ''
  private dropped = 0

  constructor(private readonly cap: number = CAP) {}

  /**
   * 터미널 바이트를 그대로 받는다. **ANSI 이스케이프를 벗기지 않는다** —
   * 색은 심각도 판정에 쓸 수 있는 몇 안 되는 단서라, 지우는 것은 그 판정을 만드는 층
   * (`read_logs` 의 `level`)에서 정할 일이다. 여기서 미리 지우면 되돌릴 수 없다.
   */
  push(chunk: string): void {
    const parts = (this.pending + chunk).split('\n')
    // 마지막 조각은 개행을 못 봤다 — 다음 덩어리를 기다린다
    this.pending = collapse(parts.pop() ?? '')
    for (const part of parts) this.append(collapse(part))
  }

  /**
   * 지금 들고 있는 것. **버린 사실을 함께 준다** (머리말).
   *
   * 아직 개행이 안 온 조각도 마지막 줄로 넣는다 — 개발 서버의 마지막 한 줄이
   * `Local: http://localhost:5173` 처럼 개행 없이 멈춰 있는 일이 흔하고,
   * 그걸 빼면 정작 알고 싶던 줄이 안 보인다.
   */
  snapshot(): OutputSnapshot {
    const lines = this.pending === '' ? [...this.lines] : [...this.lines, this.pending]
    return { lines, dropped: this.dropped, total: this.dropped + lines.length }
  }

  private append(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.cap) {
      this.lines.shift()
      // 버린 수를 세는 자리가 버리는 자리와 **같아야** 한다. 갈리면 그 틈이 곧 거짓말이다.
      this.dropped += 1
    }
  }
}

/**
 * 한 줄 안의 캐리지 리턴을 터미널처럼 접는다 — **마지막 `\r` 뒤만 남긴다.**
 *
 * `\r\n` 의 `\r` 을 떼는 일이 이 함수의 절반이고, 나머지 절반은 진행 표시줄이다:
 * `npm`·`vite`·`docker` 는 개행 없이 `\r` 로 같은 줄을 덮어쓴다. 안 접으면 다운로드 하나가
 * 수백 KB 짜리 한 줄이 되고, `\r` 을 줄바꿈으로 치면 진행 표시 한 프레임이 한 줄씩 쌓여
 * **링버퍼가 그것만으로 가득 찬다** — 정작 필요한 앞부분이 밀려 나간다.
 *
 * 화면(xterm)이 하는 것과 완전히 같지는 않다. 덮어쓰는 글자가 더 짧으면 터미널에는 앞
 * 내용의 꼬리가 남지만 여기서는 사라진다. 로그를 읽는 목적에서는 마지막 프레임이 곧 결과라
 * 그 차이가 문제가 된 적이 없다 — 문제가 되면 그때 실측을 근거로 늘린다.
 */
function collapse(line: string): string {
  // **줄 끝의 `\r` 을 먼저 뗀다.** 안 떼면 `첫 줄\r\n` 의 `\r` 이 "마지막 `\r`" 이 되어
  // 그 뒤(=빈 문자열)만 남는다 — `\r\n` 을 쓰는 모든 줄이 통째로 빈 줄이 됐다 (테스트가 잡았다).
  const body = line.replace(/\r+$/, '')
  const last = body.lastIndexOf('\r')
  return last === -1 ? body : body.slice(last + 1)
}
