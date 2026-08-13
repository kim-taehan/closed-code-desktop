// `code.workspace.listFiles(glob)` 이 받는 glob 의 **전부**를 여기서 정의한다.
//
// 새 의존성(minimatch·fast-glob)을 넣지 않는다 — 에어갭 제약이기도 하고,
// 확장이 실제로 쓰는 모양이 "재귀로 훑고 확장자로 거른다" 하나뿐이라
// 범용 glob 엔진은 쓰지 않을 기능을 통째로 들이는 것이 된다 (단순함 사다리).
//
// ponytail: 지원 문법을 아래 4가지로 좁혔다. 경로 중간 패턴(`src/**/*.ts`)이나
// `?`·문자클래스가 실제로 필요해지면 그때 넓힌다 — 그 전까지는 **모르는 문법을 던진다.**
// 조용히 빈 배열을 주면 확장 개발자가 "파일이 없다" 로 오해한다.
//
//   **/*.{ts,tsx,js}   재귀 + 확장자 여러 개
//   **/*.ts            재귀 + 확장자 하나
//   **/*               재귀 + 전부
//   *.ts · *           최상위 한 겹만

export interface GlobFilter {
  /** 하위 디렉토리까지 내려가는가 (`**` 접두사) */
  recursive: boolean
  /** 파일 **이름** 하나를 받는다. 경로가 아니다. */
  matches(name: string): boolean
}

/** 모양이 아니면 던진다. 부르는 쪽(확장)이 오류 문구로 무엇을 고칠지 알아야 한다. */
export function parseGlob(glob: string): GlobFilter {
  const recursive = glob.startsWith('**/')
  const pattern = recursive ? glob.slice(3) : glob

  if (pattern === '*') return { recursive, matches: () => true }

  const extensions = parseExtensions(pattern)
  if (extensions === null) {
    throw new Error(
      `지원하지 않는 glob 입니다: ${glob} — 쓸 수 있는 모양은 '**/*.{ts,js}' · '**/*.ts' · '**/*' · '*.ts' 입니다`,
    )
  }

  // 대소문자를 무시한다 — `.TS`·`.Java` 로 저장된 레거시 소스가 실제로 있다
  const suffixes = extensions.map((extension) => `.${extension.toLowerCase()}`)
  return {
    recursive,
    matches: (name) => {
      const lowered = name.toLowerCase()
      return suffixes.some((suffix) => lowered.endsWith(suffix))
    },
  }
}

/** `*.ts` → `['ts']`, `*.{ts,tsx}` → `['ts','tsx']`. 그 외는 null. */
function parseExtensions(pattern: string): string[] | null {
  if (!pattern.startsWith('*.')) return null
  const rest = pattern.slice(2)

  if (rest.startsWith('{') && rest.endsWith('}')) {
    const parts = rest
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim())
    return parts.length > 0 && parts.every(isPlainExtension) ? parts : null
  }

  return isPlainExtension(rest) ? [rest] : null
}

/** 확장자 자리에 또 다른 패턴 문자가 오면 우리가 처리할 수 있다고 말하면 안 된다. */
function isPlainExtension(value: string): boolean {
  return value !== '' && !/[*?{}[\]/\\]/.test(value)
}
