// 확장이 밀어 올린 결과가 **어느 프로젝트 것인가**.
//
// 확장 호스트는 프로젝트마다 하나가 아니라 **앱에 하나**다. 그래서 `setRows`·`setTree` 가
// 올라와도 그것만으로는 어느 탭에 붙일지 알 수 없다. 부르는 쪽이 「지금 이 프로젝트 일을
// 시킨다」를 여기 세워 두고, 그 사이에 올라온 것에 같은 겉봉을 붙인다.
//
// **겉봉은 거는 순간 굳는다.** 밀 때 활성 프로젝트를 다시 조회하면, 오래 걸리는 명령이
// 도는 중에 사용자가 탭을 옮겼을 때 결과가 엉뚱한 탭으로 간다 (`_workspace/53` M2).

export class ProjectEnvelope {
  /** 지금 도는 일들의 프로젝트. 같은 프로젝트에서 둘이 겹칠 수 있어 **집합이 아니라 목록**이다. */
  private readonly running: (string | null)[] = []

  /** `projectId` 겉봉을 세운 채 `work` 를 돌린다. 던져도 겉봉은 걷힌다. */
  async during<T>(projectId: string | null, work: () => Promise<T>): Promise<T> {
    this.running.push(projectId)
    try {
      return await work()
    } finally {
      // 같은 프로젝트에서 두 번 걸렸을 수 있다. 값으로 지우지 말고 **한 자리만** 뺀다.
      const at = this.running.indexOf(projectId)
      if (at !== -1) this.running.splice(at, 1)
    }
  }

  /**
   * 지금 올라온 것이 어느 프로젝트 것인가. 도는 일이 없으면 **null(모름)** 이고,
   * 부르는 쪽이 그때 활성 프로젝트로 되돌아간다 — 확장이 명령 밖에서(활성화 시점·타이머)
   * 결과를 밀 수도 있기 때문이다.
   *
   * ponytail: 서로 다른 프로젝트의 일이 **겹쳐 도는 동안**에도 null 이다 — 어느 쪽이 이것을
   * 냈는지 부모는 알 수 없다. 정확히 가르려면 `setRows` RPC 가 자신을 낸 명령을 달고 와야 하고,
   * 그러려면 자식이 실행 문맥(AsyncLocalStorage)을 들어야 한다 — 확장 호스트 계약 변경이다.
   */
  current(): string | null {
    const distinct = new Set(this.running)
    return distinct.size === 1 ? (this.running[0] ?? null) : null
  }
}
