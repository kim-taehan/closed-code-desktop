// 아직 못 넣은 바이트를 칸마다 맡아 둔다.
//
// **이 자리가 필요한 이유는 순서다.** 칸을 열라고 시킨 시점의 소켓은 아직 CONNECTING 이고,
// 그때 쓴 바이트는 아무 흔적 없이 사라진다 (`PtySocket.open` 의 실측) — 화면에도, 모델에게도,
// 로그에도 안 남는 종류의 실패다. 그래서 맡아 뒀다가 소켓이 열릴 때 넣는다.
//
// `drawerBridge.ts` 에서 뽑아 왔다 (그 파일이 300줄 상한에 닿았다). 판단은 하나도 안 옮겼다.
//
// **무엇을 맡기는지는 맡기는 쪽이 정한다** — `fill`(open_terminal)은 **개행 없는** 글자를
// 맡기고(사용자가 보고 엔터를 친다), `run`(run_project)은 **개행까지** 맡긴다(그 자리에서
// 돌아간다). 여기서는 바이트를 그대로 들고 있을 뿐 그 차이를 모른다.

/** 그 칸에 넣어 본다. 아직 못 넣으면 false — 다음 기회를 기다린다. */
export type PaneWriter = (projectId: string, name: string, bytes: string) => boolean

export class PendingWrites {
  /** 키는 프로젝트와 이름 두 겹 (`key`). 칸마다 하나이고 뒤엣것이 앞엣것을 덮는다. */
  private readonly waiting = new Map<string, string>()

  constructor(private readonly write: PaneWriter) {}

  /** 맡기고 바로 한 번 시도한다 — 이미 열려 있는 칸이면 그 자리에서 들어간다. */
  enqueue(projectId: string, name: string, bytes: string): void {
    this.waiting.set(key(projectId, name), bytes)
    this.flush(projectId, name)
  }

  /** 맡아 둔 것을 넣는다. 못 넣었으면 그대로 두고 다음 기회를 기다린다. */
  flush(projectId: string, name: string): void {
    const at = key(projectId, name)
    const bytes = this.waiting.get(at)
    if (bytes === undefined) return
    if (this.write(projectId, name, bytes)) this.waiting.delete(at)
  }

  /**
   * 프로젝트 탭을 닫았다 — 맡아 둔 것도 버린다.
   *
   * 남겨 두면 그 프로젝트를 다시 열었을 때 사용자가 잊은 명령이 유령처럼 채워진다.
   * `run` 이 맡긴 것은 유령처럼 **돌아간다.**
   */
  clearProject(projectId: string): void {
    const prefix = key(projectId, '')
    for (const at of [...this.waiting.keys()]) {
      if (at.startsWith(prefix)) this.waiting.delete(at)
    }
  }
}

/**
 * **NUL 로 잇는다.** 이름은 pty 제목이 되므로(`paneServerTitle`) 사람이 읽는 값이고,
 * 눈에 보이는 구분자를 쓰면 그 글자가 프로젝트 id 나 이름에 나타나는 순간 서로 다른 칸이
 * 같은 키가 된다. `clearProject` 의 접두사 지우기도 이 구분자에 기댄다.
 */
function key(projectId: string, name: string): string {
  return `${projectId}\u0000${name}`
}
