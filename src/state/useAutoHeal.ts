import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectStatus } from './projectStatus'
import { sessionUp } from './connectionDoctor'
import { driveDoctor } from './doctorDriver'
import { healNotice, type HealNotice } from './healNotice'
import type { PipelineState } from './doctorPipeline'

// 자가 복구의 **실행 규칙** — 언제 시작하나 · 몇 번 도나 · 실패한 뒤엔 뭘 하나.
//
// 사다리 자체는 `doctorDriver` 가 몰고, 무엇을 말할지는 `healNotice` 가 정한다.
// 여기 있는 것은 **시간에 대한 판단**뿐이다 (설계 2026-08-16 §2).
//
// ## 한 바퀴가 상한이다
//
// 사다리는 **자동으로 한 번만** 돈다. 실패하면 주기 재측정으로 넘어간 뒤 **자동으로 다시
// 타지 않는다.** 서버 재시작은 무거운 조치라, 실패하는 조건이 그대로인데 자동으로 반복하면
// **재시작 루프**가 되고 그 사이 사용자의 다른 창·로그가 계속 흔들린다.
// 다시 타는 것은 사용자가 「고치기」를 누를 때(`retry`)뿐이다.
//
// ## 주기 재측정 — 치유 없이 진단만
//
// 멈춘 뒤 30초마다 **진단만** 다시 잰다 (`healing: false`). 사내망이 붙거나 서버가
// 살아나는 순간 스스로 초록이 되고, **그때 자동 사다리 자격도 회복된다** — 사용자가
// VPN 을 켜고 버튼을 다시 누를 필요가 없다.
//
// ## 왜 렌더러가 구동하나
//
// 보이는 자리(상태줄·배너)가 전부 **지금 보고 있는 프로젝트**의 것이라 백그라운드 복구는
// 아직 값을 못 한다. 필요해지는 신호는 분명하다 — *"탭을 옮겨 뒀더니 복구가 안 돌아
// 있더라"* 가 나오면 그때 구동자만 main 으로 옮긴다 (설계 §4). 판정(`healNotice`·
// `doctorPipeline`)을 순수하게 둔 이유가 그 이동을 싸게 만들기 위해서다.

/** 주기 재측정 간격 (설계 §2) */
export const RECHECK_MS = 30_000

export interface AutoHeal {
  /** 지금 화면에 낼 말. 없으면 null (아직 안 돌았거나, 잘 끝났다) */
  notice: HealNotice | null
  /** 사다리가 최종 실패했다 — 창을 열 자격이다 */
  failed: boolean
  /** 최종 실패한 사다리. 창이 **다시 돌리지 않고** 이것을 그린다 */
  result: PipelineState | null
}

// **`retry()` 를 두지 않는다.** 설계 §2 의 *"사용자가 「고치기」를 누르면 다시 탄다"* 는
// 자리는 이미 있다 — 최종 실패에서 저절로 열리는 Doctor 창의 「연결 시도」·「다시 진단」이
// 그것이고, 그쪽은 자기 드라이버로 같은 사다리를 처음부터 태운다. 여기에 손잡이를 하나 더
// 내면 **같은 조치를 부르는 문이 둘**이 되고, 둘이 동시에 눌릴 수 있다.

export interface AutoHealOptions {
  /**
   * 거짓이면 새 회전을 **시작하지 않는다.** Doctor 창이 열려 있을 때가 그 경우다 —
   * 그 창도 같은 사다리를 몰기 때문에, 둘이 동시에 돌면 재연결과 서버 재시작이 겹친다.
   */
  enabled?: boolean
}

/**
 * 지금 보고 있는 프로젝트의 세션이 깨지면 사다리를 태운다.
 *
 * **`connecting` 은 건드리지 않는다** — 진행 중인 것을 끊고 다시 시작하는 꼴이 된다.
 * 시작 조건은 `disconnected`·`error` 둘뿐이다 (설계 §2).
 */
export function useAutoHeal(
  projectId: string | undefined,
  status: ProjectStatus | undefined,
  options: AutoHealOptions = {},
): AutoHeal {
  const enabled = options.enabled ?? true
  /**
   * 도는 사다리와 **그 주인**을 함께 쥔다.
   *
   * 상태만 쥐면 프로젝트를 바꾼 그 렌더에서 앞 프로젝트의 판정이 한 번 새 나간다 —
   * 비우는 것은 effect 이고 읽는 쪽(`useDoctorGate`)도 effect 라, **누가 먼저냐**에
   * 결과가 걸린다. 주인을 같이 들고 그리는 순간에 걸러 그 창을 없앤다.
   */
  const [run$, setRun] = useState<{ id: string | undefined; state: PipelineState } | null>(null)
  const pipeline = run$ !== null && run$.id === projectId ? run$.state : null
  /** 이번 프로젝트에서 자동 사다리를 이미 태웠나. **1회 상한의 실체다** */
  const usedRef = useRef(false)
  /** 지금 도는 중인가 — 겹쳐 돌면 재연결이 두 번 나간다 */
  const runningRef = useRef(false)
  const statusRef = useRef(status)
  statusRef.current = status
  /**
   * 지금 사다리가 **누구 것인가.** 프로젝트를 바꾸거나 화면이 사라지면 올린다.
   *
   * 이게 없으면 닫은 프로젝트의 사다리가 계속 돌아 **그 프로젝트의 서버를 다시 띄운다** —
   * 도중에 세는 자리가 없어서 조용하다. `driveDoctor` 는 한 칸이 끝날 때마다
   * `shouldStop()` 을 묻고, 그 물음이 여기로 온다.
   */
  const genRef = useRef(0)
  /** 지금 사다리를 태우는 프로젝트. `run` 이 클로저로 잡으면 옛 값에 묶인다 */
  const ownerRef = useRef(projectId)
  ownerRef.current = projectId

  // 프로젝트를 바꾸면 앞 프로젝트의 사다리는 없던 일이다 — 화면도 자격도 새로 시작한다
  useEffect(() => {
    genRef.current += 1
    usedRef.current = false
    runningRef.current = false
    setRun(null)
  }, [projectId])

  // 화면이 사라지면 도는 사다리도 거둔다 (창을 닫는 길에서 서버가 다시 뜨면 안 된다)
  useEffect(() => () => {
    genRef.current += 1
  }, [])

  const run = useCallback((healing: boolean) => {
    if (runningRef.current) return
    runningRef.current = true
    const gen = genRef.current
    const owner = ownerRef.current
    void (async () => {
      try {
        const state = await driveDoctor({
          getStatus: () => statusRef.current ?? 'idle',
          onState: (next) => {
            if (gen === genRef.current) setRun({ id: owner, state: next })
          },
          shouldStop: () => gen !== genRef.current,
          healing,
        })
        if (gen !== genRef.current) return
        // 초록이면 **자격이 돌아온다.** 다음에 또 깨지면 다시 한 바퀴 탈 수 있다.
        if (state.verdict === 'healthy' || state.verdict === 'healed') usedRef.current = false
      } finally {
        runningRef.current = false
      }
    })()
  }, [])

  useEffect(() => {
    if (!enabled || projectId === undefined) return
    // **살아났다 — 자격이 돌아온다.** 사다리가 고쳤든, 사용자가 창에서 고쳤든, 서버가
    // 저절로 살아났든 상관없다. 이게 없으면 다음에 또 깨져도 30초 재측정을 기다려야 한다.
    if (sessionUp(status ?? 'idle')) {
      usedRef.current = false
      return
    }
    if (status !== 'disconnected' && status !== 'error') return
    if (usedRef.current) return
    usedRef.current = true
    run(true)
  }, [enabled, projectId, status, run])

  // 한 바퀴가 끝나 멈춘 뒤에만 주기 재측정이 돈다. **치유는 안 한다.**
  const stopped = pipeline?.verdict === 'manual'
  useEffect(() => {
    if (!enabled || !stopped) return
    const timer = setInterval(() => {
      // 그 사이 저절로 살아났으면 잴 것도 없다 — 자격만 돌려주고 화면을 비운다
      if (sessionUp(statusRef.current ?? 'idle')) {
        usedRef.current = false
        setRun(null)
        return
      }
      run(false)
    }, RECHECK_MS)
    return () => clearInterval(timer)
  }, [enabled, stopped, run])

  return {
    notice: healNotice(pipeline),
    failed: pipeline?.verdict === 'manual',
    result: pipeline?.verdict === 'manual' ? pipeline : null,
  }
}
