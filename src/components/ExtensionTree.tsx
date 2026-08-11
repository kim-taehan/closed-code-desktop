import { useState } from 'react'
import { t } from '../i18n/messages'
import { branchStateOf, leavesOf, toggled, type TreeNode } from '../state/extensionTree'

// 확장이 올린 트리를 그린다 (`contributes.views[].kind === 'tree'`).
//
// **선택 상태를 앱이 쥔다.** 확장이 자기 HTML 로 트리를 그리면 사용자가 고른 것을
// 확장에게 알릴 길이 없다 — 화면에서 나가는 메시지는 파일 열기 하나뿐이다
// (`extensionHtmlDoc.ts` 의 `isOpenRequest`). 앱이 그리면 명령을 걸 때 고른 것을
// 함께 실어 보내면 되고, 조작 알갱이가 명령 단위로 유지된다.
//
// 판단(무엇이 고른 것인가·가지를 누르면 어떻게 되나)은 `state/extensionTree.ts` 에 있다.
// 여기는 그리기와 접기만 한다.

/** 형편 → 사람이 읽는 낱말. **색만으로 가르지 않는다** (색맹·흑백). */
const STATE_WORD = { waiting: t('대기'), running: t('도는 중'), failed: t('실패') }

export interface ExtensionTreeProps {
  nodes: TreeNode[]
  picked: ReadonlySet<string>
  onPickedChange: (picked: Set<string>) => void
  /** 마디 이름을 눌렀을 때. 고르는 것과 **다른 몸짓**이다 — 이쪽은 "본다". */
  onOpen?: (id: string) => void
  /**
   * 그 줄의 `action` 버튼을 눌렀을 때. 그 마디 **하나만** 골라 명령을 돌린다.
   *
   * 대상이 줄마다 다른 행동(「이 API 의 결과를 본다」)은 위쪽 명령 버튼으로 표현할 수 없다.
   * 주지 않으면 버튼을 그리지 않는다 — 눌러도 아무 일 없는 버튼을 두지 않는다.
   */
  onAction?: (commandId: string, id: string) => void
  /**
   * 처음부터 펼쳐 둘 것인가. 기본은 **접힘** — 903줄짜리가 통째로 펼쳐지면 어디서
   * 시작할지 알 수 없다. 거르개로 좁힌 뒤에는 펼쳐야 한다 (좁힌 결과가 안 보이면 소용없다).
   */
  defaultOpen?: boolean
  /**
   * 펼쳐 둔 마디. 주면 **접힘 상태를 바깥이 쥔다** — 이 화면이 사라졌다 돌아와도 남는다
   * (`useExtensionExpanded`). 주지 않으면 각 줄이 자기 안에 쥔다.
   *
   * `defaultOpen` 과 **같이 오지 않는다.** 좁히는 중에는 전부 펼치는 것이 맞는데
   * (`ExtensionTreePane`), 그 상태를 바깥에 남기면 거르개를 지운 뒤에도 903줄이
   * 펼쳐진 채로 남는다. 그래서 좁히는 동안만 각 줄이 도로 자기 상태를 쓴다.
   */
  expanded?: ReadonlySet<string>
  onToggle?: (id: string) => void
}

export function ExtensionTree({
  nodes,
  picked,
  onPickedChange,
  onOpen,
  onAction,
  defaultOpen,
  expanded,
  onToggle,
}: ExtensionTreeProps) {
  if (nodes.length === 0) return null
  return (
    <ul className="ext-tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          picked={picked}
          onPickedChange={onPickedChange}
          {...(onOpen ? { onOpen } : {})}
          {...(onAction ? { onAction } : {})}
          {...(defaultOpen ? { defaultOpen } : {})}
          {...(expanded ? { expanded } : {})}
          {...(onToggle ? { onToggle } : {})}
        />
      ))}
    </ul>
  )
}

function TreeItem({
  node,
  picked,
  onPickedChange,
  onOpen,
  onAction,
  defaultOpen,
  expanded,
  onToggle,
}: { node: TreeNode } & Omit<ExtensionTreeProps, 'nodes'>) {
  // **처음엔 접어 둔다.** 903개짜리 트리가 통째로 펼쳐지면 어디서 시작할지 알 수 없고,
  // 스크롤만 길어진다. 폴더 이름은 접힌 채로도 보이므로 「무엇이 있나」는 그대로 읽힌다.
  //
  // 바깥이 쥐어 주면 그것을 따른다 — 화면이 사라져도 남기려면 여기 두면 안 된다.
  const [localOpen, setLocalOpen] = useState(defaultOpen ?? false)
  const open = expanded === undefined ? localOpen : expanded.has(node.id)
  const toggle = () => (expanded === undefined ? setLocalOpen((previous) => !previous) : onToggle?.(node.id))
  const children = node.children ?? []
  const isBranch = children.length > 0
  const state = branchStateOf(node, picked)
  const action = node.action

  return (
    <li className={isBranch ? 'ext-tree__branch' : 'ext-tree__leaf'}>
      {/* 배지가 붙은 줄(= 확장이 "여기는 끝났다" 고 표시한 것)은 **줄 전체를 물들인다.**
          900줄짜리 트리에서 작은 숫자만으로는 어디까지 했는지 눈으로 못 찾는다. */}
      <div
        className={`ext-tree__row${node.badge === undefined ? '' : ' ext-tree__row--done'}${
          node.state === 'running' ? ' ext-tree__row--running' : ''
        }`}
      >
        <button
          type="button"
          // 꺾쇠는 글자가 아니라 **두 변으로 그린 뒤 회전**한다 — 파일 트리(`.dc-tree__caret`)와
          // 같은 방식이라 어떤 크기에서도 또렷하고, 두 트리의 꺾쇠가 같은 모양이 된다
          className={`ext-tree__twist${isBranch ? ' ext-tree__twist--branch' : ''}${open ? ' ext-tree__twist--open' : ''}`}
          // 잎에도 자리를 남긴다 — 없애면 잎과 가지의 이름이 서로 어긋나 계단처럼 보인다
          disabled={!isBranch}
          aria-label={open ? '접기' : '펼치기'}
          aria-expanded={isBranch ? open : undefined}
          onClick={toggle}
        />

        <input
          type="checkbox"
          className="ext-tree__check"
          checked={state === 'all'}
          // 부분 선택은 checked 로 표현할 수 없다 — DOM 속성을 직접 세운다
          ref={(input) => {
            if (input) input.indeterminate = state === 'some'
          }}
          aria-label={node.label}
          onChange={() => onPickedChange(toggled(node, picked))}
        />

        <button
          type="button"
          className={`ext-tree__name${state === 'all' ? ' ext-tree__name--picked' : ''}`}
          // 이름을 누르면 **본다**. 고르는 것은 체크박스다 (몸짓을 가른다).
          // 가지에는 볼 것이 없으므로 접기로 돌린다.
          onClick={() => (isBranch ? toggle() : onOpen?.(node.id))}
          title={node.id}
        >
          {node.label}
        </button>

        {/* 가지를 체크하면 **몇 개가 딸려 나가는지** 미리 말한다. 실측: 최상위 `src` 를 한 번
            체크하면 269개가 소리 없이 선택돼 그대로 명령에 실렸다 (상한도 확인도 없다). */}
        {isBranch && (
          <span className="ext-tree__count" title={t('체크하면 딸려올 개수')}>
            {leavesOf(node).length}
          </span>
        )}

        {node.badge !== undefined && <span className="ext-tree__badge">{node.badge}</span>}

        {/* **진행과 대상이 여기서 만난다.** 바닥 진행 칸은 「비상 로그인이 도는 중」이라고
            말하는데, 그 줄이 트리의 어디인지는 화면이 말하지 않았다. 색만으로 가르지 않고
            낱말을 함께 적는다 — 도는 줄은 점이 뛰고, 나머지는 글로 형편을 말한다. */}
        {node.state !== undefined && (
          <span className={`ext-tree__state ext-tree__state--${node.state}`}>
            <span className="ext-tree__dot" aria-hidden="true" />
            {STATE_WORD[node.state]}
          </span>
        )}

        {/* 그 줄에만 있는 행동 (`action`). **대상이 줄마다 다르면 버튼도 줄에 있어야 한다** —
            「이 API 의 결과를 본다」 는 위쪽 명령 버튼으로 표현할 수 없다. 확장이 데이터로
            선언하므로 앱에 확장별 특례가 생기지 않는다. */}
        {action !== undefined && onAction !== undefined && (
          <button type="button" className="ext-tree__action" onClick={() => onAction(action.command, node.id)}>
            {action.label}
          </button>
        )}
      </div>

      {isBranch && open && (
        <ul className="ext-tree__children">
          {children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              picked={picked}
              onPickedChange={onPickedChange}
              {...(onOpen ? { onOpen } : {})}
              {...(onAction ? { onAction } : {})}
              {...(defaultOpen ? { defaultOpen } : {})}
              {...(expanded ? { expanded } : {})}
              {...(onToggle ? { onToggle } : {})}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
