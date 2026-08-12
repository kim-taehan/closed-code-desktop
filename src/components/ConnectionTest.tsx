import type { ProjectStatus } from '../state/projectStatus'
import { ConnectionDoctor, type ConnectionDoctorProps } from './ConnectionDoctor'

// "프로젝트 연결" 팝업 — 연결에 관한 **단 하나의 표면**이다.
//
// 상태 표시를 눌러도, 신규 프로젝트 최초 등록 게이트에서도 이 팝업이 뜬다 (구 온보딩 팝업 흡수).
// 열면 곧바로 진단·복구 파이프라인(ConnectionDoctor)이 돌고, 자동으로 못 고친
// 주소·키 문제는 안의 수정 폼에서 바로 고친다 — 어떤 상태에서든 여기서 연결까지 간다.

export interface ConnectionTestProps {
  status: ProjectStatus
  /** 어느 프로젝트를 진단하는지 — 경로를 최상단에 보여준다 */
  projectPath: string
  /** 핸드셰이크 실패 사유. Doctor 의 세션 이슈 판정에 들어간다. */
  failure?: string
  onClose: () => void
  /** 최초 등록처럼 맥락 안내가 필요할 때 상단에 한 줄 보여준다 */
  intro?: string
  /** Doctor 인라인 수정 폼 재료 — 있으면 주소·키를 이 팝업 안에서 바로 고친다 */
  fix?: ConnectionDoctorProps['fix']
  /** 진단이 초록으로 끝났다 — 자동 게이트(`useDoctorGate`)가 이걸로 스스로 닫는다 */
  onHealthy?: () => void
}

export function ConnectionTest({ status, projectPath, failure, onClose, intro, fix, onHealthy }: ConnectionTestProps) {
  return (
    <div className="dc-modal" role="dialog" aria-label="프로젝트 연결" onClick={onClose}>
      {/* 좌우 두 열(설정 | 자가 진단)이 들어가는 유일한 팝업이라 카드가 넓다 */}
      <div className="dc-modal__card dc-modal__card--wide" onClick={(event) => event.stopPropagation()}>
        <div className="dc-modal__head">
          <span className="dc-modal__title">프로젝트 연결</span>
          <button type="button" className="dc-modal__close" onClick={onClose} title="닫기">
            ×
          </button>
        </div>

        {/* 어느 프로젝트를 보고 있는지부터 — 여러 개 열어 두면 어느 것인지 헷갈린다 */}
        <div className="dc-modal__path" title={projectPath}>{projectPath}</div>
        {intro && <p className="dc-onboarding__intro">{intro}</p>}

        <ConnectionDoctor
          status={status}
          failure={failure}
          {...(fix ? { fix } : {})}
          {...(onHealthy ? { onHealthy } : {})}
        />
      </div>
    </div>
  )
}
