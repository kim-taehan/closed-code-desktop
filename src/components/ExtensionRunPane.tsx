import { useEffect, useState } from 'react'
import { t } from '../i18n/messages'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'
import type { ExtensionProgressLine } from '../state/extensionProgressLog'

// 도는 동안의 **진행 칸** — 행동 바 위에 앉는다 (`ExtensionActionBar`).
//
// 예전에는 여기가 한 줄이었다. 한 줄로는 두 가지를 원리상 말할 수 없다:
//
//   1. **겹쳐 도는 것.** 확장이 넷을 동시에 돌리면(`extensions/test-scenario/core/pool.js`)
//      한 줄은 그중 하나밖에 못 적는다. 그래서 갈래 수만큼 줄을 그린다 — 줄 수는 우리가
//      정하지 않는다, 확장이 실어 보낸 `lanes` 가 몇 개냐가 곧 몇 줄이다.
//   2. **무엇이 끝났나.** 다음 줄이 오면 앞 줄이 사라지므로 자리를 비웠다 돌아오면 아무것도
//      안 남는다. 쌓이는 줄은 `extensionProgressLog` 가 모으고 여기서 마지막 몇 개를 보인다.
//
// **분모를 모를 때 막대를 그리지 않는다.** 대상 하나에 몇 분이 걸릴지 모르는 단계가 있어
// 퍼센트는 거짓말이 된다 — 살아 있다는 증거는 갈래마다의 경과 시간 쪽이다.

/** 사이드바에 보일 줄 수. 나머지는 본문 탭이 전부 보여 준다. */
const SHOWN = 3

export interface ExtensionRunPaneProps {
  /** 지금 알림. 끝났으면 `null` — 그래도 쌓인 줄은 남아 있다 */
  progress: ExtensionProgressPayload | null
  /** 쌓인 줄 전부. 여기서는 마지막 몇 개만 그린다 */
  lines: ExtensionProgressLine[]
}

/** 줄머리 글자. **색만으로 가르지 않는다** — 색맹·흑백에서도 갈려야 한다. */
const GLYPH: Record<ExtensionProgressLine['kind'], string> = { done: '✓', fail: '✕', note: 'ℹ' }

export function ExtensionRunPane(props: ExtensionRunPaneProps) {
  const lanes = props.progress?.lanes ?? []
  const running = props.progress !== null

  // **시각을 화면이 센다.** 확장이 경과를 실어 보내면 밀던 순간에 박제되는데, 대상 하나에
  // 수십 초라 그동안 화면이 멈춘 것으로 읽힌다 (실측 불만: *"시간도 멈춰있어"*).
  const now = useNow(running && lanes.length > 0)

  const shown = props.lines.slice(-SHOWN)
  const done = props.progress?.done
  const total = props.progress?.total

  return (
    <div className="ext-run">
      <p className="ext-run__head">
        {running && <span className="ext-progress__spin" aria-hidden="true" />}
        <span className="ext-run__what">{running ? (props.progress?.text ?? '') : t('끝났습니다')}</span>
        {/* 분수는 있을 때만. **없는 분모를 지어내지 않는다** */}
        {done !== undefined && total !== undefined && (
          <span className="ext-run__frac">
            {done}/{total}
          </span>
        )}
      </p>

      {lanes.length > 0 && (
        <div className="ext-run__lanes">
          {lanes.map((lane) => (
            <div className="ext-lane" key={`${lane.name}:${lane.startedAt}`}>
              <span className="ext-lane__dot" aria-hidden="true" />
              <span className="ext-lane__name" title={lane.name}>
                {lane.name}
              </span>
              {lane.doing !== undefined && <span className="ext-lane__doing">{lane.doing}</span>}
              <span className="ext-lane__at">{elapsed(now - lane.startedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        // **최근 것이 아래다.** 로그는 위에서 아래로 읽는 것이고, 뒤집으면 「무엇 다음에
        // 무엇이 일어났나」를 사람이 머릿속에서 되뒤집어야 한다.
        <ul className="ext-run__log">
          {shown.map((line) => (
            <li className={`ext-line ext-line--${line.kind}`} key={`${line.at}:${line.text}`}>
              <span className="ext-line__glyph" aria-hidden="true">
                {GLYPH[line.kind]}
              </span>
              <span className="ext-line__text">{line.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 1초마다 다시 그리게 하는 지금 시각. `on` 이 거짓이면 **재지 않는다** —
 * 끝난 화면에서 초를 세는 것은 아무것도 알려 주지 않으면서 매초 리렌더를 만든다.
 */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

/** 밀리초 → `3:12`. 시간 단위는 안 쓴다 — 한 시간 넘게 도는 명령은 없다. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
