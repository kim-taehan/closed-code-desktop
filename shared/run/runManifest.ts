// 「이 프로젝트를 어떻게 띄우는지가 바뀌었을 만한가」 하나만 답하는 지문 (설계 §2).
//
// ⚠️ **이것은 실행 방법을 규칙으로 알아내는 것이 아니다.** 그 일은 모델이 한다 —
// 모노레포·워크스페이스·`dev` 가 아니라 `start:local` 인 프로젝트·도커를 먼저 띄워야 하는
// 프로젝트는 규칙으로 안 된다 (설계 §2, 그리고 `desktop-extensions/screen-scenario/core/prompt.js`
// 의 *"규칙으로 훑지 않는 이유"*). 여기서 파일 이름 목록을 들고 있는 것은 **무엇을 돌릴지**
// 를 정하기 위해서가 아니라 **다시 물어볼 때가 됐는지**를 알기 위해서다.
//
// **말없이 다시 분석하지 않는다.** 지문이 달라지면 화면이 "다시 확인할까요?" 를 띄우고,
// 20초를 태울지는 사용자가 정한다.

/**
 * 지문에 넣는 파일들. **선언 파일만 넣고 잠금 파일은 넣지 않는다** —
 * `package-lock.json`·`pnpm-lock.yaml` 은 의존성 하나만 올려도 바뀌는데 그때 실행 방법이
 * 달라진 적은 거의 없다. 물어보는 값이 낮으면서 자주 물어보면 사용자는 곧 무시하게 된다.
 *
 * 없는 파일은 그냥 빠진다 — 새로 생기면 지문이 달라지고, 그것도 물어볼 만한 변화다
 * (`docker-compose.yml` 이 생긴 날이 실제로 그렇다).
 */
export const MANIFEST_FILES: readonly string[] = [
  'package.json',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Makefile',
  'docker-compose.yml',
  'docker-compose.yaml',
]

/**
 * 이보다 큰 매니페스트는 지문에서 뺀다.
 *
 * ⚠️ 여기에는 **"읽는 길이 둘이라 상한을 맞춰야 한다"** 고 적혀 있었다. 화면이 `readFile`
 * IPC 로 직접 읽던 시절의 사실이고(그쪽에 512KB 상한이 있다 —
 * `electron/projects/projectFs.ts` 의 `MAX_FILE_BYTES`), 목록이 앱 저장소로 옮겨 오면서
 * **읽는 길이 main 하나로 모여 거짓이 됐다** (`electron/run/runManifestDisk.ts`).
 *
 * 그래도 값은 남긴다: 패널을 열 때마다 해시하는 파일이라 크기를 묶어 두는 편이 낫고,
 * 옛 지문(그 상한으로 잰 값)과 새 지문이 갈리면 사용자에게는 이유 없는 "다시 확인할까요?"
 * 로 보인다.
 */
export const MANIFEST_MAX_BYTES = 512 * 1024

export interface ManifestFile {
  path: string
  text: string
}

/**
 * 읽어 온 매니페스트들의 지문. **경로로 정렬해 순서에 안 흔들리게 한다** —
 * 읽는 순서는 부르는 쪽 사정이고(한쪽은 node fs, 한쪽은 IPC), 그것 때문에 값이 달라지면
 * 열 때마다 "다시 확인할까요?" 가 뜬다.
 *
 * 해시는 FNV-1a 32비트다. **암호용이 아니다** — 여기서 막으려는 것은 공격이 아니라
 * 「안 바뀌었는데 바뀐 줄 아는 것」이고, 렌더러에는 Node 의 `crypto` 가 없다.
 */
export function manifestFingerprint(files: readonly ManifestFile[]): string {
  const sorted = [...files].sort((left, right) => (left.path < right.path ? -1 : 1))
  let hash = 0x811c9dc5
  for (const file of sorted) {
    for (const text of [file.path, '\0', file.text, '\0']) {
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        // FNV 소수(16777619) 곱. `Math.imul` 로 32비트 안에서 곱한다 — `*` 는 배정도로
        // 새서 큰 파일에서 값이 갈린다.
        hash = Math.imul(hash, 0x01000193)
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
