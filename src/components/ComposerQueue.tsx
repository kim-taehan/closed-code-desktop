// 응답 중에 보낸 메시지 대기열. 겹쳐 보내면 런타임이 이중 처리하므로
// ChatComposer 가 큐에 쌓고(useSendQueue), 여기는 그 목록을 보여주기만 한다.

export interface ComposerQueueProps {
  pending: number
  queries: string[]
  /** 대기열을 비우고 입력창으로 되돌린다 */
  onRestore: () => void
}

export function ComposerQueue({ pending, queries, onRestore }: ComposerQueueProps) {
  if (pending === 0) return null
  return (
    <div className="composer-queue">
      <div className="composer-queue__head">
        <span>대기 중 {pending}개</span>
        <button type="button" className="composer-queue__restore" onClick={onRestore}>
          입력창으로 되돌리기
        </button>
      </div>
      <ul className="composer-queue__list">
        {queries.map((query, index) => (
          <li key={index} className="composer-queue__item" title={query}>
            {query}
          </li>
        ))}
      </ul>
    </div>
  )
}
