import { useEffect, useState } from 'react'
import type { SkillSummaryPayload } from '../../shared/ipc/channels'

// `+ → 스킬` 목록.
//
// 고르면 **입력창에 이름을 넣는다.** 대신 실행해 주지 않는다 —
// 스킬은 에이전트가 대화 맥락을 보고 부르는 것이고, 무엇을 해달라는지는
// 사용자가 이어서 써야 한다. 이름만 넣으면 에이전트가 그 스킬을 집는다.

export interface SkillPickerProps {
  onPick: (name: string) => void
  onClose: () => void
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; skills: SkillSummaryPayload[]; error?: string }

export function SkillPicker({ onPick, onClose }: SkillPickerProps) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    void window.davis.listSkills().then((result) => {
      // 실패해도 내장 스킬은 온다 — 사유는 따로 알린다
      setState({
        status: 'ready',
        skills: result.skills,
        ...(result.error ? { error: result.error } : {}),
      })
    })
  }, [])

  return (
    <div className="dc-modal" role="dialog" aria-label="스킬" onClick={onClose}>
      <div className="dc-palette dc-palette--wide" onClick={(event) => event.stopPropagation()}>
        <div className="dc-palette__note">스킬을 고르면 입력창에 이름이 들어갑니다</div>

        {state.status === 'loading' && <div className="dc-palette__empty">불러오는 중…</div>}
        {state.status === 'ready' && state.error && (
          <div className="dc-palette__note dc-palette__note--warn">{state.error}</div>
        )}
        {state.status === 'ready' && state.skills.length === 0 && (
          <div className="dc-palette__empty">이 프로젝트에 켜진 스킬이 없습니다</div>
        )}

        {state.status === 'ready' && state.skills.length > 0 && (
          <ul className="dc-palette__list">
            {state.skills.map((skill) => (
              <li key={skill.name}>
                <button
                  type="button"
                  className="dc-palette__item"
                  onClick={() => {
                    onPick(skill.name)
                    onClose()
                  }}
                >
                  <span className="dc-skill__head">
                    <span className="dc-palette__name">{skill.name}</span>
                    {/* fork 는 별도 에이전트로 돈다 — 오래 걸릴 수 있다는 신호다 */}
                    {skill.builtin && <span className="dc-skill__tag dc-skill__tag--builtin">내장</span>}
                    {skill.context === 'fork' && <span className="dc-skill__tag">fork</span>}
                  </span>
                  <span className="dc-skill__desc">{skill.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
