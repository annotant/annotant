#!/usr/bin/env node
// migrate.mjs --project <dir>
// Moves a project installed under one of the skill's former names
// (code-buddy, live-feedback) to annotant: config file, comments folder,
// loader marker and .gitignore entry.
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CONFIG_FILE, servedProject } from './lib/project.mjs'

/** The former names, newest first. */
const LEGACIES = [
  { name: 'code-buddy', loader: 'codeBuddyLoader' },
  { name: 'live-feedback', loader: 'liveFeedbackLoader' },
]
const NAME = 'annotant'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--project')
const root = path.resolve(flag === -1 ? process.cwd() : argv[flag + 1])
/** @param {string} file */
const at = (file) => path.join(root, file)

if (existsSync(at(CONFIG_FILE))) {
  console.log(`nothing to migrate: ${CONFIG_FILE} already exists`)
  process.exit(0)
}
const legacy = LEGACIES.find(({ name }) => existsSync(at(`.${name}.json`)))
if (!legacy) {
  const names = LEGACIES.map(({ name }) => `.${name}.json`).join(' or ')
  console.log(`nothing to migrate: no ${names} in ${root}`)
  process.exit(0)
}
const legacyConfig = at(`.${legacy.name}.json`)

const config = JSON.parse(await readFile(legacyConfig, 'utf8'))
const port = config.port ?? 4599
try {
  if ((await servedProject(port)) === root) {
    console.error(
      `a ${legacy.name} session still serves this project on port ${port}: close it, then migrate again`,
    )
    process.exit(3)
  }
} catch {}

const done = []
const oldDir = `.${legacy.name}`
const newDir = `.${NAME}`
if (!config.commentsFile || config.commentsFile.startsWith(`${oldDir}/`)) {
  config.commentsFile = `${newDir}/comments.json`
  if (existsSync(at(oldDir))) {
    if (existsSync(at(newDir))) {
      console.error(`both ${oldDir}/ and ${newDir}/ exist: merge them by hand`)
      process.exit(1)
    }
    await rename(at(oldDir), at(newDir))
    done.push(`moved ${oldDir}/ to ${newDir}/`)
  }
}

for (const file of config.loader ?? []) {
  const source = await readFile(at(file), 'utf8').catch(() => undefined)
  if (source?.includes(legacy.loader)) {
    await writeFile(at(file), source.replaceAll(legacy.loader, `${NAME}Loader`))
    done.push(`updated the loader in ${file}`)
  }
}

const gitignore = await readFile(at('.gitignore'), 'utf8').catch(() => undefined)
if (gitignore?.includes(`${oldDir}/`)) {
  await writeFile(
    at('.gitignore'),
    gitignore
      .replaceAll(`${oldDir}/`, `${newDir}/`)
      .replaceAll(`# ${legacy.name} skill`, `# ${NAME} skill`),
  )
  done.push('updated .gitignore')
}

await writeFile(at(CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`)
await rm(legacyConfig)
done.push(`renamed .${legacy.name}.json to ${CONFIG_FILE}`)
console.log(done.map((line) => `- ${line}`).join('\n'))
