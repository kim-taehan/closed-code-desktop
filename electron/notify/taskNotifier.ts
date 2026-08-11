import { join } from 'node:path'
import { app, Notification, type BrowserWindow } from 'electron'

// 창이 비활성일 때 턴이 끝나거나 사용자 응답을 기다리면 OS 알림을 띄운다.
// 비활성 판정은 renderer(document.hasFocus())가 하고, 여기선 알림만 낸다.
// 클릭하면 창을 앞으로 가져온다.

/** 알림 사유. "끝났다" 와 "당신을 기다린다" 는 급한 정도가 달라 본문을 가른다. */
export type TaskNoticeKind = 'done' | 'toolRequest' | 'question' | 'plan'

export interface TaskNotice {
  kind?: TaskNoticeKind
  /** 어느 프로젝트인지 — 여러 개를 돌려 놓으면 어느 창을 봐야 하는지 알 수 없다 */
  project?: string
  /** 응답 대기일 때만 — 무엇을 기다리는지 (툴 이름). 대화 내용은 싣지 않는다. */
  detail?: string
}

/** 앱 아이콘 (파란색). 패키징 시 build/icon.png 를 함께 담는다 — electron-builder.yml files 참조 */
const ICON_PATH = join(app.getAppPath(), 'build', 'icon.png')

/**
 * 마지막으로 띄운 알림. 새로 띄우기 전에 이것을 닫아 **알림 센터에 쌓이지 않게** 한다 —
 * 여러 턴을 돌려 놓고 자리를 비우면 같은 문구가 겹겹이 남는다. 최신 하나만 의미가 있다.
 */
let current: Notification | null = null

export function showTaskDone(window: BrowserWindow, notice: TaskNotice = {}): void {
  if (window.isDestroyed() || !Notification.isSupported()) return

  current?.close()
  const notification = new Notification({
    title: 'AXGentic Code',
    body: bodyOf(notice),
    icon: ICON_PATH,
  })
  notification.on('click', () => {
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  // 사용자가 직접 닫았거나 사라진 것을 붙들고 있지 않는다
  notification.on('close', () => {
    if (current === notification) current = null
  })
  current = notification
  notification.show()
}

/**
 * 알림 본문. 앞에는 항상 프로젝트 이름을 붙이고,
 * **응답 대기일 때만** 무엇을 기다리는지 덧붙인다 (사용자 지시) —
 * 끝난 작업은 더 볼 것이 창 안에 있고, 대기 중인 것은 내가 움직여야 풀린다.
 */
function bodyOf({ kind = 'done', project, detail }: TaskNotice): string {
  const head = project ? `${project} · ` : ''
  switch (kind) {
    case 'toolRequest':
      return `${head}${detail ?? '툴 사용'} 승인을 기다리고 있습니다`
    case 'question':
      return `${head}질문에 답을 기다리고 있습니다`
    case 'plan':
      return `${head}계획 승인을 기다리고 있습니다`
    default:
      return `${head}작업이 끝났습니다`
  }
}
