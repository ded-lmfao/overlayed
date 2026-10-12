import type { DirectionLR } from "@/config";
import { User } from "../components/user";
import { cn } from "@/utils/tw";
import { useAppStore } from "../store";
import { useConfigValue } from "@/hooks/use-config-value";
import { useEffect, useState } from "react";

const VISIBLE_USER_LIMIT = 8;

export const ChannelView = ({ alignDirection, anchored }: { alignDirection: DirectionLR; anchored: boolean }) => {
  const { users, me } = useAppStore();

  const { value: showOnlyTalkingUsers } = useConfigValue("showOnlyTalkingUsers");
  const { value: showOwnUser } = useConfigValue("showOwnUser");
  const { value: opacity } = useConfigValue("opacity");
  const { value: opacityTarget } = useConfigValue("opacityTarget");
  const { value: userScale } = useConfigValue("userScale");
  const { value: vertical } = useConfigValue("vertical");

  const allUsers = Object.entries(users);
  let userList = showOnlyTalkingUsers ? allUsers.filter(([, item]) => item.talking) : allUsers;

  userList = userList.filter(([, item]) => {
    if (item.id === me?.id) {
      return showOwnUser && (showOnlyTalkingUsers ? item.talking : true);
    }
    return true;
  });

  const [visibleIds, setVisibleIds] = useState(() => userList.slice(0, VISIBLE_USER_LIMIT).map(([id]) => id));

  useEffect(() => {
    const available = new Map(userList);
    const nextIds = visibleIds.filter(id => available.has(id));

    for (const [id] of userList) {
      if (nextIds.length >= VISIBLE_USER_LIMIT) break;
      if (!nextIds.includes(id)) nextIds.push(id);
    }

    for (const [id, item] of userList) {
      if (!item.talking || nextIds.includes(id)) continue;
      let replaceIndex = -1;
      for (let index = nextIds.length - 1; index >= 0; index--) {
        const visibleId = nextIds[index];
        if (visibleId && !available.get(visibleId)?.talking) {
          replaceIndex = index;
          break;
        }
      }
      if (replaceIndex === -1) break;
      nextIds.splice(replaceIndex, 1);
      nextIds.unshift(id);
    }

    if (nextIds.length > VISIBLE_USER_LIMIT) nextIds.length = VISIBLE_USER_LIMIT;
    if (nextIds.length !== visibleIds.length || nextIds.some((id, index) => id !== visibleIds[index])) {
      setVisibleIds(nextIds);
    }
  }, [userList, visibleIds]);

  const visibleUsers = visibleIds
    .map(id => userList.find(([userId]) => userId === id))
    .filter((entry): entry is [string, (typeof userList)[number][1]] => entry !== undefined);
  const hiddenUserCount = userList.length - visibleUsers.length;

  const rows = visibleUsers.map(([, item]) => (
    <User
      key={item.id}
      item={item}
      alignDirection={alignDirection}
      opacity={opacity}
      opacityTarget={opacityTarget}
      userScale={userScale}
      anchored={anchored}
    />
  ));
  if (hiddenUserCount > 0) {
    rows.push(
      <div
        key="hidden-users"
        data-auto-height-summary
        className={cn(
          "flex items-center justify-start gap-2 px-2",
          alignDirection === "right" ? "flex-row-reverse" : "flex-row"
        )}
        aria-label={`${hiddenUserCount} more users`}
      >
        <div className="pointer-events-none relative h-6 w-6 shrink-0 rounded-full border-2 border-zinc-800 bg-zinc-900" />
        <span className="rounded-md bg-zinc-800 p-1 px-2 text-xs text-zinc-400">{hiddenUserCount} others</span>
      </div>
    );
  }

  return (
    <div
      className={
        anchored
          ? cn("flex flex-1 min-h-0 overflow-hidden", {
              "justify-start": alignDirection === "left",
              "[justify-content:safe_center]": alignDirection === "center",
              "[justify-content:safe_flex-end]": alignDirection === "right",
              "[align-items:safe_flex-end]": vertical === "bottom",
              "items-start": vertical !== "bottom",
            })
          : "h-full"
      }
    >
      <div
        data-placement-content
        className={
          anchored
            ? cn("flex flex-col w-max shrink-0 overflow-hidden py-2", {
                "items-center": alignDirection === "center",
                "items-start": alignDirection === "left",
                "items-end": alignDirection === "right",
              })
            : cn("py-2 h-full", {
                "flex flex-wrap justify-center": alignDirection === "center",
                "flex flex-1 flex-col": alignDirection !== "center",
                "justify-end": alignDirection !== "center" && vertical === "bottom",
                "justify-start": alignDirection !== "center" && vertical !== "bottom",
                "overflow-auto": userScale === 100,
                "overflow-visible": userScale !== 100,
              })
        }
        style={anchored ? undefined : { maxHeight: "100%" }}
      >
        {anchored ? (
          <div
            className={cn("flex w-max shrink-0 overflow-hidden", {
              "flex-row": alignDirection === "center",
              "flex-col items-start": alignDirection === "left",
              "flex-col items-end": alignDirection === "right",
            })}
          >
            {rows}
          </div>
        ) : (
          rows
        )}
      </div>
    </div>
  );
};
