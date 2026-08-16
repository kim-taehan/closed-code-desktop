import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunEntry } from '../../shared/run/runList'
import { fixLine, prescribe, runHealNotice, type Prescription, type RunHealNotice, type RunHealPhase } from './runHeal'

// 오토힐링의 **실행 규칙** — 언제 시작하나 · 몇 번 도나 · 못 고치면 뭘 하나 (설계 2026-08-16 §4).
//
// 무엇을 아는지(`prescribe`)와 무엇을 말하는지(`runHealNotice`)는 `runHeal.ts` 다.
// 여기 있는 것은 **시간에 대한 판단**뿐이고, 가른 이유는 `useAutoHeal` 과 같다.
//
// ```
// 로그에서 알아챈다 → 예고한다 → (5초) → 한 번 고친다 → 같은 실패가 또 나면 멈추고 설명
// ```
//
// ## 예고와 조치 사이에 **틈을 둔다**
//
// 무거운 조치가 일어난 **뒤에** 알리면 사용자는 통보만 받고 멈출 기회를 못 가진다
// (Doctor 설계 §3). 그래서 예고를 먼저 그리고, `GRACE_MS` 만큼 기다린 뒤에 손을 댄다 —
// 그 몇 초가 「지금은 그만」을 누를 시간이다. Doctor 에는 그 손잡이가 없었지만 여기서는
// 조치가 **사용자 프로젝트를 고치는 일**(설치)이라 무게가 다르다.
//
// ## 자동은 한 바퀴만 — 그 근거를 화면과 **다른 그릇**에 담는다
//
// `usedRef` 는 ref 다. 화면(`heal`)이 비워져도 남는다.
//
// ⚠️ Doctor 에서 값을 치른 함정이 정확히 여기다: **재측정이 자기가 서 있던 조건을 지웠다.**
// 상한의 근거를 `heal?.phase` 같은 화면 값에 두면, 회전이 끝나며 화면을 비우는 순간 상한도
// 함께 풀려 같은 실패에 또 설치가 나간다 — **그것이 설치 루프고, 그 사이 사용자 프로젝트가
// 계속 흔들린다.** 증상이 조용한 것이 이 부류의 값이다: 타이머 한 창만 보는 시험은 못 잡고,
// `useRunHeal.test.tsx` 가 가짜 타이머로 길게 돌려 잠근다 (설계 §6 마지막 줄).
//
// ## 왜 칸을 접었다 다시 띄우지 않고 **그 칸에 명령을 쳐 넣나**
//
// 조치는 `sendShellInput` 한 번이다 — 칸의 셸에 `설치 && 원래명령` 을 한 줄 넣는다.
// 성립하는 근거가 **실측**이다: 의존성이 없으면 프로세스가 **곧바로 죽는다**(exit 1,
// Node v22.18.0 · `npm run dev` 재현 2026-08-16). 죽으면 그 칸의 셸은 프롬프트로 돌아와
// 있으므로 우리가 넣은 줄은 **셸이 받는다** — 살아 있는 프로세스의 stdin 으로 새지 않는다.
//
// 접었다 다시 띄우는 길(`closeShellPane` → `runShellPane`)은 프롬프트가 확실하다는 장점이
// 있지만 **붙들고 있던 로그가 통째로 날아간다** — 그 보유가 이 기능의 무게중심이다
// (설계 §0). 그래서 이 거래를 택했다. 처방이 「곧바로 죽지 않는」 실패로 늘어나면 이 근거가
// 무너지므로, 그때 여기를 다시 읽어야 한다.
//
// ## 남의 것은 안 건드린다
//
// 손을 대는 칸은 **실행 목록에 이름이 있는 것뿐**이다 (`entries` 대조). 사용자가 손으로 연
// 셸 칸은 이름이 목록에 없어 걸리지 않는다 — 거기에 명령을 밀어 넣으면 쳐 두던 글자와 섞인다.
// `pidStore`·`ptyPool` 이 "우리가 만든 것만 만진다" 로 서 있는 것과 같은 규칙의 렌더러 쪽이다.

/** 예고와 조치 사이. 내보내는 이유는 시험 때문이다 (`RECHECK_MS` 와 같은 규칙) */
export const GRACE_MS = 5_000
/**
 * 고친 뒤 **같은 실패가 다시 나는지** 보는 창. 지나면 화면을 내린다.
 *
 * 조용하다고 성공한 것은 아니다 — **성공을 잴 방법이 없다.** 개발 서버는 안 끝나므로
 * 종료 코드가 안 오고, 로그에서 「떴다」를 알아보는 규칙은 프레임워크마다 다르다
 * (설계 §7 미결 1). 그래서 없는 성공을 주장하지 않고 **말을 멈출 뿐**이다.
 */
export const WATCH_MS = 60_000
/** 칸마다 들고 있는 최근 출력. 덩어리가 줄 가운데서 끊겨도 이어 붙으면 걸린다 */
const TAIL_CHARS = 4_000

/** 도는 한 바퀴. **어느 프로젝트의 것인지 함께 쥔다** (아래 조치 시점의 대조) */
interface Heal {
  projectId: string
  pane: string
  command: string
  rx: Prescription
  phase: RunHealPhase
}

export interface RunHeal {
  /** 지금 화면에 낼 말. 없으면 null */
  notice: RunHealNotice | null
  /**
   * 「지금은 그만」·「닫기」. **자동 자격도 함께 쓴다** — 물린 조치를 다음 줄이 도착하는
   * 순간 또 예고하면 그건 물린 것이 아니다.
   */
  dismiss: () => void
}

/**
 * 실행 목록의 칸이 **아는 실패**를 뱉으면 한 번 고친다.
 *
 * `entries` 를 받는 이유가 둘이다: 어느 칸이 우리 것인지 가르고, 처방을 그 칸의 **원래
 * 명령**에서 뽑는다 (`packageManagerOf`).
 */
export function useRunHeal(projectId: string, entries: readonly RunEntry[]): RunHeal {
  const [heal, setHeal] = useState<Heal | null>(null)

  /**
   * 이번 프로젝트에서 자동 자격을 이미 쓴 칸. **1회 상한의 실체다** (머리말).
   * 화면과 다른 그릇이라 화면이 비워져도 남는다.
   */
  const usedRef = useRef<Set<string>>(new Set())
  /** 칸별 최근 출력 */
  const tailRef = useRef<Map<string, string>>(new Map())
  // 구독은 한 번만 걸고(재구독하면 그 사이 출력을 놓친다) 최신 값은 ref 로 본다
  const healRef = useRef<Heal | null>(heal)
  healRef.current = heal
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  // 프로젝트를 옮기면 앞 프로젝트의 회전은 없던 일이다 — 화면도 자격도 새로 시작한다.
  // (칸 이름은 프로젝트마다 겹칠 수 있어 표를 통째로 비운다.)
  useEffect(() => {
    usedRef.current.clear()
    tailRef.current.clear()
    setHeal(null)
  }, [projectId])

  useEffect(
    () =>
      window.davis.onShellData((payload, from) => {
        // 드로어 출력은 **활성 프로젝트의 것만** 오지만, 겉봉이 씌워져 있으니 대조한다
        if (from !== projectRef.current) return
        const tail = `${tailRef.current.get(payload.name) ?? ''}${payload.chunk}`.slice(-TAIL_CHARS)
        tailRef.current.set(payload.name, tail)

        const current = healRef.current
        if (current !== null) {
          // **고치는 중에 같은 실패가 또 났다 — 막혔다.** 여기가 설계 §4 의 "못 고치면
          // 멈추고 설명" 이다. 한 바퀴가 상한이라 두 번째 조치는 없다.
          if (
            current.phase === 'healing' &&
            current.pane === payload.name &&
            prescribe(tail, current.command) !== null
          ) {
            setHeal({ ...current, phase: 'stuck' })
          }
          // 한 번에 한 바퀴만 돈다. 두 칸이 동시에 깨지면 앞엣것을 끝낸 뒤에 뒤엣것을 본다
          // — 조치가 겹치면 같은 폴더에서 설치가 둘 도는 일이 생긴다.
          return
        }

        if (usedRef.current.has(payload.name)) return
        // **우리가 띄운 칸만** (머리말). 사용자의 셸 칸은 여기서 걸러진다.
        const entry = entriesRef.current.find((item) => item.name === payload.name)
        if (entry === undefined) return
        const rx = prescribe(tail, entry.command)
        if (rx === null) return
        setHeal({ projectId: from, pane: entry.name, command: entry.command, rx, phase: 'announce' })
      }),
    [],
  )

  // 예고를 그린 **뒤에** 손을 댄다 (머리말). 이 effect 가 곧 그 틈이다.
  useEffect(() => {
    if (heal === null || heal.phase !== 'announce') return
    const timer = setTimeout(() => {
      // ⚠️ 그 사이 프로젝트를 옮겼으면 아무것도 안 한다. `sendShellInput` 은 main 에서
      // **활성 프로젝트**로 풀리므로(`drawerBridge.write`), 옮긴 뒤에 쓰면 같은 이름을 가진
      // **남의 칸**에 명령이 들어간다.
      //
      // **여기는 2겹 방어의 뒷겹이고, 앞겹이 이미 잠겨 있어 따로 못 잰다.** 위 정리 effect 가
      // 프로젝트가 바뀌는 렌더에서 `heal` 을 비워 이 타이머를 먼저 걷어낸다 — 이 줄을 지워도
      // 시험이 전부 초록이다(실측 2026-08-16). `useAutoHeal` 의 `stopped` 와 같은 모양이라
      // 같은 답을 쓴다: **정직한 미검증으로 남긴다.** 등가는 「effect 정리가 타이머보다 먼저
      // 돈다」가 참일 때만 성립하고, 그 순서는 React 가 주는 것이지 우리가 쥔 것이 아니다.
      if (projectRef.current !== heal.projectId) return
      // **자격은 여기서 쓴다** — 예고만 하고 물린 회전은 상한을 안 쓴다 (그건 `dismiss` 몫).
      usedRef.current.add(heal.pane)
      // 방금 걸린 줄이 창에 남아 있으면 다음 덩어리에서 또 걸린다. 조치와 함께 비운다.
      tailRef.current.set(heal.pane, '')
      window.davis.sendShellInput({ name: heal.pane, data: `${fixLine(heal.rx, heal.command)}\n` })
      setHeal({ ...heal, phase: 'healing' })
    }, GRACE_MS)
    return () => clearTimeout(timer)
  }, [heal])

  // 고친 뒤 조용하면 말을 멈춘다. **자격은 안 돌려준다** (`usedRef` 는 그대로다).
  useEffect(() => {
    if (heal === null || heal.phase !== 'healing') return
    const timer = setTimeout(() => setHeal(null), WATCH_MS)
    return () => clearTimeout(timer)
  }, [heal])

  const dismiss = useCallback(() => {
    const current = healRef.current
    if (current === null) return
    usedRef.current.add(current.pane)
    setHeal(null)
  }, [])

  return {
    notice: heal === null ? null : runHealNotice(heal.pane, heal.command, heal.rx, heal.phase, GRACE_MS),
    dismiss,
  }
}
