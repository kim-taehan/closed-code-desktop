// 파일을 어디서 열지 결정한다: 앱 뷰어 / OS 기본 앱 / Finder(파일 관리자).
//
// 뷰어는 텍스트 전용이라 PDF·이미지·오피스·미디어는 "텍스트가 아닙니다" 로 막힌다 →
// 기본 앱으로 연다. 압축·설치 파일은 열어 봤자 소용없으니 Finder 에서 보여만 준다.

export type OpenTarget = 'viewer' | 'external' | 'reveal'

/** OS 기본 앱으로 여는 확장자 (문서·이미지·미디어) */
const EXTERNAL_EXTENSIONS = new Set<string>([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'hwp', 'hwpx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'heic',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'aac',
])

/** Finder 에서 위치만 보여줄 확장자 (압축·설치 파일) */
const REVEAL_EXTENSIONS = new Set<string>([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'dmg', 'pkg', 'exe', 'iso',
])

/** 경로에서 확장자만 뽑는다 (마지막 점 뒤, 소문자). 없으면 빈 문자열. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  // 숨김 파일(.gitignore)처럼 점이 맨 앞이면 확장자가 아니다
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 이 파일을 어디서 열지 */
export function openTargetOf(path: string): OpenTarget {
  const ext = extensionOf(path)
  if (REVEAL_EXTENSIONS.has(ext)) return 'reveal'
  if (EXTERNAL_EXTENSIONS.has(ext)) return 'external'
  return 'viewer'
}
