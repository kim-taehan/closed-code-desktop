import { useEffect, useState, type DragEvent } from 'react'
import { TurnControls } from './TurnControls'
import { ContextUsageBar } from './ContextUsageBar'
import { WorkingDirBar } from './WorkingDirBar'
import type { WorkingDirPayload } from '../../shared/ipc/channels'
import { AttachmentChips } from './AttachmentChips'
import { Composer } from './Composer'
import { ComposerAdd } from './ComposerAdd'
import { SkillPicker } from './SkillPicker'
import { PermissionModeSwitch } from './PermissionModeSwitch'
import { detectComposerMode, shellCommandOf } from '../state/composerMode'
import { resolveSlashSubmission, setModelSlashCommand } from '../state/slashCommands'
import { useComposerSendBridges } from '../state/useComposerSendBridges'
import { parseMentions } from '../state/atMentions'
import { useOpencodeCommands } from '../state/useOpencodeCommands'
import { isRealFilePath } from '../state/editorContext'
import { useSendQueue } from '../state/useSendQueue'
import { useModelSelect } from '../state/useModelSelect'
import { isModelSwitcherEligible } from '../state/modelSelect'
import { ModelSwitch } from './ModelSwitch'
import { useInputHistory } from '../state/useInputHistory'
import type { ContextFile } from '../../shared/protocol/chatImage'
import type { AttachmentsApi } from '../state/useAttachments'
import type { ActiveTab } from '../state/useOpenFiles'
import type { ChatEditorContext } from '../state/editorContext'
import type { PermissionMode } from '../../shared/protocol/kinds'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { TurnMeta } from '../../shared/ipc/messageTypes'

// 입력 영역 전체 — 취소·첨부·입력 상자.
//
// App 에서 떼어낸 이유는 여기만 계속 자라기 때문이다 (첨부·셸·문서 첨부·모드).

export interface ChatComposerProps {
  /** 자체 입력칸을 가진 화면(소스 관리 탭)에서 감춘다 — 판정은 `hidesComposer`, 결정 #1.
   *  **언마운트가 아니라 감추기다**: 지우면 쓰던 글·대기열이 함께 사라진다. */
  hidden?: boolean
  ready: boolean
  isStreaming: boolean
  permissionMode: PermissionMode
  onPermissionMode: (mode: PermissionMode) => void
  /** 현재 세션 작업 경로 (ADR-036) — override 중일 때만 바가 뜬다 */
  workingDir: WorkingDirPayload
  attachments: AttachmentsApi
  insert: { text: string; nonce: number }
  project: ProjectRecord | null
  /** 지금 보고 있는 본문 탭. 문서면 함께 보낸다. */
  activeTab: ActiveTab
  /**
   * 편집기 상태 — 활성 파일 + 고른 범위 + 미저장 파일 (editorContext.ts).
   * 경로는 **루트 상대경로 그대로** 나간다. 절대경로 변환은 main 이 한다.
   */
  chatContext: ChatEditorContext
  onSelectTab: (tab: ActiveTab) => void
  /** 커넥터(MCP) 설정을 연다 */
  onConnectors: () => void
  /** 지금 열려 있는 대화. 바뀌면 모델 선택이 기본으로 돌아간다 (DC-1322). */
  chatId: string | null
  /** 결과가 화면에 안 보이는 실패 알림 (/model 허용 밖 이름 등) */
  onToast?: (text: string, tone?: 'info' | 'error') => void
  /** 개발자 모드 이스터에그 가로채기. true 면 로컬 처리됐으니 보내지 않는다. */
  onDevPhrase?: (text: string) => boolean
  /** 세션 컨텍스트 바가 최신 사용량을 뽑는 원천 */
  turnMetas: TurnMeta[]
}

export function ChatComposer(props: ChatComposerProps) {
  // **파일 탭일 때만이다.** 활성 탭에는 파일이 아닌 것이 섞인다 — git diff 탭
  // (`git:staged:…`)과 확장 화면 탭(`ext:{확장}:{뷰}`)은 가짜 경로라, 그대로 쓰면
  // `<루트>/ext:screen-scenario:…` 같은 없는 파일을 첨부해 보낸다.
  // 실측(2026-08-14): 확장 판을 열어 둔 채로 입력창에 그 줄이 붙어 나갔다.
  const viewingFile =
    props.activeTab !== 'chat' && isRealFilePath(props.activeTab) ? props.activeTab : null
  const queue = useSendQueue(props.project?.id ?? null, props.isStreaming)
  const history = useInputHistory(props.project?.id ?? null)
  const [skills, setSkills] = useState(false)
  // `/` 로 부를 수 있는 opencode 항목. 전송 때 템플릿을 전개하려면 팝업만이 아니라
  // 여기서도 목록을 들고 있어야 한다 — 손으로 쳐서 Enter 한 것도 같은 길로 온다.
  const opencodeCommands = useOpencodeCommands(props.project?.id ?? null)
  // 입력창에 밖에서 글을 넣는 통로는 하나로 합친다 — 파일 픽·스킬·대기열 되돌리기가
  // 각자 nonce 를 가지면 "가장 최근 것" 을 못 가려 이전 것에 영영 가린다.
  const [insert, setInsert] = useState({ text: '', nonce: 0, replace: false })
  const push = (text: string, replace = false) =>
    setInsert(({ nonce }) => ({ text, nonce: nonce + 1, replace }))

  // App 이 파일 트리에서 고른 경로를 이 통로로 넘긴다
  useEffect(() => {
    if (props.insert.nonce > 0) push(props.insert.text)
  }, [props.insert.nonce])

  // 요청별 모델 오버라이드 (DC-1322). 선택은 렌더러 메모리뿐 — 매 요청 재전송, 대화 바뀌면 초기화.
  const models = useModelSelect(props.project?.id ?? null, props.chatId)
  const modelEligible = isModelSwitcherEligible(models.state)
  const modelPatch = models.selected ? { model: models.selected } : {}

  // 입력창을 거치지 않는 전송 통로(슬래시 명령·확장의 chat.ask) — 사유는 훅 머리말.
  useComposerSendBridges({
    projectId: props.project?.id ?? null,
    submit: queue.submit,
    modelPatch,
  })

  // `/models` 슬래시 — 툴바 스위처와 **같은 선택 상태**를 공유한다. 뜰 조건일 때만 등록 (fail-closed).
  // 매 렌더 다시 심는다 (setSendToRuntime 과 같은 stale 방지). 목록 밖 이름은 조용히 넘기지 않는다.
  useEffect(() => {
    if (!modelEligible) return setModelSlashCommand(null)
    setModelSlashCommand({
      name: 'models',
      description: '응답에 사용할 모델 변경 — /models 모델명 (비우면 기본 모델)',
      takesArgs: true,
      run: (args) => {
        const name = args.trim()
        const current = models.state.status?.model ?? ''
        if (!name || name === current) return models.select(null)
        if (models.state.options.includes(name)) return models.select(name)
        props.onToast?.(`허용되지 않은 모델입니다: ${name}`, 'error')
      },
    })
  })
  // 언마운트 시 잔재를 남기지 않는다 — 다음 마운트가 조건대로 다시 심는다
  useEffect(() => () => setModelSlashCommand(null), [])

  function restoreQueue(): void {
    const merged = queue.take()
    if (merged) push(merged.query, true)
  }

  function submit(text: string): void {
    // 데스크톱 명령(`/new` 등)은 런타임으로 보내지 않고 여기서 처리한다.
    // 팝업에서 고르지 않고 직접 쳐서 Enter 한 경우도 이 경로로 온다.
    const plan = resolveSlashSubmission(text, opencodeCommands.commands)
    if (plan?.kind === 'run') {
      plan.command.run(plan.args)
      return
    }
    // opencode 명령이면 템플릿이 전개된 글이 온다 — 그 글이 그대로 사용자 메시지가 된다
    // (opencode 도 그렇게 한다. opencodeCommand.ts 실측).
    if (plan?.kind === 'prompt') text = plan.text

    // `!명령` 은 LLM 을 거치지 않고 프로젝트 폴더에서 바로 실행한다 — 스트리밍과 무관하다
    if (detectComposerMode(text) === 'shell') {
      void window.davis.runShell({ command: shellCommandOf(text) })
      return
    }

    // 개발자 모드 이스터에그 — 정확 일치 시 로컬 응답으로 끝나고 runtime 으로 보내지 않는다
    if (props.onDevPhrase?.(text)) return


    // 문서를 보며 물으면 그 문서를 함께 보낸다 —
    // 화면에 띄워 놓고 "이거 고쳐줘" 라고 하는 것이 자연스럽다.
    const viewing =
      viewingFile && props.project
        ? [{ filePath: `${props.project.root}/${viewingFile}`, type: 'file' as const }]
        : []

    // `@경로` 는 내용을 붙이지 않고 경로만 보낸다 — 에이전트가 직접 읽는다.
    // 자동완성이 폴더를 `뒤에 /` 로 넣으므로 그것으로 파일/디렉토리를 가른다 (계약: ContextFile.type).
    const mentioned = props.project
      ? parseMentions(text).map((path) => {
          const isDir = path.endsWith('/')
          return {
            filePath: `${props.project!.root}/${isDir ? path.slice(0, -1) : path}`,
            type: isDir ? ('dir' as const) : ('file' as const),
          }
        })
      : []

    // 응답 중이면 큐에 쌓았다가 끝날 때 한 번에 보낸다 (겹쳐 보내면 런타임이 이중 처리한다)
    queue.submit({
      query: text,
      ...modelPatch,
      // 편집기 상태. 이게 있어야 "이 함수 고쳐줘" 가 성립한다.
      ...props.chatContext,
      images: props.attachments.images,
      files: dedupe([...props.attachments.files, ...viewing, ...mentioned]),
      attachments: [
        ...props.attachments.summaries,
        ...dedupe([...viewing, ...mentioned]).map((file) => ({
          name: baseName(file.filePath),
          kind: 'file' as const,
        })),
      ],
    })

    // 보낸 뒤에는 비운다 — 남겨 두면 다음 질문에 또 붙는다
    props.attachments.clear()
    // 물었으면 답을 봐야 한다 — 문서를 보던 채로 두면 응답을 놓친다
    props.onSelectTab('chat')
  }

  const [dragOver, setDragOver] = useState(false)

  // 외부에서 입력창으로 파일을 끌어다 놓으면 +버튼과 같은 경로로 붙인다.
  function dropFiles(event: DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.davis.pathForFile(file))
      .filter((path) => path.length > 0)
    if (paths.length > 0) props.attachments.addPaths(paths)
  }

  return (
    <div
      className={`composer-bar${props.hidden ? ' composer-bar--hidden' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={dropFiles}
      style={dragOver ? { outline: '2px dashed var(--dc-accent)', outlineOffset: -2 } : undefined}
    >
      <TurnControls busy={props.isStreaming} onCancel={() => void window.davis.cancelChat()} />

      <WorkingDirBar workingDir={props.workingDir} />

      <ContextUsageBar turnMetas={props.turnMetas} />

      {queue.pending > 0 && (
        <div className="composer-queue">
          <div className="composer-queue__head">
            <span>대기 중 {queue.pending}개</span>
            <button type="button" className="composer-queue__restore" onClick={restoreQueue}>
              입력창으로 되돌리기
            </button>
          </div>
          <ul className="composer-queue__list">
            {queue.queries.map((query, index) => (
              <li key={index} className="composer-queue__item" title={query}>
                {query}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AttachmentChips
        items={props.attachments.items}
        error={props.attachments.error}
        onRemove={props.attachments.remove}
      />

      {skills && (
        <SkillPicker
          onPick={(name) => push(`/${name}`)}
          onClose={() => setSkills(false)}
        />
      )}

      <Composer
        onSubmit={submit}
        disabled={!props.ready}
        insert={insert}
        history={history.entries}
        onHistoryRecord={history.record}
        {...(viewingFile ? { viewing: baseName(viewingFile) } : {})}
        left={
          <ComposerAdd
            disabled={!props.ready}
            onPick={props.attachments.pick}
            onSkills={() => setSkills(true)}
            onConnectors={props.onConnectors}
          />
        }
        right={
          <>
            {/* 표시 조건은 fail-closed — 근거(개인 LLM/허용 목록) 없으면 아예 없다 */}
            {modelEligible && (
              <ModelSwitch
                state={models.state}
                selected={models.selected}
                onSelect={models.select}
                disabled={!props.ready}
              />
            )}
            <PermissionModeSwitch
              mode={props.permissionMode}
              disabled={!props.ready}
              onChange={props.onPermissionMode}
            />
          </>
        }
      />
    </div>
  )
}

/** 같은 파일을 두 번 보내지 않는다 — 보고 있으면서 @ 로도 가리키는 일이 흔하다 */
function dedupe(files: ContextFile[]): ContextFile[] {
  const seen = new Set<string>()
  return files.filter((file) => (seen.has(file.filePath) ? false : (seen.add(file.filePath), true)))
}

/** 경로에서 파일명만. 첨부 기록에 전체 경로를 적으면 길어서 읽기 어렵다. */
function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
