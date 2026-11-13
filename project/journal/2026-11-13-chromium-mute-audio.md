# 2026-11-13: Chromium launches are muted

Jake (14:45 Cancun): "tell everyone to do headless chromium with volume off". The kit's KEYCHAIN_ARGS
(scripts/chromium-keychain.mjs) now carries --mute-audio, so every launch here that spreads it is muted, and the
source guard refuses a literal flag list that drops the mute. Byte copies of repo-kit d9f7f1b's files.
