import { FIX_LABEL, FIX_PROGRESS, type DoctorFix, type DoctorIssue } from '../state/connectionDoctor'
import { STEP_LABEL, type DoctorStep, type StepStatus } from '../state/doctorPipeline'

// 자가 진단 열의 표시 조각들 — 단계 목록과 수동 조치 안내.
//
// ConnectionDoctor 는 부작용 실행(드라이버)에 집중하고, "무엇을 그리나" 는 여기로 갈랐다
// (300줄 상한). 상태를 갖지 않는다: 받은 것을 그대로 그린다.

const STEP_MARK: Record<StepStatus, string> = {
  pending: '·',
  running: '…',
  ok: '✓',
  fail: '✗',
  blocked: '–',
}

/** 진단·치유 단계 — 대기(·)/진행(…)/성공(✓)/실패(✗)/확인 불가(–) */
export function DoctorSteps({ steps }: { steps: DoctorStep[] }) {
  return (
    <ul className="dc-doctor__steps">
      {steps.map((step, index) => (
        <li key={index} className={`dc-doctor__step dc-doctor__step--${step.status}`}>
          <span className="dc-doctor__step-mark">{STEP_MARK[step.status]}</span>
          <span className="dc-doctor__step-label">{STEP_LABEL[step.id]}</span>
          {step.detail && <span className="dc-doctor__step-detail">{step.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

/** 자동으로 못 고친 것들 — 계층별 원인·안내와 (있으면) 조치 버튼 */
export function IssueList({
  issues,
  busy,
  onFix,
}: {
  issues: DoctorIssue[]
  busy: DoctorFix | null
  onFix: (fix: DoctorFix) => void
}) {
  return (
    <ul className="dc-doctor__list">
      {issues.map((issue) => (
        <li key={issue.layer} className="dc-doctor__item">
          <div className="dc-doctor__head">
            <span className="dc-doctor__layer">{issue.layer}</span>
            <span className="dc-doctor__cause">{issue.cause}</span>
          </div>
          {issue.advice && <p className="dc-doctor__advice">{issue.advice}</p>}
          {issue.fix && (
            <button
              type="button"
              className="dc-doctor__fix"
              disabled={busy !== null}
              onClick={() => onFix(issue.fix!)}
            >
              {busy === issue.fix ? FIX_PROGRESS[issue.fix] : FIX_LABEL[issue.fix]}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** 같은 계층이 양쪽에서 나오면 한 번만 — 런타임의 시각을 앞에, 파이프라인 판정을 뒤에 */
export function mergeIssues(base: DoctorIssue[], extra: DoctorIssue[]): DoctorIssue[] {
  const seen = new Set(base.map((issue) => issue.layer))
  return [...base, ...extra.filter((issue) => !seen.has(issue.layer))]
}
