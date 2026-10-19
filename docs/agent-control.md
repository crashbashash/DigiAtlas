# Direct desktop control

This opt-in interface operates the real Tauri webview and native importer. It does
not move the pointer, send desktop keys, use the clipboard or bring a control into
OS focus. DOM clicks/changes affect only DigiAtlas. Normal builds contain no agent
commands or listener.

Build and start it with a new private session file:

```sh
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --features agent-control,custom-protocol
python3 tools/agent.py --session .local/session.json start --binary src-tauri/target/debug/digiatlas
python3 tools/agent.py --session .local/session.json snapshot
python3 tools/agent.py --session .local/session.json navigate '#/calculators/power-down'
python3 tools/agent.py --session .local/session.json load-save /path/to/card.ps2
python3 tools/agent.py --session .local/session.json select 'Save box' '0:1'
python3 tools/agent.py --session .local/session.json fill Wisdom 1000
python3 tools/agent.py --session .local/session.json select 'Target enemy' Goburimon
python3 tools/agent.py --session .local/session.json click 'Show power down chance formula'
python3 tools/agent.py --session .local/session.json import-iso /path/to/game.iso
```

`start --open HASH` chooses the first view; `start --iso PATH` imports on startup.
`load-save` supplies a File to the same file input and change handler the user uses;
it doesn't inject computed stats. `import-iso` supplies the next file-picker result
and clicks the real importer UI. Import progress and completion can be observed by
`snapshot`/`eval`; file import is asynchronous.

`select` operates the shared custom pickers as well as native selects. It opens
the real picker and chooses its option by value or exact label.

`eval` takes an async JavaScript function body, using `return` for results:

```sh
python3 tools/agent.py --session .local/session.json eval 'return document.title;'
```

The listener binds only to loopback and requires a random bearer token. Session
files are created exclusively with mode 0600 and must stay outside version
control. The start helper chooses an available port. Scripts are evaluated through
the native webview without weakening its content-security policy. Save/card reads
are limited to regular files of at most 128 MiB. These commands are absent from a
build without `agent-control`; `DIGIATLAS_AGENT_TOKEN` is required to start a listener.
