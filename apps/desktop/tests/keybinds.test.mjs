import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";

async function setup(label = "main") {
  let effect;
  const shortcuts = new Map();
  const calls = [];
  const state = {
    visible: true,
    setAppVisible(value) {
      this.visible = value;
    },
  };
  state.setAppVisible = value => {
    state.visible = value;
  };
  const mocks = {
    react: {
      useEffect: callback => {
        effect = callback;
      },
    },
    "@tauri-apps/api/webviewWindow": { getCurrentWebviewWindow: () => ({ label }) },
    "@tauri-apps/api/core": { invoke: async command => calls.push(command) },
    "@/store": { useAppStore: { getState: () => state } },
    "@tauri-apps/plugin-global-shortcut": {
      register: async (key, callback) => {
        assert.ok(!shortcuts.has(key), "must not register twice");
        shortcuts.set(key, callback);
      },
      unregister: async key => {
        shortcuts.delete(key);
      },
    },
  };
  const source = await readFile(new URL("../src/hooks/use-keybinds.ts", import.meta.url), "utf8");
  const module = new SourceTextModule(stripTypeScriptTypes(source));
  await module.link(specifier => {
    const exports = mocks[specifier];
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  module.namespace.useKeybinds();
  return { mount: () => effect(), shortcuts, calls, state };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const PIN = "Alt+D";
const HIDE = "CommandOrControl+Shift+G";

test("visibility toggles once per keypress; native recovery shortcuts are left alone", async () => {
  const app = await setup();
  const cleanup = app.mount();
  await settle();
  assert.equal(app.shortcuts.has(PIN), false);
  assert.equal(app.shortcuts.has("CommandOrControl+Shift+O"), false);
  app.shortcuts.get(HIDE)({ state: "Pressed" });
  assert.equal(app.state.visible, false);
  app.shortcuts.get(HIDE)({ state: "Released" });
  assert.equal(app.state.visible, false);
  app.shortcuts.get(HIDE)({ state: "Pressed" });
  assert.equal(app.state.visible, true);
  cleanup();
  await settle();
  assert.equal(app.shortcuts.size, 0);
});

test("settings does not register or steal the main window shortcuts", async () => {
  const app = await setup("settings");
  assert.equal(app.mount(), undefined);
  await settle();
  assert.equal(app.shortcuts.size, 0);
});

test("effect replay and remount preserve registration ownership", async () => {
  const app = await setup();
  app.mount()();
  const cleanup = app.mount();
  await settle();
  assert.equal(app.shortcuts.size, 1);
  const oldHandler = app.shortcuts.get(HIDE);
  cleanup();
  const finalCleanup = app.mount();
  oldHandler({ state: "Pressed" });
  await settle();
  assert.equal(app.shortcuts.size, 1);
  assert.equal(app.state.visible, true);
  app.shortcuts.get(HIDE)({ state: "Pressed" });
  assert.equal(app.state.visible, false);
  finalCleanup();
  await settle();
  assert.equal(app.shortcuts.size, 0);
});
