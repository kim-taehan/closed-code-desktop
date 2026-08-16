import type { RunEntry } from '../../shared/run/runSection'
import type { RunState } from '../state/runPanel'
import { t } from '../i18n/messages'

// 「실행」 패널의 한 줄. 점 · 이름 · 상태 · ▶/■ (설계 §1).
//
// **시작과 정지는 다른 버튼이다** (같은 버튼을 토글로 쓰지 않는다). 정지는 사용자가 보고
// 있던 것을 없애는 행동이라(설계 §3), 누르려던 것과 다른 것이 눌리면 로그를 읽던 중에
// 서버가 죽는다 — 토글은 상태를 한 박자 잘못 읽는 순간 정확히 그 사고를 낸다.

interface Props {
  entry: RunEntry
  state: RunState
  /** 이름 오른쪽 한 줄. 없으면 비운다 (`runStateLabel`) */
  label: string
  onStart: () => void
  onStop: () => void
}

export function RunRow({ entry, state, label, onStart, onStop }: Props): React.ReactElement {
  return (
    <div className={`dc-run__row dc-run__row--${state}`}>
      <span className={`dc-run__dot dc-run__dot--${state}`} aria-hidden="true" />
      {/* 명령은 title 로만 — 좁은 사이드바에서 두 줄을 쓰면 목록이 세 줄만 보인다 */}
      <span className="dc-run__name" title={`${entry.command}${entry.note ? ` — ${entry.note}` : ''}`}>
        {entry.name}
      </span>
      <span className="dc-run__label">{label === '' ? '' : t(label)}</span>

      {state === 'running' ? (
        <button
          type="button"
          className="dc-run__stop"
          // 탭의 ✕ 와 같은 일이다 — **프로세스도 멈춘다**
          title={t('정지 (프로세스도 멈춥니다)')}
          onClick={onStop}
        >
          ■
        </button>
      ) : (
        <button type="button" className="dc-run__start" title={entry.command} onClick={onStart}>
          ▶
        </button>
      )}
    </div>
  )
}
