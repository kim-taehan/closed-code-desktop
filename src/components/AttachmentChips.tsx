import type { PickedAttachment } from '../../shared/ipc/channels'

// 붙여 둔 것들.
//
// 못 읽은 것도 남겨서 사유를 보여준다 — 조용히 빼면
// "분명 골랐는데 안 붙었다" 가 되어 사용자가 다시 고른다.
//
// 미리보기는 두지 않는다. 이름과 크기면 무엇을 붙였는지 알기에 충분하고,
// 내용을 화면 상태에 올리면 스냅샷마다 수 MB 가 오간다.

export interface AttachmentChipsProps {
  items: PickedAttachment[]
  error: string | null
  onRemove: (index: number) => void
}

export function AttachmentChips({ items, error, onRemove }: AttachmentChipsProps) {
  if (items.length === 0 && error === null) return null

  return (
    <div className="dc-chips">
      {items.map((item, index) => {
        const bad = item.kind === 'error'
        const note = describe(item)
        return (
          <span
            key={`${item.name}-${index}`}
            className={`dc-chip${bad ? ' dc-chip--bad' : ''}`}
            title={note ? `${item.name} — ${note}` : item.name}
          >
            <span className="dc-chip__icon">{iconOf(item)}</span>
            <span className="dc-chip__name">{item.name}</span>
            {note && <span className={bad ? 'dc-chip__why' : 'dc-chip__note'}>{note}</span>}
            <button
              type="button"
              className="dc-chip__remove"
              onClick={() => onRemove(index)}
              title="빼기"
              aria-label={`${item.name} 빼기`}
            >
              ×
            </button>
          </span>
        )
      })}

      {error && <span className="dc-chips__error">{error}</span>}
    </div>
  )
}

function iconOf(item: PickedAttachment): string {
  if (item.kind === 'error') return '!'
  if (item.kind === 'image') return '🖼'
  return item.type === 'dir' ? '📁' : '📄'
}

function describe(item: PickedAttachment): string | undefined {
  if (item.kind === 'error') return item.error
  if (item.kind === 'image') return formatBytes(item.bytes)
  return undefined
}

/** 사람이 읽는 크기. 정확한 바이트는 알 필요가 없다. */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
