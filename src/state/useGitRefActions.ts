import { useCallback, useMemo, useState } from 'react'
import type { GitActionResult } from '../../shared/ipc/gitPayloads'
import type { GitRefsHandle } from './useGitRefs'
import type { ToastApi } from './useToasts'

// 브랜치·임시저장 행동 — 확인 대화와 알림, 그리고 **행동 뒤 다시 읽기**.
//
// `useGitActions` 와 같은 결이다: 되돌릴 수 없는 것은 `window.confirm` 으로 한 번 묻고,
// 실패는 **git 이 낸 문구를 그대로** 보인다. 우리가 고쳐 쓰면 사용자가 검색해서 찾을 수
// 없는 문장이 된다 (전환이 작업 중 변경 때문에 막히는 것은 흔한 일이라 특히 그렇다).
//
// 행동마다 `refs.reload()` 를 부른다 — 브랜치·임시저장 목록은 밀려오지 않는다
// (`useGitRefs` 머리말). `GitState` 는 main 이 알아서 밀어 준다.

export interface GitRefActions {
  /** 부르는 중. 같은 행동을 두 번 누르는 것을 막는다 */
  busy: boolean
  onSwitch: (name: string) => void
  onCreate: (name: string) => void
  /** 원격 브랜치를 로컬로 받아 전환 (`origin/feat` 를 **그대로** 넘긴다) */
  onTrack: (name: string) => void
  onMerge: (name: string) => void
  /** 안전한 삭제(`-d`). 병합 안 된 브랜치는 git 이 거절한다 — 그 문구를 그대로 보인다. */
  onDelete: (name: string) => void
  /** 강제 삭제(`-D`). **되돌릴 수 없어** 확인을 받는다. */
  onForceDelete: (name: string) => void
  onStash: (message: string) => void
  onApplyStash: (ref: string) => void
  /** 버리기. **되돌릴 수 없어** 확인을 받는다. */
  onDropStash: (ref: string) => void
}

export function useGitRefActions(
  projectId: string | null,
  refs: GitRefsHandle,
  toasts: ToastApi,
): GitRefActions {
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    (call: (id: string) => Promise<GitActionResult>, done: string, fail: string) => {
      if (projectId === null || busy) return
      setBusy(true)
      void call(projectId).then(async (result) => {
        if (result.ok) toasts.show(done)
        else toasts.show(result.message ?? fail, 'error')
        // 실패해도 다시 읽는다 — 병합 충돌처럼 **반쯤 바뀐 채로 실패하는** 행동이 있다
        await refs.reload()
        setBusy(false)
      })
    },
    [projectId, busy, refs, toasts],
  )

  const onSwitch = useCallback(
    (name: string) =>
      run(
        (id) => window.davis.gitSwitchBranch({ projectId: id, name }),
        `${name} 으로 옮겼습니다`,
        '옮기지 못했습니다',
      ),
    [run],
  )

  const onCreate = useCallback(
    (name: string) =>
      run(
        (id) => window.davis.gitCreateBranch({ projectId: id, name }),
        `${name} 을 만들고 옮겼습니다`,
        '만들지 못했습니다',
      ),
    [run],
  )

  const onTrack = useCallback(
    (name: string) =>
      run(
        // 원격 이름을 그대로 넘긴다 — 앞의 `origin/` 은 main 이 뗀다 (`gitTrackBranch` 주석)
        (id) => window.davis.gitTrackBranch({ projectId: id, name }),
        `${name} 을 로컬로 받았습니다`,
        '받아오지 못했습니다',
      ),
    [run],
  )

  const onMerge = useCallback(
    (name: string) =>
      run(
        (id) => window.davis.gitMergeBranch({ projectId: id, name }),
        `${name} 을 병합했습니다`,
        // 충돌이면 저장소가 충돌 상태로 **남는다.** git 의 안내를 그대로 보여야 다음 수를 안다.
        '병합하지 못했습니다',
      ),
    [run],
  )

  const onDelete = useCallback(
    (name: string) =>
      run(
        (id) => window.davis.gitDeleteBranch({ projectId: id, name }),
        `${name} 을 지웠습니다`,
        '지우지 못했습니다',
      ),
    [run],
  )

  const onForceDelete = useCallback(
    (name: string) => {
      // 🔴 병합 안 된 커밋이 사라진다. 안전 삭제와 채널이 갈려 있는 이유가 이것이다.
      if (!window.confirm(`${name} 을 강제로 지울까요? 병합하지 않은 커밋이 사라지고 되돌릴 수 없습니다.`))
        return
      run(
        (id) => window.davis.gitForceDeleteBranch({ projectId: id, name }),
        `${name} 을 강제로 지웠습니다`,
        '지우지 못했습니다',
      )
    },
    [run],
  )

  const onStash = useCallback(
    (message: string) => {
      if (projectId === null || busy) return
      const before = refs.stashes.length
      setBusy(true)
      void window.davis.gitStashPush({ projectId, message }).then(async (result) => {
        if (!result.ok) {
          toasts.show(result.message ?? '임시저장하지 못했습니다', 'error')
          await refs.reload()
          setBusy(false)
          return
        }
        // ⚠ **담을 게 없어도 ok:true 로 온다** (`gitHistoryBridge.gitStashPush` 주석 — 실측).
        //   결과만 보고 "저장했다" 고 말하면 거짓말이 된다. 새 목록으로 판단한다.
        const next = await refs.reload()
        // 안 생긴 것은 **실패가 아니다** (git 도 exit 0 이다). 붉게 알리지 않되 사실은 말한다.
        toasts.show(next.stashes.length > before ? '임시저장했습니다' : '담아 둘 변경이 없습니다')
        setBusy(false)
      })
    },
    [projectId, busy, refs, toasts],
  )

  const onApplyStash = useCallback(
    (ref: string) =>
      run(
        // 복원해도 목록에 남는다 — 버리는 것은 따로다 (`applyStash` 주석)
        (id) => window.davis.gitApplyStash({ projectId: id, ref }),
        `${ref} 를 되돌려 놓았습니다`,
        '복원하지 못했습니다',
      ),
    [run],
  )

  const onDropStash = useCallback(
    (ref: string) => {
      // 🔴 되돌릴 수 없다 (복원과 채널이 갈려 있는 이유)
      if (!window.confirm(`${ref} 를 버릴까요? 되돌릴 수 없습니다.`)) return
      run((id) => window.davis.gitDropStash({ projectId: id, ref }), `${ref} 를 버렸습니다`, '버리지 못했습니다')
    },
    [run],
  )

  return useMemo(
    () => ({
      busy,
      onSwitch,
      onCreate,
      onTrack,
      onMerge,
      onDelete,
      onForceDelete,
      onStash,
      onApplyStash,
      onDropStash,
    }),
    [
      busy,
      onSwitch,
      onCreate,
      onTrack,
      onMerge,
      onDelete,
      onForceDelete,
      onStash,
      onApplyStash,
      onDropStash,
    ],
  )
}
