import { t } from '../i18n/messages'
import type { ExtensionRow } from '../state/extensionRows'
import { NO_EXTENSION } from '../state/extensionRowFilter'
import type { RowSort } from '../state/extensionRowSort'
import { ExtensionTable } from './ExtensionTable'

// `kind: 'table'` 뷰의 본문 — 빈 상태 · 확장자 거르개 · 표.
//
// 거르개·정렬 **상태는 여기 두지 않는다.** 위쪽 명령 줄의 「CSV 로 내보내기」가 지금 보고
// 있는 것을 그대로 내보내야 해서, 상태는 그 버튼과 같은 자리(`ExtensionViewPanel`)에 산다.
// 여기는 받은 것을 그리기만 한다.

export interface ExtensionTablePaneProps {
  /**
   * 이 뷰에 마지막으로 들어온 행들. **`undefined` 와 빈 배열은 다른 상태다** —
   * 앞은 "아직 안 돌렸다", 뒤는 "돌렸는데 찾은 것이 없다" 이고, 둘을 같은 문구로
   * 보여주면 사용자에게는 **버튼이 안 먹은 것**과 구분되지 않는다.
   */
  rows: ExtensionRow[] | undefined
  /** 거르고 난 것 — 표에 실제로 그릴 행들 */
  visible: ExtensionRow[]
  /** 고를 수 있는 확장자들. 한 종류뿐이면 거르개를 그리지 않는다 */
  options: string[]
  /** 지금 고른 확장자. `null` 은 전체 */
  active: string | null
  onExtChange: (ext: string | null) => void
  sort: RowSort | null
  onSort: (sort: RowSort | null) => void
  onOpenRow: (row: ExtensionRow) => void
}

export function ExtensionTablePane(props: ExtensionTablePaneProps) {
  if (props.rows === undefined) {
    return (
      <p className="ext-empty">
        {t('아직 실행하지 않았습니다.')}
        <br />
        <span className="ext-empty__hint">{t('위 버튼을 눌러 결과를 만듭니다.')}</span>
      </p>
    )
  }

  // 훑을 대상(glob·판정 기준)은 확장이 정한다. 앱은 그 범위를 모르므로
  // 사유를 지어내지 않고 "찾은 것이 없다" 까지만 말한다.
  if (props.rows.length === 0) {
    return (
      <p className="ext-empty">
        {t('결과가 없습니다.')}
        <br />
        <span className="ext-empty__hint">{t('이 프로젝트에서 찾은 것이 없습니다.')}</span>
      </p>
    )
  }

  return (
    <>
      {/* 확장자가 한 종류뿐이면 거르개는 고를 것이 없다 — 자리만 차지한다 */}
      {props.options.length > 1 && (
        <div className="ext-view__filter">
          {/* 값을 확장자 자체가 아니라 **자리 번호**로 쓴다 — "확장자 없음" 의 값이
              빈 문자열이라 「전체」와 구분되지 않는다. 번호면 어느 쪽과도 겹치지 않는다. */}
          <select
            className="ext-view__select"
            aria-label={t('확장자로 좁히기')}
            value={props.active === null ? '' : String(props.options.indexOf(props.active))}
            // 「전체」를 먼저 가른다 — `Number('')` 은 `0` 이라, 그냥 색인으로 쓰면
            // 전체가 **첫 확장자**로 떨어진다 (되돌릴 방법이 사라진다)
            onChange={(event) =>
              props.onExtChange(
                event.target.value === '' ? null : (props.options[Number(event.target.value)] ?? null),
              )
            }
          >
            <option value="">{t('전체')}</option>
            {props.options.map((option, index) => (
              <option key={option} value={index}>
                {option === NO_EXTENSION ? t('(확장자 없음)') : option}
              </option>
            ))}
          </select>
        </div>
      )}

      <ExtensionTable rows={props.visible} onOpenRow={props.onOpenRow} sort={props.sort} onSort={props.onSort} />
    </>
  )
}
