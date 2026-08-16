import { useState } from 'react'
import { ASK_PROMPT, recheckPrompt, runSourceLine, runState, runStateLabel } from '../state/runPanel'
import { sendUserText } from '../state/slashCommands'
import { useRunList } from '../state/useRunList'
import type { ShellDrawer } from '../state/useShellDrawer'
import { RunRow } from './RunRow'
import { t } from '../i18n/messages'

// 사이드바 「실행」 패널 (설계 2026-08-16 §1·§2).
//
// **목록의 정본은 앱 저장소다** (`useRunList`) — 예전에는 프로젝트의 AGENTS.md 였고,
// 그래서 여기 「편집」 버튼이 있었다. 옮긴 이유와 그때 잃은 것(팀 공유 · 버전 관리 ·
// 손으로 고칠 자리)은 `shared/run/runList.ts` 머리말에 있다. 여기서 하는 일은 목록을
// 그리고, ▶ 로 띄우고, 틀렸을 때 다시 물을 문을 내는 것뿐이다.
//
// **띄우는 판정은 여기 없다.** 「이미 돌고 있으면 겹쳐 띄우지 않는다」는 main 한 곳에서
// 정한다 (`PtyDrawerBridge.run` — 도구가 타는 길과 같은 함수다). 화면이 따로 판정하면
// 문이 둘인 만큼 규칙도 둘이 된다.

interface Props {
  projectId: string
  /** 탭 목록·▶ 뒤에 열 칸·■ (`useShellDrawer`) */
  shell: ShellDrawer
  onToast: (text: string) => void
}

export function RunPanel({ projectId, shell, onToast }: Props): React.ReactElement {
  const list = useRunList(projectId)
  // 물어본 뒤 20초쯤 걸린다 (설계 §2). 그동안 버튼을 그대로 두면 사용자가 또 누르고,
  // 같은 분석이 둘 돈다 — 눌렀다는 사실을 화면에 남긴다.
  const [asked, setAsked] = useState(false)

  const ask = (text: string): void => {
    if (!sendUserText(text)) {
      onToast(t('대화가 아직 준비되지 않았습니다'))
      return
    }
    setAsked(true)
  }

  const start = async (name: string, command: string): Promise<void> => {
    // ⚠️ **탭은 이 왕복이 끝난 뒤에 만든다.** 먼저 만들면 그 탭이 같은 이름으로 칸을 열고,
    // main 이 「이미 돌고 있다」로 읽어 명령이 영영 안 들어간다 (`PTY_RUN` 머리말).
    const result = await window.davis.runShellPane({ name, command })
    if (!result.ok) {
      onToast(result.error)
      return
    }
    // 이미 돌고 있었어도 그 탭으로 옮겨 간다 — 겹쳐 띄우지 않는 것과 사용자를 그 자리로
    // 데려가는 것은 다른 일이다 (`run_project` 도구와 같은 규칙).
    shell.showPane(name)
  }

  return (
    <div className="dc-run">
      <div className="dc-run__bar">
        <button
          type="button"
          className="dc-run__refresh"
          onClick={list.refresh}
          title={t('실행 목록을 다시 읽습니다')}
        >
          ↻
        </button>
      </div>

      {list.stale && (
        <div className="dc-run__stale">
          {t('빌드 설정이 바뀌었습니다.')}
          <button type="button" className="dc-run__ask" onClick={() => ask(recheckPrompt(list.entries))}>
            {t('다시 확인할까요?')}
          </button>
        </div>
      )}

      <div className="dc-run__list">
        {list.entries.map((entry) => {
          const exit = shell.exits.exitOf(entry.name)
          const state = runState(entry.name, shell.tabs.names, exit)
          return (
            <RunRow
              key={entry.name}
              entry={entry}
              state={state}
              label={runStateLabel(state, exit)}
              onStart={() => void start(entry.name, entry.command)}
              // ■ 는 탭의 ✕ 와 **같은 함수**다 — 멈추는 문이 둘이면 한쪽만 pty 를 지운다
              onStop={() => shell.closeTab(entry.name)}
            />
          )
        })}
      </div>

      {/* 목록이 없을 때만 청한다. 있는데 틀린 경우는 위의 「다시 확인할까요?」 아니면 편집이다 */}
      {!list.loading && list.entries.length === 0 && (
        <div className="dc-run__empty">
          {asked ? (
            // 20초쯤 걸리고, 다 되면 모델이 파일에 적는 순간 목록이 저절로 뜬다
            // (`RUN_LIST_CHANGED`). 그때까지 무엇을 기다리는지 적어 둔다.
            <p className="dc-run__hint">{t('모델이 프로젝트를 읽고 있습니다 — 20초쯤 걸립니다.')}</p>
          ) : (
            <button type="button" className="dc-run__ask" onClick={() => ask(ASK_PROMPT)}>
              {t('실행 방법을 찾을까요?')}
            </button>
          )}
        </div>
      )}

      {/* 「편집」이 있던 자리다. 목록이 프로젝트 밖으로 가면서 사람이 열 파일이 없어졌다 */}
      <div className="dc-run__source">{t(runSourceLine(list.found, list.entries.length))}</div>
    </div>
  )
}
