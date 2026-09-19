#!/usr/bin/env node
// Interactive release script for @fetaoily/nest-mqtt.
// Run via `npm run release` in a real terminal window: npm publish needs a TTY
// for the WebAuthn (Windows Hello) 2FA browser flow to trigger.

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'

const REGISTRY = 'https://registry.npmjs.org'
const pkgPath = new URL('../package.json', import.meta.url)

// Rollback state: package.json must not keep a bumped version if nothing was
// published (abort, Ctrl+C, build or publish failure).
let rawPackageJson = null
let bumped = false
let published = false

function restorePackageJson() {
  if (!bumped || published || rawPackageJson === null) return false
  try {
    writeFileSync(pkgPath, rawPackageJson, 'utf8')
  } catch {
    console.error('WARNING: failed to restore package.json - fix its version field manually.')
    return false
  }
  bumped = false
  console.log('package.json restored (version bump rolled back).')
  return true
}

function abort() {
  if (restorePackageJson()) {
    console.error('\nAborted, nothing published.')
  } else {
    console.error('\nAborted.')
  }
  process.exit(130)
}

// `npm run` exports every CLI flag it receives as npm_config_* env vars, and
// the spawned npm publish would silently adopt them (e.g. `npm run release
// --dry-run` would turn the real publish into a dry run). Strip them so the
// child only sees config passed explicitly below.
function childEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_config_')) delete env[key]
  }
  return env
}

function run(args, { capture = false } = {}) {
  // shell: true is required on Windows to spawn npm.cmd
  const child = spawn('npm', args, {
    shell: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: childEnv(),
  })
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    if (capture) {
      child.stdout.on('data', chunk => (out += chunk))
      child.stderr.on('data', chunk => (err += chunk))
    }
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve(capture ? { out, err } : out)
      } else {
        reject(new Error(`npm ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

/** npm view that resolves to trimmed stdout, or null when the lookup failed (e.g. 404, offline). */
async function viewOrNull(args) {
  try {
    return (await run(args, { capture: true })).out.trim()
  } catch {
    return null
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  process.on('SIGINT', abort)

  if (!stdin.isTTY || !stdout.isTTY) {
    console.error(
      'This script must run in a real interactive terminal: npm publish needs a\n' +
        'TTY for the WebAuthn (Windows Hello) 2FA browser flow. Run `npm run release`\n' +
        'from your own terminal window instead.'
    )
    process.exitCode = 1
    return
  }

  // node:readline/promises exists only on Node >= 17; fail with guidance
  // instead of a raw module-not-found stack.
  let createInterface
  try {
    ;({ createInterface } = await import('node:readline/promises'))
  } catch {
    console.error('Node.js >= 17 is required (node:readline/promises is not available).')
    process.exitCode = 1
    return
  }

  rawPackageJson = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(rawPackageJson)
  console.log(`Package: ${pkg.name}  current version: ${pkg.version}`)

  const rl = createInterface({ input: stdin, output: stdout })
  rl.on('SIGINT', abort)
  let answer
  try {
    answer = (await rl.question('New version (Enter to keep current): ')).trim()
  } finally {
    rl.close()
  }

  let version = pkg.version
  if (answer) {
    // Character allowlist only: keeps hostile input away from the shell spawn
    // below. What counts as a valid semver is decided by `npm version` itself.
    if (!/^[0-9A-Za-z.+-]+$/.test(answer)) {
      console.error(`"${answer}" contains characters that are not allowed in a version.`)
      process.exitCode = 1
      return
    }
    // `npm version` validates with the real semver parser and rewrites
    // package.json without touching git (accepts 1.0.7-beta-1, 1.0.7+build.2).
    await run(['version', answer, '--no-git-tag-version'])
    version = answer
    bumped = true
  } else {
    // "Keep current version" only makes sense if it is not on npm yet.
    const exists = await viewOrNull([
      'view',
      `${pkg.name}@${pkg.version}`,
      'version',
      `--registry=${REGISTRY}`,
    ])
    if (exists === pkg.version) {
      console.error(
        `\n${pkg.name}@${pkg.version} is already published on npm.\n` +
          'Run again and enter a new version number.'
      )
      process.exitCode = 1
      return
    }
    if (exists === null) {
      console.log('(could not check the registry just now; continuing anyway)')
    } else {
      console.log(`${pkg.name}@${pkg.version} is not on npm yet.`)
    }
  }

  // A prerelease must never take over the `latest` dist-tag; the explicit tag
  // also ignores any `tag=` setting from user .npmrc files.
  const tag = version.includes('-') ? 'next' : 'latest'
  const publishArgs = ['publish', '--access=public', `--tag=${tag}`, `--registry=${REGISTRY}`]

  console.log('\n[1/4] Building...')
  try {
    await run(['run', 'build'])

    console.log('\n[2/4] Dry run preview:')
    await run([...publishArgs, '--dry-run'])
  } catch (err) {
    restorePackageJson()
    throw err
  }

  const rlConfirm = createInterface({ input: stdin, output: stdout })
  rlConfirm.on('SIGINT', abort)
  let confirm
  try {
    confirm = (await rlConfirm.question(`\nPublish ${pkg.name}@${version} (dist-tag: ${tag})? (y/N): `))
      .trim()
      .toLowerCase()
  } finally {
    rlConfirm.close()
  }
  if (confirm !== 'y' && confirm !== 'yes') {
    restorePackageJson()
    console.log('Aborted, nothing published.')
    return
  }

  console.log('\n[3/4] Publishing... (a browser window may open for 2FA)')
  try {
    await run(publishArgs)
    published = true
  } catch (err) {
    restorePackageJson()
    throw err
  }

  console.log('\n[4/4] Verifying...')
  let seen = null
  for (let attempt = 1; attempt <= 3 && seen !== version; attempt++) {
    if (attempt > 1) {
      console.log(`  read-back attempt ${attempt}/3 (registry caches can lag)...`)
      await sleep(10_000)
    }
    seen = await viewOrNull(['view', `${pkg.name}@${version}`, 'version', `--registry=${REGISTRY}`])
  }
  if (seen === version) {
    console.log(`Done: ${pkg.name}@${seen} is live (dist-tag: ${tag}).`)
  } else {
    // The publish itself exited 0; only the read-back could not keep up.
    console.log(
      'Publish succeeded, but automatic verification could not confirm it yet.\n' +
        `Check manually at ${REGISTRY}/package/${pkg.name} (registry caches can lag for a few minutes).`
    )
  }
}

main().catch(err => {
  console.error(err.message)
  process.exitCode = 1
})
