import type { ExtensionView } from '../../shared/extensions/manifest'
import {
  describeSkipReason,
  extensionDirName,
  type ExtensionEntry,
  type ExtensionRow,
  type ExtensionRowsByView,
  type SkippedExtensionEntry,
} from '../state/extensionRows'
import { ExtensionTable } from './ExtensionTable'
import '../styles/extensions.css'

// 확장(Extension) 패널 — 설치된 확장과 그 결과를 보여준다.
//
// ⚠️ runtime 의 **플러그인(Plugin)** 과 다른 체계다 (계획서 §0). 문구를 섞지 않는다.
//
// **건너뛴 확장을 감추지 않는다.** 확장은 폴더째 복사로 설치되므로 사람이 손으로 쓴
// 매니페스트가 온다 — "사유와 함께 건너뛴다" 가 이 체계의 검증 기준인데 화면에서
// 안 보이면 사유를 만든 의미가 없다. 목록이 비어 보이는 것보다 이유가 보이는 편이 낫다.
//
// 이 컴포넌트는 **props 로만 받는다.** IPC 는 배선 단계에서 붙인다.

export interface ExtensionsPanelProps {
  extensions: ExtensionEntry[]
  skipped: SkippedExtensionEntry[]
  /** 뷰 id → 그 뷰에 들어온 행들 (`useExtensionRows`) */
  rowsByView: ExtensionRowsByView
  /** 확장이 선언한 명령을 실행한다. 없으면 버튼을 그리지 않는다. */
  onRunCommand?: (commandId: string) => void
  /** 결과 행을 눌렀을 때. 없으면 행은 누를 수 없다 (`ExtensionTable`). */
  onOpenRow?: (row: ExtensionRow) => void
}

export function ExtensionsPanel(props: ExtensionsPanelProps) {
  const { extensions, skipped, rowsByView } = props

  if (extensions.length === 0 && skipped.length === 0) {
    // 설치 경로를 같이 알린다 — 어디에 복사해야 하는지 모르면 "없습니다" 는 막다른 길이다
    return (
      <p className="ext-empty">
        설치된 확장이 없습니다.
        <br />
        <span className="ext-empty__hint">~/.davis-code/desktop-extensions 에 폴더째 복사합니다.</span>
      </p>
    )
  }

  return (
    <div className="ext-panel">
      {extensions.length > 0 && (
        <section className="ext-group">
          <h4 className="ext-group__title">
            확장 <span className="ext-group__count">{extensions.length}</span>
          </h4>
          {extensions.map((entry) => (
            <ExtensionItem
              key={entry.dir}
              entry={entry}
              {...(props.onRunCommand ? { onRunCommand: props.onRunCommand } : {})}
            />
          ))}
        </section>
      )}

      {skipped.length > 0 && (
        <section className="ext-group">
          <h4 className="ext-group__title">
            건너뜀 <span className="ext-group__count">{skipped.length}</span>
          </h4>
          {skipped.map((entry) => (
            <div key={entry.dir} className="ext-skip" title={entry.dir}>
              <span className="ext-skip__name">{extensionDirName(entry.dir)}</span>
              <span className="ext-skip__reason">{describeSkipReason(entry.reason)}</span>
            </div>
          ))}
        </section>
      )}

      {/* 결과는 확장이 선언한 뷰 단위로 그린다. 뷰를 선언하지 않은 확장은 여기 나오지 않는다. */}
      {viewsOf(extensions).map(({ key, view }) => (
        <section key={key} className="ext-group">
          <h4 className="ext-group__title">{view.title}</h4>
          {view.kind === 'table' ? (
            <ExtensionTable
              rows={rowsByView[view.id] ?? []}
              {...(props.onOpenRow ? { onOpenRow: props.onOpenRow } : {})}
            />
          ) : (
            // 아직 못 그리는 종류를 조용히 빼면 확장 개발자가 왜 안 나오는지 알 수 없다
            <p className="ext-empty">아직 그리지 못하는 화면입니다 ({view.kind}).</p>
          )}
        </section>
      ))}
    </div>
  )
}

function ExtensionItem({
  entry,
  onRunCommand,
}: {
  entry: ExtensionEntry
  onRunCommand?: (commandId: string) => void
}) {
  const commands = entry.contributes?.commands ?? []

  return (
    <div className="ext-item" title={entry.dir}>
      <div className="ext-item__head">
        <span className="ext-item__name">{entry.displayName}</span>
        <span className="ext-item__version">{entry.version}</span>
      </div>
      {onRunCommand && commands.length > 0 && (
        <div className="ext-item__commands">
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="ext-command"
              onClick={() => onRunCommand(command.id)}
            >
              {command.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 확장들이 선언한 뷰를 펼친다.
 *
 * 뷰 id 는 확장이 자기 이름으로 앞을 채우는 관례(`codeAnalysis.results`)라 대체로
 * 겹치지 않지만, 겹쳐도 **화면은 둘 다 그린다** — 확장 이름을 섞어 React key 를 만든다.
 * 같은 id 면 같은 행들이 두 번 보이는데, 그것이 id 가 겹쳤다는 사실 자체를 드러낸다.
 */
function viewsOf(extensions: ExtensionEntry[]): { key: string; view: ExtensionView }[] {
  return extensions.flatMap((entry) =>
    (entry.contributes?.views ?? []).map((view) => ({
      key: `${entry.name}:${view.id}`,
      view,
    })),
  )
}
