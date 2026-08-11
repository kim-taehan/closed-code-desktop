import { useEffect, useRef, useState } from 'react'
import type { DiagnosticsPayload } from '../../shared/ipc/channels'
import type { ProjectStatus } from '../state/projectStatus'
import { diagnoseIssues, sessionUp, stepIssues, type DoctorFix } from '../state/connectionDoctor'
import {
  advance,
  initPipeline,
  type CheckOutcome,
  type DoctorCommand,
  type PipelineState,
} from '../state/doctorPipeline'
import { awaitHealthy, probeModels, probeRuntime, probeServer } from '../state/connectionProbe'
import { ConnectionFixForm } from './ConnectionFixForm'
import { DoctorSteps, IssueList, mergeIssues } from './DoctorSteps'
import type { AppSettings } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// 연결 진단·복구(Doctor) — 오토힐링 파이프라인의 드라이버.
//
// 열면 곧바로 순차 진단(opencode 서버 ping → 모델 조회 → 연결 상태)을 돌리고,
// 세션만 문제면 재연결로 자동 치유를 시도한다. **재시작·재설치는 없다** —
// opencode 서버는 사용자가 띄운 남의 프로세스라 우리가 죽였다 살릴 수 없다.
// 전이 판단은 전부 doctorPipeline(순수 머신)이 하고, 여기는 부작용 실행과 그리기만 한다.
// 자동으로 못 고친 것(주소·키 문제)은 **이 자리에서** 수정 폼(ConnectionFixForm)으로 고친다 —
// 설정 창으로 보내면 왕복이 생기고, 어떤 상태에서든 연결까지 가는 길이 끊기면 안 된다.
//
// 화면은 좌우 두 열이다: **왼쪽 = 내가 바꾸는 것(연결 설정), 오른쪽 = 앱이 확인한 것(자가 진단)**.
// 진행 로그는 없앴다 — 단계 목록이 같은 내용을 더 읽기 쉽게 보여주는데다,
// 팝업을 열기만 해도(자동 진단) 누른 적 없는 로그가 쌓여 있는 것처럼 보였다.

export interface ConnectionDoctorProps {
  status: ProjectStatus
  failure?: string
  /** 인라인 수정 폼 재료 (프로젝트·설정·저장). 없으면 폼 없이 안내만 한다. */
  fix?: {
    project: ProjectRecord
    settings: AppSettings
    onSaveSettings: (settings: AppSettings) => Promise<void>
  }
  /** 진단이 초록(healthy/healed)으로 끝났다 — 최초 등록 게이트의 자동 닫힘용 */
  onHealthy?: () => void
}

const RUN: Record<DoctorFix, () => Promise<unknown>> = {
  reconnect: () => window.davis.reconnectProject(),
}

/** 재연결 재확인 (1초 × N). 떠 있는 서버에 붙는 것뿐이라 길게 기다릴 이유가 없다. */
const RECONNECT_TRIES = 3

export function ConnectionDoctor({ status, failure, fix, onHealthy }: ConnectionDoctorProps) {
  const [pipeline, setPipeline] = useState<PipelineState | null>(null)
  const [lastDiag, setLastDiag] = useState<DiagnosticsPayload | null>(null)
  /** 올리면 파이프라인이 처음부터 다시 돈다 ("다시 진단"·수동 조치 뒤) */
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<DoctorFix | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** 사용자가 "중지" 를 눌렀다 — 재시작·재연결이 오래 걸릴 때 손을 뗄 수 있어야 한다 */
  const [halted, setHalted] = useState(false)
  const haltRef = useRef(false)
  // 파이프라인이 도는 동안 세션 상태가 바뀐다 — 항상 최신 prop 을 읽는다
  const statusRef = useRef(status)
  statusRef.current = status
  const onHealthyRef = useRef(onHealthy)
  onHealthyRef.current = onHealthy

  useEffect(() => {
    let stopped = false
    // 새 회전은 언제나 처음부터 — 앞 회전에서 눌린 중지를 물려받지 않는다
    haltRef.current = false
    setHalted(false)

    async function pingRuntime(): Promise<CheckOutcome> {
      const { outcome, diag } = await probeRuntime()
      if (!stopped) setLastDiag(diag)
      // 이 단계는 "지금 연결됐나" 를 답한다 — 런타임 ping 에 세션 상태를 붙여 보여준다
      if (!outcome.ok) return outcome
      return {
        ...outcome,
        detail: `${outcome.detail} · 세션 ${sessionUp(statusRef.current) ? '연결됨' : '끊김'}`,
      }
    }

    /**
     * 치유 액션 뒤 재확인 (공용 awaitHealthy) — 살아나는 즉시 통과.
     * 재연결은 이미 떠 있는 런타임에 붙는 것뿐이라 3초면 충분하다 (사용자 지시).
     * 재시작은 프로세스가 다시 뜨는 시간이 필요해 그대로 15초를 기다린다.
     */
    function recheck(tries: number): Promise<CheckOutcome> {
      return awaitHealthy(() => statusRef.current, {
        tries,
        onDiag: (diag) => {
          if (!stopped) setLastDiag(diag)
        },
        // 중지를 누르면 재확인 폴링도 즉시 그만둔다
        shouldStop: () => stopped || haltRef.current,
      })
    }

    async function run(command: DoctorCommand): Promise<CheckOutcome> {
      switch (command) {
        // 저장된 주소로 본다 — 실제 세션이 쓰는 값이 살아 있는지를 확인해야 한다.
        case 'server':
          return probeServer()
        case 'model':
          return probeModels()
        case 'session':
          return pingRuntime()
        case 'heal-reconnect':
          await window.davis.reconnectProject()
          return recheck(RECONNECT_TRIES)
      }
    }

    void (async () => {
      let state = initPipeline(sessionUp(statusRef.current))
      setPipeline(state)
      while (state.next !== null && !stopped && !haltRef.current) {
        const outcome = await run(state.next)
        if (stopped) return
        state = advance(state, outcome, sessionUp(statusRef.current))
        setPipeline(state)
      }
      // 초록으로 끝났다 — 최초 등록 게이트가 이 신호로 자동 닫힘한다
      if (!stopped && !haltRef.current && (state.verdict === 'healthy' || state.verdict === 'healed')) {
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
  async function apply(fix: DoctorFix) {
    setBusy(fix)
    setNote(null)
    try {
      await RUN[fix]()
      setRound((value) => value + 1)
    } finally {
      setBusy(null)
    }
  }

  // 중지를 누르면 남은 단계가 있어도 도는 것으로 치지 않는다 (버튼이 "연결 시도" 로 돌아온다)
  const running = !halted && (pipeline === null || pipeline.next !== null)
  const verdict = pipeline?.verdict ?? null
  // 런타임의 시각(diagnoseIssues) + 파이프라인 자체 판정(직접 ping·라이선스)을 합친다
  const issues = verdict === 'manual' && pipeline ? mergeIssues(diagnoseIssues(status, lastDiag, failure), stepIssues(pipeline)) : []

  return (
    <div className={`dc-doctor${fix ? '' : ' dc-doctor--single'}`}>
      {/* 왼쪽 — 내가 바꾸는 것. 연결 설정은 이 팝업이 유일한 자리다 ((구)설정 → 연결 탭 흡수).
          **처음부터 항상 보인다** — 최초 프로젝트는 주소·키가 비어 있어 진단을 기다릴 이유가 없다. */}
      {fix && (
        <section className="dc-doctor__col">
          <h3 className="dc-doctor__coltitle">연결 설정</h3>
          <p className="dc-doctor__note">값을 바꾸고 연결 시도를 누르면 저장·재연결·재진단까지 한 번에 됩니다.</p>
          <ConnectionFixForm
            project={fix.project}
            settings={fix.settings}
            onSaveSettings={fix.onSaveSettings}
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

