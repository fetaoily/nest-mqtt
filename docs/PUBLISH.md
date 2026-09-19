# Publishing a Release

How to publish `@fetaoily/nest-mqtt` to npm, including the 2FA pitfalls hit
when publishing 1.0.6 (2026-08-25).

## Standard release flow

1. Run the interactive release script **in a real terminal window** (Node >= 17
   required):

   ```powershell
   npm run release
   ```

2. The script will:
   - prompt for the new version, validated by `npm version` (Enter keeps the
     current version, but only if that version is not already on npm),
   - build `dist/` and show a dry-run preview of the tarball,
   - publish only after an explicit `y` confirmation; prereleases (`1.2.3-rc.1`)
     go out under the `next` dist-tag, stable versions under `latest`,
   - roll the `package.json` bump back if the publish is aborted or fails,
   - verify the published version with `npm view`, retrying a few times because
     the registry cache can lag for a few minutes after a publish.
3. Commit the version bump and script changes afterwards.

## 2FA notes (why it must run in a real terminal)

The npm account uses a **security key / WebAuthn** (Windows Hello PIN popup)
for 2FA. Consequences:

- `--otp=123456` never works. One-time passwords come from TOTP authenticator
  apps, and this account does not use one; WebAuthn publishes go through the
  browser instead. `npm login --auth-type=web` does not apply to `npm publish`.
- `npm publish` only opens the browser for WebAuthn when stdin and stdout are a
  TTY. In non-interactive shells (embedded tool shells, CI) npm fails
  immediately with `EOTP` and no popup appears.
- After a successful verification, npm skips the 2FA prompt for ~5 minutes for
  the same IP + token, so consecutive publishes in that window need no prompt.

## PowerShell execution policy

The default `Restricted` policy blocks `npm.ps1` (nvm4w installs npm as a
`.ps1`), failing with "running scripts is disabled on this system". Either:

- call `npm.cmd` instead of `npm`, or
- allow local scripts for the current user (once):

  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

## Never name a package.json script "publish"

`publish` is one of npm's reserved lifecycle hooks and runs automatically on
every `npm publish` (after the tarball is uploaded). A script named `publish`
that itself calls `npm publish` therefore recurses: one real publish triggers
another publish attempt that the registry rejects (version already exists),
and a `--dry-run` loops through build+pack cycles over and over. That is why
this package uses `release` (scripts/publish.mjs) instead of a `publish`
script.

## Notes

- The tarball is built from the `files` whitelist in `package.json` (`dist`,
  `package.json`, `README.md`). Three layers keep `.tsbuildinfo` files out of
  it: `tsconfig.build.json` disables `incremental` entirely, the base
  `tsconfig.json` writes its own buildinfo outside `dist` and excludes `test/`,
  and the whitelist negates `!dist/**/*.tsbuildinfo` as packaging-layer
  enforcement.
- `prepublishOnly` runs `npm run build`, so even a direct `npm publish` ships a
  freshly built `dist/` instead of whatever is on disk.
- `npm pkg fix` has been applied and `repository.url` is stored in the
  normalized `git+https://...git` form, so npm no longer prints its "npm
  auto-corrected some errors" warning at publish time. If the warning ever
  reappears, run `npm pkg fix` and commit the result.
