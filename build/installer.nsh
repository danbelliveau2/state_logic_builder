; Custom NSIS hooks for SDC State Logic Builder installer.
;
; Problem: Rapid auto-updates (multiple versions released same day) combined with
; the double-trigger bug (autoInstallOnAppQuit + explicit quitAndInstall) caused
; two NSIS processes to run simultaneously. The first deleted the old install files;
; the second failed to find them, aborted, and left the registry pointing to an
; empty directory. Every subsequent upgrade then fails with error code 2 because
; the old uninstaller no longer exists at the registry path.
;
; Fix: Define the customUnInstallCheckCurrentUser hook (per-user install = HKCU).
; When electron-builder's handleUninstallResult detects this macro exists, it calls
; it and returns early — skipping the "Quit" on failed uninstall. The new version
; installs fresh rather than aborting. If the old version WAS intact, its uninstaller
; still ran before this hook is checked, so clean upgrades are unaffected.

!macro customUnInstallCheck
  ; Machine-wide install (HKLM) — skip error, proceed with fresh install
!macroend

!macro customUnInstallCheckCurrentUser
  ; Per-user install (HKCU) — skip error, proceed with fresh install
!macroend
