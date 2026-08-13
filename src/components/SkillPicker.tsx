import { useOpencodeCommands } from '../state/useOpencodeCommands'

// `+ → 스킬` 목록.
//
// 고르면 **입력창에 이름을 넣는다.** 대신 실행해 주지 않는다 —
// 스킬은 에이전트가 대화 맥락을 보고 부르는 것이고, 무엇을 해달라는지는
// 사용자가 이어서 써야 한다. 이름만 넣으면 에이전트가 그 스킬을 집는다.
//
// 목록은 `/` 팝업과 **같은 출처**에서 온다 (`useOpencodeCommands`) — opencode 는 명령과
// 스킬을 한 배열로 주므로 여기서는 `source` 로 스킬만 거른다. 두 화면이 각자 다른 목록을
// 부르면 한쪽에만 있는 항목이 생기고, 사용자에겐 "있다가 없다" 로 보인다.

export interface SkillPickerProps {
  onPick: (name: string) => void
  onClose: () => void
}

export function SkillPicker({ onPick, onClose }: SkillPickerProps) {
  const { commands, loading, error } = useOpencodeCommands()
  const skills = commands.filter((item) => item.source === 'skill')

  return (
    <div className="dc-modal" role="dialog" aria-label="스킬" onClick={onClose}>
      <div className="dc-palette dc-palette--wide" onClick={(event) => event.stopPropagation()}>
        <div className="dc-palette__note">스킬을 고르면 입력창에 이름이 들어갑니다</div>

        {loading && <div className="dc-palette__empty">불러오는 중…</div>}
        {!loading && error && (
          <div className="dc-palette__note dc-palette__note--warn">{error}</div>
        )}
        {!loading && skills.length === 0 && (
          <div className="dc-palette__empty">이 프로젝트에 켜진 스킬이 없습니다</div>
        )}

        {!loading && skills.length > 0 && (
          <ul className="dc-palette__list">
            {skills.map((skill) => (
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
