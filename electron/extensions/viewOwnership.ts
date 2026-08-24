// 확장 화면(행·HTML·트리)의 **프로젝트 격리** — 다시그리기(redraw)가 남의 화면을 나르지 않게.
//
// 확장 호스트는 앱에 하나고, 저장된 화면에는 프로젝트 차원이 없다. 그런데 프로젝트를
// 옮길 때마다 화면 쪽이 redraw 를 청하고(`useExtensionPanel`), 그때 올라온 emit 은
// 겉봉이 **지금 활성 프로젝트**로 찍힌다 (`extensionBridge` 가 활성 id 를 걸고,
// `ProjectEnvelope` 은 건 값을 그대로 굳힌다 — 그 규칙 자체는 옳다). 그래서 A 에서 그린
// 테스트 시나리오 화면이 B 로 전환하는 순간 B 의 것으로 둔갑해 다시 밀려왔다 (2026-08-24 실측).
//
// 규칙은 둘뿐이다:
//   1. **redraw 밖**의 emit(명령·활성화·타이머)이 그 뷰의 주인을 기록한다 — 겉봉 그대로.
//   2. **redraw 중**의 emit 은 기록된 주인이 다른 프로젝트면 버린다. 주인을 모르면
//      (한 번도 실제 작업으로 안 그려졌으면) 흘려보낸다 — 활성화 시점에 초기 화면을
//      그리는 확장을 redraw 가 대신 불러 주는 경우가 있다.
//
// redraw 중에는 주인을 **기록하지 않는다** — redraw 는 저장된 것을 다시 낼 뿐이라
// 소유를 옮길 근거가 아니고, 기록하면 전환 두 번에 주인이 따라와 격리가 도로 풀린다.

type Emit<T> = (viewId: string, value: T, projectId: string | null) => void

interface ViewBindings {
  projectId: () => string | null
  emitRows: Emit<unknown[]>
  emitHtml: Emit<string>
  emitTree: Emit<unknown[]>
  [key: string]: unknown
}

export class ViewOwnership {
  /** 뷰가 마지막으로 실제 작업으로 그려진 프로젝트. null 은 「겉봉 없이 그려짐」이라 막지 않는다. */
  private readonly owners = new Map<string, string | null>()
  /** 도는 redraw 수. 프로젝트를 빠르게 오가면 겹칠 수 있어 불리언이 아니라 수다. */
  private redrawing = 0

  /** redraw 한 번을 감싼다. 던져도 표식은 걷힌다. */
  async duringRedraw<T>(work: () => Promise<T>): Promise<T> {
    this.redrawing += 1
    try {
      return await work()
    } finally {
      this.redrawing -= 1
    }
  }

  /**
   * 이 emit 을 흘려보낼 것인가. 위 규칙 1·2 그대로다.
   *
   * `projectId === null`(겹쳐 돌아 모름)이면 redraw 중이어도 버리지 않는다 —
   * redraw 와 실제 명령이 겹친 경우고, 남의 화면이라는 증거가 없는데 버리면
   * 진짜 결과가 사라진다. 격리보다 유실이 비싸다.
   */
  allow(viewId: string, projectId: string | null): boolean {
    if (this.redrawing === 0) {
      this.owners.set(viewId, projectId)
      return true
    }
    const owner = this.owners.get(viewId)
    return !(typeof owner === 'string' && projectId !== null && owner !== projectId)
  }

  /** 뷰 emit 셋(행·HTML·트리)에 위 규칙을 씌운 같은 모양의 배선을 돌려준다. */
  guard<B extends ViewBindings>(bindings: B): B {
    const wrap = <T>(emit: Emit<T>): Emit<T> => {
      return (viewId, value, projectId) => {
        if (this.allow(viewId, projectId)) emit(viewId, value, projectId)
      }
    }
    return {
      ...bindings,
      emitRows: wrap(bindings.emitRows),
      emitHtml: wrap(bindings.emitHtml),
      emitTree: wrap(bindings.emitTree),
    }
  }

  /** 자식을 갈아 끼우면(restart) 저장된 화면이 죽으므로 주인 기록도 함께 버린다. */
  clear(): void {
    this.owners.clear()
  }
}
