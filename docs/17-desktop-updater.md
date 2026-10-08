# Desktop Updater

## Goal

Know Me Desktop uses the updater core provided by Wails Desktop Kit to make Windows user-scope upgrades a normal in-app flow:

```text
About
  -> Check GitHub Release
  -> Download Setup
  -> Verify SHA256
  -> Install and restart
```

The web/server product does not expose desktop update endpoints. The updater API is registered only when the Wails desktop wrapper injects a desktop update service.

## Runtime behavior

### Windows user-scope installation

The About page can:

1. Check for a newer GitHub Release.
2. Download the matching `*-windows-amd64-setup.exe`.
3. Verify the GitHub digest or `.sha256` sidecar through Desktop Kit.
4. Call `updater.InstallAndRestart`.
5. Launch Setup with the current process PID.
6. Exit Know Me normally through `desktopkit.Controller.Quit()`.
7. Let Setup wait for the old process, overwrite the installation and restart Know Me.

### Portable Windows

Portable builds may check and download an update, but automatic self-overwrite is rejected by Desktop Kit. The UI tells the user to run the downloaded Setup manually.

### Windows machine-scope installation

Machine-scope installations may check and download an update, but automatic installation is disabled to avoid silently introducing elevation behavior.

### Linux and macOS

Check, download and SHA256 verification are supported for the matching release asset. Automatic installation is not enabled yet.

## Security and isolation

- Desktop update endpoints are available only in the embedded desktop Core.
- Ordinary `know-me serve` instances return 404 for `/api/desktop/update`.
- All desktop update endpoints require an authenticated Know Me session.
- Mutating update endpoints require a same-origin request.
- Download verification is performed by Desktop Kit before an installer can be launched.
- `InstallAndRestart` re-verifies Setup filename, size and SHA256 immediately before launch.
- Know Me does not force-kill itself. It launches the installer, saves/cleans up through normal shutdown, then calls `Controller.Quit()`.
- Active downloads are canceled during desktop shutdown.

## v0.1.7-rc.1 validation

Source commit:

```text
34c138b feat: add desktop updater UI and install flow
```

Desktop packaging validation:

```text
GitHub Actions run: 36438939966
Result: success

Windows amd64: success
Linux amd64: success
macOS universal: success
```

Release validation:

```text
GitHub Actions run: 36439459587
Result: success
Release: v0.1.7-rc.1 (pre-release)
```

Windows Setup:

```text
know-me-desktop-v0.1.7-rc.1-windows-amd64-setup.exe
SHA256: 5468e11599121495d3e988d197654d058e4eb8d4f138f96aab62a97b635500c4
```

Local gates before RC1:

```text
npm run typecheck                 PASS
npm run native:web:build          PASS
go test ./...                     PASS
go vet ./...                      PASS
go test -race -count=1 ./...      PASS
git diff --check                  PASS
Windows Wails production build    PASS
```

## RC1 -> RC2 full update E2E

RC2 intentionally keeps the updater implementation unchanged apart from documentation/build metadata so that the test isolates the update mechanism itself.

Acceptance flow:

```text
Install v0.1.7-rc.1 user-scope Setup
  -> start rc.1
  -> preserve isolated test data
  -> open About
  -> Check update
  -> discover v0.1.7-rc.2
  -> Download and verify
  -> SHA256 verified
  -> Install and restart
  -> rc.1 exits normally
  -> Setup waits for old PID
  -> overwrite user-scope installation
  -> rc.2 starts automatically
  -> About reports v0.1.7-rc.2
  -> isolated test data still exists
```

The E2E must also confirm that the update does not place business data under the application installation directory.

## Isolated installed-updater E2E (2026-10-08)

The Windows Actions runner executed the released RC1 installer, called the authenticated desktop updater API, and confirmed the installed executable was replaced and restarted as RC2.

- Source: `v0.1.7-rc.1` Windows user-scope Setup downloaded from GitHub Release, with SHA256 verified before execution.
- Update: discovered `v0.1.7-rc.2`, downloaded its Windows Setup and passed Desktop Kit SHA256 verification.
- Lifecycle: accepted InstallAndRestart, old process exited, new process served a healthy API reporting `v0.1.7-rc.2`.
- Data: the marker placed under `~/.config/know-me/data` survived the upgrade, and the application installation directory did not contain business data.
- CI job: https://github.com/wanstu/know_me/actions/runs/37782768613/job/113329790880 (`success`).
- Script: `scripts/verify-desktop-updater-e2e.ps1`, manually triggered by `workflow_dispatch` with `updater_e2e=true`.

This verifies the real installed update backend and process lifecycle, using authenticated loopback HTTP actions rather than automated mouse clicks. Visual About page interaction and accessibility remain separate UI checks.
