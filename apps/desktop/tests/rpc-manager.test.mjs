import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

// Exercise the real manager/store with native transports and React mocked out.
// No Discord connection or installed frontend dependencies are needed.
async function setup() {
  const sent = [];
  const events = [];
  let nonce = 0;
  const context = createContext({
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: { localStorage: {}, location: { hash: "#/channel" } },
  });
  const create = () => initializer => {
    let state;
    const set = update => {
      const next = typeof update === "function" ? update(state) : update;
      if (next) state = { ...state, ...next };
    };
    state = initializer(set);
    return { getState: () => state, setState: set };
  };
  const mocks = {
    zustand: { create },
    "zustand/middleware/immer": { immer: value => value },
    immer: { enableMapSet: () => {} },
    "@tauri-apps/plugin-http": {
      fetch: () => {
        throw new Error("Unexpected HTTP");
      },
    },
    "@tauri-apps/plugin-os": { type: () => "windows" },
    uuid: { v4: () => String(++nonce) },
    "@tauri-apps/plugin-websocket": { default: {} },
    "react-router-dom": { useNavigate() {}, useLocation() {} },
    react: { useEffect() {}, useRef() {} },
    "@/metrics": { Metric: {}, track() {}, trackEvent() {} },
    "@tauri-apps/api/event": { emit: async (...args) => events.push(args) },
    "@/constants": { Event: { UserLogUpdate: "user-log-update" } },
    "@tauri-apps/api/app": { getVersion: async () => "test" },
    "@/utils/crypto": { hash: async value => value },
    "@tauri-apps/api/core": { invoke: async () => {} },
  };
  const cache = new Map();
  async function load(specifier) {
    if (cache.has(specifier)) return cache.get(specifier);
    let module;
    if (mocks[specifier]) {
      const exports = mocks[specifier];
      module = new SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        },
        { context }
      );
    } else {
      const paths = {
        manager: "../src/rpc/manager.ts",
        "../store": "../src/store.ts",
        "./command": "../src/rpc/command.ts",
        "./event": "../src/rpc/event.ts",
        "./errors": "../src/rpc/errors.ts",
      };
      assert.ok(paths[specifier], `Unexpected import: ${specifier}`);
      const source = await readFile(new URL(paths[specifier], import.meta.url), "utf8");
      module = new SourceTextModule(
        stripTypeScriptTypes(source, { mode: "transform" }) +
          (specifier === "manager" ? "\nexport { SocketManager };" : ""),
        { context }
      );
    }
    cache.set(specifier, module);
    await module.link(load);
    return module;
  }
  const module = await load("manager");
  await module.evaluate();
  const manager = new module.namespace.SocketManager();
  manager.isConnected = manager.authenticated = true;
  manager.socket = { send: async value => sent.push(JSON.parse(value)) };
  const store = cache.get("../store").namespace.useAppStore;
  store.getState().setMe({ id: "me" });
  const receive = payload => manager.onMessage({ type: "Text", data: JSON.stringify(payload) }, 0);
  const reply = async channel => {
    const request = sent.findLast(item => item.cmd === "GET_SELECTED_VOICE_CHANNEL");
    assert.ok(request, "expected a selected-channel request");
    await receive({ cmd: request.cmd, nonce: request.nonce, data: channel });
  };
  const select = id => receive({ cmd: "DISPATCH", evt: "VOICE_CHANNEL_SELECT", data: { channel_id: id } });
  manager.requestUserChannel();
  await reply(channel("old", "old-user"));
  return { manager, store, sent, events, receive, reply, select };
}

const user = id => ({ user: { id }, nick: id, voice_state: {}, volume: 100 });
const channel = (id, ...ids) => ({ id, name: id, type: 2, voice_states: ids.map(user) });
const ids = store => Object.keys(store.getState().users).sort();

test("switch clears old members, unsubscribes old channel, and rejects its late events", async () => {
  const h = await setup();
  await h.select("new");
  assert.deepEqual(ids(h.store), []);
  assert.ok(h.sent.some(p => p.cmd === "UNSUBSCRIBE" && p.args.channel_id === "old"));
  await h.reply(channel("new", "new-user"));
  for (const evt of ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"]) {
    await h.receive({ cmd: "DISPATCH", evt, data: { ...user("old-user"), channel_id: "old" } });
  }
  assert.deepEqual(ids(h.store), ["new-user"]);
  assert.equal(h.store.getState().currentChannel.id, "new");
});

test("late snapshots and subscription acknowledgements cannot restore a previous channel", async () => {
  const h = await setup();
  h.manager.resync();
  const stale = h.sent.at(-1);
  await h.select("new");
  await h.reply(channel("new", "new-user"));
  await h.receive({ cmd: stale.cmd, nonce: stale.nonce, data: channel("old", "old-user") });
  await h.receive({ cmd: "SUBSCRIBE", evt: "VOICE_STATE_CREATE", data: user("old-user") });
  assert.deepEqual(ids(h.store), ["new-user"]);
});

test("leaving clears channel and rejects late snapshots and voice events", async () => {
  const h = await setup();
  const stale = h.sent.find(p => p.cmd === "GET_SELECTED_VOICE_CHANNEL");
  await h.select(null);
  await h.receive({ cmd: stale.cmd, nonce: stale.nonce, data: channel("old", "old-user") });
  await h.receive({ cmd: "DISPATCH", evt: "VOICE_STATE_CREATE", data: user("old-user") });
  assert.deepEqual(ids(h.store), []);
  assert.equal(h.store.getState().currentChannel, null);
});

test("unscoped membership events refresh the selected snapshot instead of merging users", async () => {
  const h = await setup();
  await h.receive({ cmd: "DISPATCH", evt: "VOICE_STATE_CREATE", data: user("stray-user") });
  assert.deepEqual(ids(h.store), ["old-user"]);
  await h.reply(channel("old", "old-user", "joined-user"));
  assert.deepEqual(ids(h.store), ["joined-user", "old-user"]);
});

test("empty selected-channel response clears the roster", async () => {
  const h = await setup();
  h.manager.requestUserChannel();
  await h.reply(null);
  assert.deepEqual(ids(h.store), []);
  assert.equal(h.store.getState().currentChannel, null);
});

test("rapid switches accept only the most recent channel request", async () => {
  const h = await setup();
  await h.select("middle");
  const middle = h.sent.at(-1);
  await h.select("new");
  await h.reply(channel("new", "new-user"));
  await h.receive({ cmd: middle.cmd, nonce: middle.nonce, data: channel("middle", "middle-user") });
  assert.deepEqual(ids(h.store), ["new-user"]);
  assert.equal(h.manager.currentChannelId, "new");
});

test("events during a snapshot coalesce into one follow-up refresh and retain join history", async () => {
  const h = await setup();
  const event = { cmd: "DISPATCH", evt: "VOICE_STATE_CREATE", data: user("joined-user") };
  await h.receive(event);
  const count = h.sent.filter(p => p.cmd === "GET_SELECTED_VOICE_CHANNEL").length;
  await h.receive(event);
  await h.receive(event);
  assert.equal(h.sent.filter(p => p.cmd === "GET_SELECTED_VOICE_CHANNEL").length, count);
  await h.reply(channel("old", "old-user"));
  assert.equal(h.sent.filter(p => p.cmd === "GET_SELECTED_VOICE_CHANNEL").length, count + 1);
  await h.reply(channel("old", "old-user", "joined-user"));
  assert.deepEqual(ids(h.store), ["joined-user", "old-user"]);
  assert.equal(h.events.filter(([, data]) => data.id === "joined-user" && data.event === "join").length, 1);
});

test("current-channel voice and speaking updates work without accepting old-channel speaking", async () => {
  const h = await setup();
  await h.select("new");
  await h.reply(channel("new", "new-user"));
  const speaking = (evt, id) =>
    h.receive({
      cmd: "DISPATCH",
      evt,
      data: { channel_id: id, user_id: "new-user" },
    });
  await speaking("SPEAKING_START", "old");
  assert.equal(h.store.getState().users["new-user"].talking, false);
  await speaking("SPEAKING_START", "new");
  await h.receive({
    cmd: "DISPATCH",
    evt: "VOICE_STATE_UPDATE",
    data: {
      ...user("new-user"),
      channel_id: "new",
      voice_state: { self_mute: true },
    },
  });
  assert.equal(h.store.getState().users["new-user"].talking, true);
  assert.equal(h.store.getState().users["new-user"].selfMuted, true);
  await speaking("SPEAKING_STOP", "new");
  assert.equal(h.store.getState().users["new-user"].talking, false);
});
