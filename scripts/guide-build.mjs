// 가이드 빌드 — 장별 초안(md) 을 한 페이지 HTML 로 합친다 (스펙: _workspace/12_spec_guide.md).
//
//   npm run guide:build
//
// 초안은 docs/guide/drafts/*.md 이고 결과는 둘이다:
//   docs/guide/index.html   배포·오프라인 열람용 (자체 CSS, 외부 CDN 없음 — 에어갭 제약)
//   docs/guide/README.md    GitHub 에서 `docs/guide/` 로 들어가면 **바로 렌더링**되는 판
//                           (GitHub 은 리포 안의 .html 을 렌더링하지 않고 소스로만 보여준다)

import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRAFTS = join(ROOT, 'docs', 'guide', 'drafts')
const OUT = join(ROOT, 'docs', 'guide', 'index.html')
const OUT_MD = join(ROOT, 'docs', 'guide', 'README.md')
const IMAGES = join(ROOT, 'docs', 'guide', 'images')

/**
 * 아직 안 찍은 이미지는 깨진 아이콘 대신 자리표시로 낸다 — 무엇이 빠졌는지도 그대로 보인다.
 * 경로는 `../images/` 와 `images/` 두 가지가 섞여 있어 둘 다 받는다 (장별 초안마다 다르게 썼다).
 */
async function missingImages(md) {
  const missing = new Set()
  for (const match of md.matchAll(/!\[[^\]]*\]\((?:\.\.\/)?images\/([^)]+)\)/g)) {
    const name = match[1]
    try {
      await access(join(IMAGES, name))
    } catch {
      missing.add(name)
    }
  }
  return missing
}

/** 자리표시 치환 — HTML 판과 GitHub 판이 같은 문구를 쓴다 */
function placeholderMd(md, missing) {
  return md.replace(/!\[([^\]]*)\]\((?:\.\.\/)?images\/([^)]+)\)/g, (whole, caption, name) =>
    missing.has(name) ? `> 📷 *촬영 예정: ${caption || name}*` : whole,
  )
}

/** 장 순서 = 파일명 순서. 스펙의 장 번호를 파일명 앞에 두었으므로 정렬만 하면 된다. */
async function draftFiles() {
  const names = await readdir(DRAFTS)
  return names.filter((name) => name.endsWith('.md')).sort()
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSlug)
  .use(rehypeStringify)

/** 목차용 — h2(장)·h3(절) 만 뽑는다. rehypeSlug 와 같은 규칙으로 id 를 만든다. */
function outline(html) {
  const items = []
  const re = /<(h2|h3) id="([^"]+)">(.*?)<\/\1>/g
  let match
  while ((match = re.exec(html)) !== null) {
    items.push({ level: match[1], id: match[2], text: strip(match[3]) })
  }
  return items
}

function strip(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

const CSS = `
:root {
  --bg: #fbfaf7; --surface: #fff; --text: #1c1b19; --muted: #6b6862;
  --border: #e3ded4; --accent: #1a5fd0; --code-bg: #f4f1ea;
  --max: 860px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.75 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 0; }
nav.toc { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
  padding: 24px 16px 40px; border-right: 1px solid var(--border); background: var(--surface); }
nav.toc h1 { font-size: 15px; margin: 0 0 16px; }
nav.toc a { display: block; padding: 3px 8px; border-radius: 6px; color: var(--muted);
  text-decoration: none; font-size: 13px; }
nav.toc a:hover { background: var(--code-bg); color: var(--text); }
nav.toc a.lv3 { padding-left: 20px; font-size: 12.5px; }
main { padding: 40px 32px 120px; max-width: var(--max); }
h2 { margin: 56px 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--border); font-size: 24px; }
h2:first-child { margin-top: 0; }
h3 { margin: 36px 0 12px; font-size: 18px; }
h4 { margin: 24px 0 8px; font-size: 15px; }
p { margin: 12px 0; }
img { display: block; max-width: 100%; margin: 20px 0 8px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface); }
blockquote { margin: 16px 0; padding: 10px 16px; border-left: 3px solid var(--accent);
  background: var(--surface); color: var(--muted); }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
kbd { background: var(--surface); border: 1px solid var(--border); border-bottom-width: 2px;
  border-radius: 5px; padding: 1px 6px; font-family: inherit; font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; display: block;
  overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }
hr { border: none; border-top: 1px solid var(--border); margin: 40px 0; }
a { color: var(--accent); }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  nav.toc { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
  main { padding: 24px 16px 80px; }
}
`

async function main() {
  const files = await draftFiles()
  const parts = []
  const missingAll = new Set()
  for (const name of files) {
    const raw = await readFile(join(DRAFTS, name), 'utf8')
    const missing = await missingImages(raw)
    for (const item of missing) missingAll.add(item)
    const md = placeholderMd(raw, missing)
    const html = String(await processor.process(md))
    // 초안은 `../images/...` 로 이미지를 건다. index.html 은 images/ 와 같은 층이다.
    parts.push(html.replaceAll('../images/', 'images/'))
  }
  const body = parts.join('\n<hr>\n')
  const toc = outline(body)
    .map((item) => `<a class="lv${item.level.slice(1)}" href="#${item.id}">${item.text}</a>`)
    .join('\n')

  const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AXGentic Code Desktop 사용 가이드</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav class="toc">
<h1>AXGentic Code Desktop<br>사용 가이드</h1>
${toc}
</nav>
<main>
${body}
</main>
</div>
</body>
</html>
`
  await writeFile(OUT, page, 'utf8')

  // GitHub 판 — 초안을 그대로 잇는다. 이미지 경로만 이 파일 기준으로 고친다.
  const mdParts = []
  for (const name of files) {
    const raw = await readFile(join(DRAFTS, name), 'utf8')
    const md = placeholderMd(raw, await missingImages(raw))
    mdParts.push(md.replaceAll('../images/', 'images/').trim())
  }
  const readme = `# AXGentic Code Desktop 사용 가이드

> 이 문서는 \`docs/guide/drafts/*.md\` 에서 만들어집니다. 고칠 때는 초안을 고치고
> \`npm run guide:build\` 를 돌리세요. 오프라인 배포본은 같은 폴더의 \`index.html\` 입니다.

${mdParts.join('\n\n---\n\n')}
`
  await writeFile(OUT_MD, readme, 'utf8')

  console.log(`${files.length}개 장 →`)
  console.log(`  docs/guide/index.html  (${page.split('\n').length}줄)`)
  console.log(`  docs/guide/README.md   (${readme.split('\n').length}줄) — GitHub 에서 바로 렌더링`)
  if (missingAll.size > 0) {
    console.log(`\n아직 안 찍은 이미지 ${missingAll.size}장 (자리표시로 나갑니다):`)
    console.log(`  ${[...missingAll].sort().join(' ')}`)
  }
}

await main()
