# RPC regressions

Shortcut recovery regressions (keypress/release handling, window ownership, and effect cleanup):

```sh
node --experimental-vm-modules --test apps/desktop/tests/keybinds.test.mjs
```

From the repository root, with Node 22.13 or newer:

```sh
node --experimental-vm-modules --test apps/desktop/tests/rpc-manager.test.mjs
```

The harness loads the actual TypeScript manager and store using Node's TypeScript
transform. Native transport, React, telemetry, timers and Zustand/Immer wiring are
test doubles. It checks channel-switch message ordering, stale events, membership,
and speaking state without connecting to Discord. It does not replace a Tauri
build or a live Discord smoke test. Node's experimental API warnings are expected.
