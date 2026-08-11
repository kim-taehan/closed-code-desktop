// 프로젝트마다 **지금 도는 질의를 끊을 손잡이**를 들고 있는 곳.
//
// 확장 명령은 어시스턴트를 여러 번 부르고 그 하나하나가 수 분이다. 중단이 없으면
// 사용자는 **끝날 때까지 기다리는 것 말고 할 수 있는 일이 없다** — 잘못 고른 대상이나
// 엉뚱한 프로젝트를 훑기 시작해도 마찬가지다.
//
// **프로젝트별로 가른다.** 앱 하나에 확장 호스트가 하나뿐이라 겉봉으로 갈라 두지 않으면
// A 프로젝트의 중단이 B 프로젝트에서 도는 질의까지 끊는다.

export class CancelBook {
  private readonly running = new Map<string, Set<AbortController>>()

  /**
   * 질의 하나를 **끊을 수 있는 상태로** 돌린다.
   *
   * 같은 프로젝트에서 여럿이 겹쳐 돌 수 있어 집합으로 둔다 (명령 둘을 연달아 걸 수 있다).
   * 끝나면 반드시 걷는다 — 안 걷으면 다음 중단이 이미 끝난 질의를 끊으려 든다.
   */
  async run<T>(projectId: string | null, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = projectId ?? ''
    const controller = new AbortController()
    const bag = this.running.get(key) ?? new Set()
    bag.add(controller)
    this.running.set(key, bag)

    try {
      return await work(controller.signal)
    } finally {
      bag.delete(controller)
      if (bag.size === 0) this.running.delete(key)
    }
  }

  /** 그 프로젝트에서 도는 질의를 전부 끊는다. 도는 것이 없으면 아무 일도 없다. */
  cancel(projectId: string | null): void {
    for (const controller of this.running.get(projectId ?? '') ?? []) controller.abort()
  }
}
