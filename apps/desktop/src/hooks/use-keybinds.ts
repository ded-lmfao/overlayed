import { useEffect } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "@/store";

const HIDE_TOGGLE_KEYBIND = "CommandOrControl+Shift+G";

// Serialize setup and cleanup, including React StrictMode's effect replay.
let shortcutLifecycle = Promise.resolve();

export const useKeybinds = () => {
  useEffect(() => {
    if (getCurrentWebviewWindow().label !== "main") return;
    let disposed = false;
    const registered: string[] = [];
    shortcutLifecycle = shortcutLifecycle.then(async () => {
      for (const shortcut of [HIDE_TOGGLE_KEYBIND]) {
        if (disposed) break;
        try {
          await register(shortcut, event => {
            if (disposed || event.state !== "Pressed") return;
            const { visible, setAppVisible } = useAppStore.getState();
            setAppVisible(!visible);
          });
          registered.push(shortcut);
        } catch (error) {
          console.error(`Could not register ${shortcut}`, error);
        }
      }
    });

    return () => {
      disposed = true;
      shortcutLifecycle = shortcutLifecycle.then(async () => {
        for (const shortcut of registered) {
          try {
            await unregister(shortcut);
          } catch (error) {
            console.error(`Could not unregister ${shortcut}`, error);
          }
        }
      });
    };
  }, []);
};
