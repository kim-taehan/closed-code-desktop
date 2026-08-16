import { useEffect, useRef, useState } from 'react'
import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from '../state/projectStatus'
import { diagnoseIssues, stepIssues, type DoctorFix } from '../state/connectionDoctor'
import type { PipelineState, ServerOwnership } from '../state/doctorPipeline'
import { driveDoctor } from '../state/doctorDriver'
import { ConnectionFixForm } from './ConnectionFixForm'
import { DoctorSteps, IssueList, mergeIssues } from './DoctorSteps'

// 연결 진단·복구(Doctor) — 오토힐링 파이프라인을 **화면에서** 구동하는 자리.
//
// 열면 곧바로 순차 진단(opencode 서버 ping → 모델 조회 → 연결 상태)을 돌리고, 문제가 있으면
// 사다리를 탄다: 재연결 → 서버 되살리기 → 재연결 (설계 2026-08-16 §1).
// **부작용을 부르는 코드는 여기 없다** — `state/doctorDriver.ts` 로 뗐다. 자가 복구
// (`useAutoHeal`)가 팝업이 안 열린 상태에서도 같은 사다리를 타야 했기 때문이다.
// *"여기서 부르는 조치는 재연결 하나뿐이다"* 라고 적혀 있던 자리이고, 같은 주석이
// *"서버를 접었다 다시 띄우는 길은 생겼지만 판정을 doctorPipeline 이 못 낸다"* 고
// 예고해 뒀다 — 그 판정이 생겨서(`ServerStatusPayload.ours`) 사다리가 붙었다.
//
// 화면은 좌우 두 열이다: **왼쪽 = 이 프로젝트의 연결, 오른쪽 = 앱이 확인한 것(자가 진단)**.
// 왼쪽이 한때 "내가 바꾸는 것" 이었다 — 서버 주소를 사용자가 넣던 시절이다.
// 진행 로그는 없앴다 — 단계 목록이 같은 내용을 더 읽기 쉽게 보여주는데다,
// 팝업을 열기만 해도(자동 진단) 누른 적 없는 로그가 쌓여 있는 것처럼 보였다.

export interface ConnectionDoctorProps {
  status: ProjectStatus
  failure?: string
  /**
   * 왼쪽 열(연결)을 보일지. **프로젝트가 열려 있을 때만** 보인다 — 서버가 프로젝트마다
   * 하나라 열린 프로젝트가 없으면 보여 줄 주소도, 다시 붙을 곳도 없다.
   *
   * 예전에는 여기로 설정과 저장 함수가 왔다 (`{ settings, onSaveSettings }`). 그 열이
   * 주소를 **고치는** 곳이었기 때문인데, 고칠 주소가 없어졌다 (`ConnectionFixForm` 머리말).
   */
  fix?: boolean
  /**
   * **이미 다 돌고 실패한 사다리.** 자가 복구가 최종 실패해 이 창이 저절로 열린 경우다
   * (설계 §3 의 2단 승격 마지막 칸).
   *
   * 주면 **처음에 다시 돌지 않는다.** 여기서 또 돌면 서버 재시작이 한 번 더 나가고,
   * 그것이 곧 설계가 막으려는 **재시작 루프**다 (§2 「자동으로 한 번만」).
   * 다시 타는 것은 사용자가 「연결 시도」·「다시 진단」을 누를 때뿐이다.
   */
  initial?: PipelineState
  /**
   * 진단이 초록(healthy/healed)으로 끝났다 — **자동 게이트가 스스로 닫는 신호**다
   * (`src/state/useDoctorGate.ts`). 배지를 눌러 연 팝업은 이걸로 안 닫힌다 — 그쪽은
   * `App` 이 `testingOpen` 을 쥐고 있다.
   *
   * 이 주석은 오랫동안 *"최초 등록 게이트의 자동 닫힘용"* 이라고 **없는 주인을 가리키고
   * 있었다.** D3 에서 게이트가 생겨 사실이 됐다.
   */
  onHealthy?: () => void
}

/** 수동 「고치기」 버튼이 부르는 것. 사다리가 자동으로 부르는 것과 **같은 조치**다. */
const RUN: Record<DoctorFix, () => Promise<unknown>> = {
  reconnect: () => window.davis.reconnectProject(),
  // **주인이 누구든 `restart` 다.** 남의 프로세스에는 닿지 않는다 — main 의 `closeProject`
  // 가 접는 것은 우리 세션과 우리 표의 서버뿐이다 (`state/doctorDriver.ts` 의 같은 근거).
  'restart-server': () => window.davis.controlServer({ action: 'restart' }),
}

export function ConnectionDoctor({ status, failure, fix, initial, onHealthy }: ConnectionDoctorProps) {
  const [pipeline, setPipeline] = useState<PipelineState | null>(initial ?? null)
  const [lastDiag, setLastDiag] = useState<DiagnosticsPayload | null>(null)
  /** 올리면 파이프라인이 처음부터 다시 돈다 ("다시 진단"·수동 조치 뒤) */
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<DoctorFix | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** 이슈 목록의 버튼이 「다시 시작」이냐 「갈아타기」냐 — main 이 낸 판정을 그대로 쓴다 */
  const [ownership, setOwnership] = useState<ServerOwnership>('theirs')
  /** 사용자가 "중지" 를 눌렀다 — 재시작·재연결이 오래 걸릴 때 손을 뗄 수 있어야 한다 */
  const [halted, setHalted] = useState(false)
  const haltRef = useRef(false)
  // 파이프라인이 도는 동안 세션 상태가 바뀐다 — 항상 최신 prop 을 읽는다
  const statusRef = useRef(status)
  statusRef.current = status
  const onHealthyRef = useRef(onHealthy)
  onHealthyRef.current = onHealthy
  /** 첫 회전을 건너뛸지 — 이미 돈 사다리를 받았으면 그것을 그리기만 한다 */
  const preRun = useRef(initial !== undefined)

  useEffect(() => {
    if (preRun.current) {
      preRun.current = false
      return
    }
    let stopped = false
    // 새 회전은 언제나 처음부터 — 앞 회전에서 눌린 중지를 물려받지 않는다
    haltRef.current = false
    setHalted(false)

    void (async () => {
      const state = await driveDoctor({
        getStatus: () => statusRef.current,
        onState: (next) => {
          if (!stopped) setPipeline(next)
        },
        onDiag: (diag) => {
          if (!stopped) setLastDiag(diag)
        },
        // 이슈 목록의 안내를 고르려면 서버가 우리 것인지가 필요하다. **사다리가 조치를
        // 고를 때 본 그 값**을 그대로 받는다 — 따로 물으면 판정이 두 벌이 된다.
        onOwnership: (next) => {
          if (!stopped) setOwnership(next)
        },
        shouldStop: () => stopped || haltRef.current,
      })
      if (stopped) return
      // 초록으로 끝났다 — 최초 등록 게이트가 이 신호로 자동 닫힘한다
      if (!haltRef.current && (state.verdict === 'healthy' || state.verdict === 'healed')) {
        onHealthyRef.current?.()
      }
    })()

    return () => {
      stopped = true
    }
    // round 가 바뀔 때만 다시 돈다 — status 변화마다 재진단하면 무한히 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  /** 수동 재시도 (사다리가 못 고친 뒤). 조치가 끝나면 파이프라인을 다시 돌린다. */
  async function apply(pick: DoctorFix) {
    setBusy(pick)
    setNote(null)
    try {
      await RUN[pick]()
      setRound((value) => value + 1)
    } finally {
      setBusy(null)
    }
  }

  // 중지를 누르면 남은 단계가 있어도 도는 것으로 치지 않는다 (버튼이 "연결 시도" 로 돌아온다)
  const running = !halted && (pipeline === null || pipeline.next !== null)
  const verdict = pipeline?.verdict ?? null
  // 런타임의 시각(diagnoseIssues) + 파이프라인 자체 판정(직접 ping·라이선스)을 합친다
  const issues =
    verdict === 'manual' && pipeline
      ? mergeIssues(
          diagnoseIssues(status, lastDiag, failure, ownership),
          stepIssues(pipeline, ownership),
        )
      : []

  return (
    <div className={`dc-doctor${fix ? '' : ' dc-doctor--single'}`}>
      {/* 왼쪽 — 이 프로젝트의 연결. **처음부터 항상 보인다** — 무엇에 붙어 있는지와
          다시 붙는 손잡이는 진단 결과를 기다릴 이유가 없다. */}
      {fix && (
        <section className="dc-doctor__col">
          <h3 className="dc-doctor__coltitle">연결</h3>
          <p className="dc-doctor__note">연결 시도를 누르면 재연결·재진단까지 한 번에 됩니다.</p>
          <ConnectionFixForm
            endpoint={lastDiag?.endpoint ?? null}
            running={running}
            onApply={() => {
              setNote(null)
              setRound((value) => value + 1)
            }}
          />
        </section>
      )}

      {/* 오른쪽 — 앱이 확인한 것 */}
      <section className="dc-doctor__col dc-doctor__col--diag">
        <h3 className="dc-doctor__coltitle">
          자가 진단
          {running && (
            <>
              <span className="dc-doctor__working">
                <span className="dc-spinner" aria-hidden="true" />
                확인 중…
              </span>
              {/* 재시작·재연결 재확인은 최대 15초씩 걸린다 — 손을 뗄 수 있어야 한다 */}
              <button
                type="button"
                className="dc-doctor__halt"
                onClick={() => {
                  haltRef.current = true
                  setHalted(true)
                  setNote('진단을 중지했습니다.')
                }}
              >
                중지
              </button>
            </>
          )}
        </h3>

        <DoctorSteps steps={pipeline?.steps ?? []} />

        {verdict === 'healthy' && (
          <p className="dc-doctor__empty">고칠 문제를 찾지 못했습니다 — 연결이 정상입니다.</p>
        )}
        {verdict === 'healed' && (
          <p className="dc-doctor__empty">자동 복구로 연결이 살아났습니다.</p>
        )}

        {verdict === 'manual' &&
          (issues.length > 0 ? (
            <IssueList issues={issues} busy={busy} onFix={apply} />
          ) : (
            // 런타임·세션은 멀쩡한데 위 단계(Admin·라이선스)가 실패한 경우
            <p className="dc-doctor__empty">자동으로 고치지 못했습니다. 실패한 단계의 안내를 확인하세요.</p>
          ))}

        {note && <p className="dc-doctor__note">{note}</p>}

        {/* 수정 폼이 없을 때(프로젝트 없이 연 진단)만 남는 재실행 버튼 —
            폼이 있으면 "연결 시도" 하나가 저장·재연결·재진단을 다 한다 */}
        {!fix && !running && (
          <button
            type="button"
            className="dc-doctor__again"
            disabled={busy !== null}
            onClick={() => setRound((value) => value + 1)}
          >
            다시 진단
          </button>
        )}
      </section>
    </div>
  )
}
