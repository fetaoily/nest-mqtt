# Publishing a Release

How to publish `@fetaoily/nest-mqtt` to npm, including the 2FA pitfalls hit
when publishing 1.0.6 (2026-08-25).

## Standard release flow

1. Run the interactive release script **in a real terminal window**:

   ```powershell
   npm run release
   ```

2. The script will:
   - prompt for the new version and update `package.json` (Enter keeps the current version),
   - build `dist/`,
   - show a dry-run of the tarball contents and wait for confirmation,
   - run `npm publish --access=public --registry=https://registry.npmjs.org`,
   - verify the published version with `npm view`.
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
  `package.json`, `README.md`). `tsconfig.build.json` disables `incremental`
  so no `.tsbuildinfo` is written into `dist` (it used to ship in the tarball
  as a 147 kB junk file); the build wipes `dist` on every run anyway.
- npm prints a harmless warning about normalizing `repository.url` when
  publishing; it auto-corrects the shorthand URL at publish time.
