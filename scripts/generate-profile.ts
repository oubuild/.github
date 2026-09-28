import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_PATH = resolve(ROOT, 'profile/data.yaml')
const README_PATH = resolve(ROOT, 'profile/README.md')
const JSON_PATH = resolve(ROOT, 'profile/projects.json')

const PROJECTS_START = '<!-- PROJECTS:START -->'
const PROJECTS_END = '<!-- PROJECTS:END -->'

const TYPES = ['self', 'adapted', 'deployed'] as const
const STATUSES = ['active', 'archived'] as const
const TYPE_EMOJI = {
  self: '🟢',
  adapted: '🟡',
  deployed: '🔵',
} as const

type ProjectType = (typeof TYPES)[number]
type ProjectStatus = (typeof STATUSES)[number]

interface LocalizedText {
  zh: string
  en: string
}

interface ProjectInput {
  id: string
  name: LocalizedText
  repo: string
  type: ProjectType
  status?: ProjectStatus
  demo?: string | null
  description: LocalizedText
  tags?: string[]
  year: number
  image?: string | null
  featured?: boolean
  hidden?: boolean
  source?: string | null
  video?: string | null
}

interface Project extends ProjectInput {
  status: ProjectStatus
  tags: string[]
  featured: boolean
  hidden: boolean
  source: string
  github: string
  readme: string
}

interface ProfileData {
  version: number
  profile: {
    name: string
    title: LocalizedText
  }
  projects: ProjectInput[]
}

function fail(message: string): never {
  console.error(`generate-profile: ${message}`)
  process.exit(1)
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function isLocalized(value: unknown): value is LocalizedText {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as LocalizedText).zh === 'string'
    && (value as LocalizedText).zh.trim()
    && typeof (value as LocalizedText).en === 'string'
    && (value as LocalizedText).en.trim(),
  )
}

function githubUrl(repo: string) {
  return `https://github.com/${repo}`
}

function normalizeProject(raw: ProjectInput): Project {
  const source = raw.source?.trim() || githubUrl(raw.repo)
  return {
    ...raw,
    status: raw.status ?? 'active',
    tags: raw.tags ?? [],
    featured: Boolean(raw.featured),
    hidden: Boolean(raw.hidden),
    demo: raw.demo ?? null,
    image: raw.image ?? null,
    video: raw.video ?? null,
    source,
    github: githubUrl(raw.repo),
    readme: `${source.replace(/\/$/, '')}#readme`,
  }
}

function validate(data: ProfileData) {
  if (data.version !== 1)
    fail('version must be 1')
  if (!data.profile?.name)
    fail('profile.name is required')
  if (!isLocalized(data.profile.title))
    fail('profile.title.zh and profile.title.en are required')
  if (!Array.isArray(data.projects) || data.projects.length === 0)
    fail('projects must be a non-empty array')

  const ids = new Set<string>()
  const repos = new Set<string>()

  for (const [index, project] of data.projects.entries()) {
    const where = `projects[${index}]`
    if (!project.id?.trim())
      fail(`${where}.id is required`)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.id))
      fail(`${where}.id must be kebab-case: ${project.id}`)
    if (ids.has(project.id))
      fail(`duplicate id: ${project.id}`)
    ids.add(project.id)

    if (!isLocalized(project.name))
      fail(`${where}.name.zh and name.en are required`)
    if (!project.repo?.includes('/'))
      fail(`${where}.repo must look like owner/name`)
    const repoKey = project.repo.toLowerCase()
    if (repos.has(repoKey))
      fail(`duplicate repo: ${project.repo}`)
    repos.add(repoKey)

    if (!TYPES.includes(project.type))
      fail(`${where}.type must be self | adapted | deployed`)
    if (project.status && !STATUSES.includes(project.status))
      fail(`${where}.status must be active | archived`)
    if (!isLocalized(project.description))
      fail(`${where}.description.zh and description.en are required`)
    if (!Number.isInteger(project.year) || project.year < 2000)
      fail(`${where}.year must be a valid year`)
    if (project.demo && !isHttpUrl(project.demo))
      fail(`${where}.demo is not a valid URL: ${project.demo}`)
    if (project.source && !isHttpUrl(project.source))
      fail(`${where}.source is not a valid URL: ${project.source}`)
  }
}

function markdownLink(label: string, href?: string | null) {
  if (!href)
    return '-'
  return `[${label}](${href})`
}

function renderProjectsTable(projects: Project[]) {
  const visible = projects.filter(project => !project.hidden)
  const rows = visible.map((project) => {
    const demo = markdownLink('Demo', project.demo)
    const source = markdownLink('Source', project.source)
    return `| ${project.name.zh} | ${demo} | ${source} | ${TYPE_EMOJI[project.type]} |`
  })

  return [
    '| Project | Demo | Source | Type |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function defaultReadme() {
  return `# Oubuild

> This file is automatically generated from \`profile/data.yaml\`.
> Do not edit the projects table manually.

> 发现优秀项目，构建并部署个人项目。

**Discover · Build · Deploy**

探索有趣的开源项目，实践新技术，并把想法真正部署上线。

## 🚀 Deployed Projects

**🟢 自研项目 · 🟡 开源改造 · 🔵 开源部署**

${PROJECTS_START}

${PROJECTS_END}

## 🧪 About

Oubuild 是一个开源实验室：发现有趣的项目，动手改造，并把结果部署上线。
`
}

function updateReadme(projects: Project[]) {
  const current = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf8') : defaultReadme()
  let next = current.includes(PROJECTS_START) && current.includes(PROJECTS_END)
    ? current
    : defaultReadme()

  const generated = `\n${renderProjectsTable(projects)}\n`
  next = next.replace(
    new RegExp(`${PROJECTS_START}[\\s\\S]*?${PROJECTS_END}`),
    `${PROJECTS_START}\n${generated}${PROJECTS_END}`,
  )

  writeFileSync(README_PATH, next.endsWith('\n') ? next : `${next}\n`)
}

function writeJson(data: ProfileData, projects: Project[]) {
  mkdirSync(dirname(JSON_PATH), { recursive: true })
  const payload = {
    version: data.version,
    generatedAt: new Date().toISOString(),
    profile: data.profile,
    projects: projects.map(({ github, readme, ...project }) => ({
      ...project,
      github,
      readme,
    })),
  }
  writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`)
}

function main() {
  if (!existsSync(DATA_PATH))
    fail(`missing ${DATA_PATH}`)

  const data = parse(readFileSync(DATA_PATH, 'utf8')) as ProfileData
  validate(data)
  const projects = data.projects.map(normalizeProject)
  updateReadme(projects)
  writeJson(data, projects)
  console.log(`generated ${projects.length} projects → profile/README.md, profile/projects.json`)
}

main()
