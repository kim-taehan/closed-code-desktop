// 배포처 조회·등록이 실패한 사유를 사람 말로 옮긴다.
//
// 정본은 main 쪽 `electron/extensions/registryFetch.ts` 의 `RegistryFetchFailure`
// (조회 단계 5개 + `registryIndex.ts` 의 파싱 실패 4개)다. **사유가 늘면 여기 한 줄을 더한다.**
//
// 화면이 이 표를 못 찾으면 코드값을 그대로 보여준다 — 감추면 사용자가 고칠 수 없고,
// main 에 사유가 하나 늘어도 화면이 조용히 틀리지 않는다 (`extensionSkipReason.ts` 와 같은 판단).
//
// 문구가 **고칠 방법을 가리키게** 쓴다. 폐쇄망에서 배포처가 안 보이는 원인은 대개
// 주소 오타 · 사내망 미접속 · 서버 다운 셋 중 하나인데 고치는 방법이 전혀 다르다.

/** 순서는 조회 단계의 판정 순서다: 주소 → 연결 → 응답 → 내용. */
export const REGISTRY_FAILURE_LABEL: Record<string, string> = {
  // 주소
  bad_url: '주소 형식이 올바르지 않습니다',
  // 연결
  unreachable: '배포처에 닿지 못했습니다 (주소와 사내망 연결을 확인하세요)',
  timeout: '배포처가 제때 응답하지 않았습니다',
  // 응답
  http_error: '배포처가 오류를 돌려줬습니다',
  invalid_json: '배포처가 준 것이 JSON 형식이 아닙니다',

  // 내용 (목록 문서 파싱)
  not_object: '목록 문서가 객체가 아닙니다',
  missing_registry_version: '목록 문서에 registryVersion 이 없습니다',
  unsupported_registry_version: '이 앱이 읽을 수 없는 registryVersion 입니다',
  missing_extensions: '목록 문서에 extensions 가 없습니다',
}

/** 주소를 더할 때의 실패. 조회와 사유 집합이 달라 표를 가른다. */
export const REGISTRY_ADD_FAILURE_LABEL: Record<string, string> = {
  bad_url: 'http 또는 https 로 시작하는 전체 주소를 넣으세요',
  duplicate: '이미 등록한 배포처입니다',
}

/**
 * 내려받아 설치할 때의 실패. **두 단계의 사유가 한 통로로 올라온다** —
 * 받기(`packageDownload.ts`)와 풀기(`install.ts`). 사용자에게는 한 번의 조작이라
 * 표도 하나다. 어느 단계에서 멈췄는지는 문구가 드러낸다.
 */
export const REGISTRY_INSTALL_FAILURE_LABEL: Record<string, string> = {
  // 받기
  bad_url: '패키지 주소가 올바르지 않습니다',
  unreachable: '패키지를 받지 못했습니다 (주소와 사내망 연결을 확인하세요)',
  timeout: '패키지를 받는 데 시간이 너무 걸렸습니다',
  http_error: '배포처가 오류를 돌려줬습니다',
  write_failed: '받은 패키지를 디스크에 쓰지 못했습니다 (용량·권한을 확인하세요)',

  // 풀기 — 정본은 `electron/extensions/install.ts` 의 `InstallFailure`
  unreadable_package: '받은 것이 확장 패키지가 아닙니다',
  unsafe_entry: '패키지 안에 설치 폴더 밖을 가리키는 경로가 있습니다',
  extract_failed: '패키지를 푸는 데 실패했습니다',
  no_manifest: '패키지 안에 manifest.json 이 없습니다',
  invalid_json: 'manifest.json 이 JSON 형식이 아닙니다',
  invalid_manifest: 'manifest.json 이 확장 규격에 맞지 않습니다',
  move_failed: '설치 폴더로 옮기지 못했습니다',
}

/** 모르는 사유는 코드를 그대로 보여준다. `detail` 이 있으면 괄호로 덧붙인다. */
export function describeRegistryFailure(
  reason: string,
  detail?: string,
  table: Record<string, string> = REGISTRY_FAILURE_LABEL,
): string {
  const label = table[reason] ?? `알 수 없는 사유 (${reason})`
  return detail ? `${label} (${detail})` : label
}
