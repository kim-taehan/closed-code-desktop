// 확장을 건너뛴 사유를 사람 말로 옮긴다.
//
// 정본은 main 쪽 `electron/extensions/registry.ts` 의 `ExtensionSkipReason`
// (파일 단계 4개 + 매니페스트 파서가 돌려주는 것)이다. **사유가 늘면 여기 한 줄을 더한다.**
//
// 화면이 이 표를 못 찾으면 코드값을 그대로 보여준다 — 감추면 사용자가 고칠 수 없고,
// main 에 사유가 하나 늘어도 화면이 조용히 틀리지 않는다.
//
// 순서는 로더의 판정 순서다: 파일 → JSON → 매니페스트.

export const SKIP_REASON_LABEL: Record<string, string> = {
  // 파일 단계
  no_manifest: 'manifest.json 이 없습니다',
  unreadable: 'manifest.json 을 읽지 못했습니다',
  broken_link: '링크가 가리키는 폴더가 없습니다',
  invalid_json: 'manifest.json 이 JSON 형식이 아닙니다',

  // 매니페스트 단계
  not_object: 'manifest.json 이 객체가 아닙니다',
  missing_manifest_version: 'manifestVersion 이 없습니다',
  unsupported_manifest_version: '이 앱이 읽을 수 없는 manifestVersion 입니다',
  missing_name: 'name 이 없습니다',
  unsafe_name: 'name 에 경로 문자(/ \\ ..)를 쓸 수 없습니다',
  missing_version: 'version 이 없습니다',
  missing_main: 'main 이 없습니다',
}
