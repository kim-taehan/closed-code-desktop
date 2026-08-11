import { t } from '../i18n/messages'
import { ExtensionTree } from './ExtensionTree'
import {
  leavesOfAll,
  matchingTree,
  segmentChips,
  segmentTree,
  type SegmentChip,
  type TreeNode,
} from '../state/extensionTree'

// `kind: 'tree'` 뷰의 본문 — 빈 상태 · 경로 조각 칩 · 좁히기 상자 · 트리.
//
// `ExtensionTablePane` 이 표 갈래를 빼 간 것과 같은 방식이다. 좁히기 **상태는 여기 두지
// 않는다** — 탭 배지(`24/280`)가 다른 탭에도 같은 조건을 걸어야 해서, 상태는 탭 줄과 같은
// 자리(`ExtensionViewPanel`)에 산다. 여기는 받은 조건으로 좁혀 그리기만 한다.
//
// **좁히는 길이 둘이고 겹쳐 쓴다(AND).** 칩은 갈래(폴더)를, 글은 이름을 짚는다 —
// 실측에서 `main` 을 치면 268잎(96%)이 남아 361줄이 한꺼번에 펼쳐졌다. 칩은 그 프로젝트에서
// 실제로 갈리는 조각만 뜨므로 늘 유의미하게 쪼갠다 (`segmentChips`).

export interface ExtensionTreePaneProps {
  /**
   * 이 뷰에 마지막으로 들어온 마디들. **`undefined` 와 빈 배열은 다른 상태다** —
   * 앞은 "아직 안 돌렸다", 뒤는 "돌렸는데 찾은 것이 없다" 이고, 둘을 같은 문구로
   * 보여주면 사용자에게는 **버튼이 안 먹은 것**과 구분되지 않는다.
   */
  nodes: TreeNode[] | undefined
  /** 좁히는 글 */
  find: string
  onFind: (find: string) => void
  /** 고른 경로 조각. 빈 글이면 전체 */
  segment: string
  onSegment: (segment: string) => void
  picked: ReadonlySet<string>
  onPickedChange: (picked: Set<string>) => void
  /**
   * 펼쳐 둔 가지. **여기 두지 않는다** — 프로젝트 탭을 다녀오면 이 화면이 사라졌다
   * 다시 태어나는데, 그때 접힘이 같이 죽으면 파고들던 자리를 처음부터 찾아야 한다
   * (`useExtensionExpanded`).
   */
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
  /** 이름을 눌렀을 때 — 고르는 것과 **다른 몸짓**이다 */
  onOpen: (id: string) => void
  /** 그 줄의 `action` 버튼 */
  onAction: (commandId: string, id: string) => void
}

export function ExtensionTreePane(props: ExtensionTreePaneProps) {
  if (props.nodes === undefined) {
    return (
      <p className="ext-empty">
        {t('아직 실행하지 않았습니다.')}
        <br />
        <span className="ext-empty__hint">{t('위 버튼을 눌러 목록을 만듭니다.')}</span>
      </p>
    )
  }

  if (props.nodes.length === 0) {
    return (
      <p className="ext-empty">
        {t('결과가 없습니다.')}
        <br />
        <span className="ext-empty__hint">{t('이 프로젝트에서 찾은 것이 없습니다.')}</span>
      </p>
    )
  }

  const bySegment = segmentTree(props.nodes, props.segment)
  const shown = matchingTree(bySegment, props.find)
  // 고른 칩의 개수는 **세어서** 준다 — 상위 여섯 밖의 조각을 골랐을 때 목록에서 못 찾아
  // 0 으로 적으면, 24개가 걸려 있는데 「0」 이라 적힌 칩이 남는다
  const chips = withPicked(segmentChips(props.nodes), props.segment, leavesOfAll(bySegment).length)
  // 좁혀 놓고 접어 두면 맞는 것을 찾고도 열어 봐야 보인다 — 좁히는 중에는 펼친다
  const narrowing = props.find.trim() !== '' || props.segment !== ''

  return (
    <>
      {/* 파일 경로 트리라 「관리자 목록 화면」을 찾으려면 그 파일이 어디 있는지 이미
          알아야 했다 — API 탭은 주소가 이름이지만 이쪽은 아니다. */}
      <div className="ext-find">
        <input
          type="search"
          className="ext-find__input"
          placeholder={t('이름으로 좁히기')}
          value={props.find}
          onChange={(event) => props.onFind(event.target.value)}
        />
        {props.find.trim() !== '' && <span className="ext-find__hit">{leavesOfAll(shown).length}개</span>}
      </div>

      {/* 칩이 하나뿐이면 고를 것이 없다 — 자리만 차지한다.
          단 걸어 둔 칩은 남긴다 (푸는 자리가 사라지지 않게). */}
      {(chips.length > 1 || props.segment !== '') && (
        <div className="ext-chips" role="group" aria-label={t('경로로 좁히기')}>
          {chips.map((chip) => (
            <button
              key={chip.segment}
              type="button"
              className={`ext-chip${chip.segment === props.segment ? ' ext-chip--on' : ''}`}
              aria-pressed={chip.segment === props.segment}
              title={t('이 폴더 이름이 든 것만 봅니다')}
              // 누르면 걸고, 같은 것을 다시 누르면 푼다 — 푸는 자리를 따로 두지 않는다
              onClick={() => props.onSegment(chip.segment === props.segment ? '' : chip.segment)}
            >
              {chip.segment}
              <span className="ext-chip__count">{chip.count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="ext-empty">{t('찾은 것이 없습니다.')}</p>
      ) : (
        <ExtensionTree
          // 좁히기가 바뀌면 **다시 태어나게** 한다 — 접혀 있던 가지가 그대로면
          // 맞는 것을 찾아 놓고도 열어 봐야 보인다
          key={narrowing ? `좁힘:${props.segment}` : '전체'}
          nodes={shown}
          picked={props.picked}
          onPickedChange={props.onPickedChange}
          onOpen={props.onOpen}
          onAction={props.onAction}
          // 좁히는 동안에는 **쥐어 준 펼침을 쓰지 않는다.** 여기서 편 것을 바깥에 남기면
          // 거르개를 지운 뒤에도 903줄이 펼쳐진 채로 남는다 — 좁힘은 잠깐 보는 상태고,
          // 남길 것은 사용자가 직접 편 가지다.
          {...(narrowing ? { defaultOpen: true } : { expanded: props.expanded, onToggle: props.onToggle })}
        />
      )}
    </>
  )
}

/**
 * 고른 칩은 상위 여섯에 안 들어도 **끝까지 보인다.**
 *
 * 없으면 푸는 자리가 사라진다 — 탭을 옮기면(파일→API) 그 조각이 그 탭에서는 흔하지 않아
 * 목록에서 빠지는데, 조건은 그대로 걸려 있어 0건인 트리 앞에서 되돌릴 방법이 없어진다.
 */
function withPicked(chips: SegmentChip[], segment: string, count: number): SegmentChip[] {
  if (segment === '' || chips.some((chip) => chip.segment === segment)) return chips
  return [{ segment, count }, ...chips]
}
