#!/usr/bin/env node
// Interactive release script for @fetaoily/nest-mqtt.
// Run via `npm run release` in a real terminal window: npm publish needs a TTY
// for the WebAuthn (Windows Hello) 2FA browser flow to trigger.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'

const REGISTRY = 'https://registry.npmjs.org'
const pkgPath = new URL('../package.json', import.meta.url)

function run(args, { capture = false } = {}) {
  // shell: true is required on Windows to spawn npm.cmd
  const child = spawn('npm', args, {
    shell: true,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  return new Promise((resolve, reject) => {
    let out = ''
    if (capture) {
      child.stdout.on('data', chunk => (out += chunk))
    }
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve(out)
      } else {
        reject(new Error(`npm ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error(
      'This script must run in a real interactive terminal: npm publish needs a\n' +
        'TTY for the WebAuthn (Windows Hello) 2FA browser flow. Run `npm run release`\n' +
        'from your own terminal window instead.'
    )
    process.exitCode = 1
    return
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  console.log(`Package: ${pkg.name}  current version: ${pkg.version}`)

  const rl = createInterface({ input: stdin, output: stdout })
  const answer = (await rl.question('New version (Enter to keep current): ')).trim()
  if (answer) {
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(answer)) {
      console.error(`"${answer}" does not look like a semver version.`)
      process.exitCode = 1
      rl.close()
      return
    }
    const raw = await readFile(pkgPath, 'utf8')
    await writeFile(pkgPath, raw.replace(/"version":\s*"[^"]+"/, `"version": "${answer}"`), 'utf8')
    pkg.version = answer
    console.log(`package.json updated to ${answer}`)
  }
  rl.close()

  console.log('\n[1/4] Building...')
  await run(['run', 'build'])

  console.log('\n[2/4] Dry run preview:')
  await run(['publish', '--dry-run', '--access=public', `--registry=${REGISTRY}`])

  const rlConfirm = createInterface({ input: stdin, output: stdout })
  await rlConfirm.question(
    `\nPublish ${pkg.name}@${pkg.version} to npm? (Enter to continue, Ctrl+C to abort): `
  )
  rlConfirm.close()

  console.log('\n[3/4] Publishing... (a browser window may open for 2FA)')
  await run(['publish', '--access=public', `--registry=${REGISTRY}`])

  console.log('\n[4/4] Verifying...')
  const published = (
    await run(['view', `${pkg.name}@${pkg.version}`, 'version', `--registry=${REGISTRY}`], {
      capture: true,
    })
  ).trim()
  if (published === pkg.version) {
    console.log(`Done: ${pkg.name}@${published} is live.`)
  } else {
    console.error(`Unexpected npm view output: "${published}" - verify manually.`)
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(err.message)
  process.exitCode = 1
})
