// channels.ts 가 겉으로 내보내는 타입 re-export 모음.
//
// 소비자는 지금처럼 `shared/ipc/channels` 하나만 import 한다 (channels.ts 가 이 파일을
// 통째로 다시 내보낸다). 여기로 뺀 이유는 하나뿐이다 — channels.ts 는 채널 상수가
// 늘어나는 자리인데 300줄 상한에 붙어 있었다. 타입 통로가 그 자리를 먹지 않게 한다.

import type { PickedAttachment } from './attachmentPayloads'
import type {
  SkillListPayload, SkillSummaryPayload,
  FileListPayload, SearchMatchPayload, SearchPayload, SearchResultPayload,
} from './searchPayloads'

export type {
  SkillListPayload, SkillSummaryPayload,
  FileListPayload, PickedAttachment,
  SearchMatchPayload, SearchPayload, SearchResultPayload,
}
import type {
  ProjectFavoritePayload,
  ProjectIdPayload,
  ProjectOpenPayload,
  ProjectOpenResultPayload,
  ProjectRenamePayload,
  ProjectStatePayload,
} from './projectPayloads'

export type {
  ProjectFavoritePayload,
  ProjectIdPayload,
  ProjectOpenPayload,
  ProjectOpenResultPayload,
  ProjectRenamePayload,
  ProjectStatePayload,
}
export type * from './diagnosticsTypes'

// 소스 관리·확장 — 채널 상수와 함께 늘어나는 쪽이라 여기로 옮겨 뒀다
export type {
  GitProjectPayload,
  GitPathPayload,
  GitDiffPayload,
  GitDiffResultPayload,
  GitCommitPayload,
  GitHunkPayload,
  GitLogPayload,
  GitRefPayload,
  GitBranchPayload,
  GitStashPushPayload,
  GitPushPayload,
  GitActionResult,
  GitStatePayload,
} from './gitPayloads'
export type {
  ExtensionEntryPayload,
  ExtensionExportCsvPayload,
  ExtensionExportCsvResult,
  ExtensionInstallPayload,
  ExtensionListPayload,
  ExtensionReadmePayload,
  ExtensionReadmeResult,
  ExtensionSetEnabledPayload,
  ExtensionUninstallPayload,
  ExtensionUninstallResult,
  ExtensionRowPayload,
  ExtensionHtmlPayload,
  ExtensionRowsPayload,
  ExtensionTreeNodePayload,
  ExtensionTreeNodeState,
  ExtensionProgressPayload,
  ExtensionProgressKind,
  ExtensionProgressLane,
  ExtensionTreePayload,
  ExtensionAskTextPayload,
  ExtensionAskTextResponsePayload,
  ExtensionViewRegisterPayload,
  ExtensionViewRegisterResult,
  ActiveFileNotice,
  ExtensionRunCommandPayload,
  SkippedExtensionPayload,
} from './extensionPayloads'

export type {
  RegistryAddPayload,
  RegistryFetchPayload,
  RegistryInstallPayload,
  RegistryInstallRequest,
  RegistryListPayload,
  RegistryReadmePayload,
  RegistryReadmeRequest,
  RegistryUrlPayload,
} from './extensionRegistryPayloads'
