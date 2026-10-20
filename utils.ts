/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { formatDuration } from "@utils/text";
import { ChannelStore } from "@webpack/common";

import { Category, EntryType, LogEntry, RawUser } from "./types";

export const cl = classNameFactory("vc-modhistory-");

export const RECENT_WINDOW = 60_000;

const TIMEOUT_PRESETS: [number, string][] = [
    [60_000, "60 seconds"],
    [5 * 60_000, "5 minutes"],
    [10 * 60_000, "10 minutes"],
    [60 * 60_000, "1 hour"],
    [24 * 60 * 60_000, "1 day"],
    [7 * 24 * 60 * 60_000, "1 week"]
];

export type Tone = "danger" | "warning" | "positive" | "info" | "muted";

interface TypeInfo {
    icon: string;
    tone: Tone;
    category: Exclude<Category, "all">;
}

export const TYPE_INFO: Record<EntryType, TypeInfo> = {
    timeout: { icon: "⏳", tone: "warning", category: "timeouts" },
    timeoutRemoved: { icon: "✅", tone: "positive", category: "timeouts" },
    ban: { icon: "🔨", tone: "danger", category: "bans" },
    unban: { icon: "🕊️", tone: "positive", category: "bans" },
    kick: { icon: "👢", tone: "danger", category: "removals" },
    leave: { icon: "🚪", tone: "muted", category: "removals" },
    voiceMute: { icon: "🔇", tone: "warning", category: "voice" },
    voiceDeafen: { icon: "🎧", tone: "warning", category: "voice" },
    messageDelete: { icon: "🗑️", tone: "info", category: "messages" }
};

export const CATEGORIES: { id: Category; icon: string; label: string; }[] = [
    { id: "all", icon: "📜", label: "All" },
    { id: "timeouts", icon: "⏳", label: "Timeouts" },
    { id: "bans", icon: "🔨", label: "Bans" },
    { id: "removals", icon: "🚪", label: "Kicks & leaves" },
    { id: "voice", icon: "🔇", label: "Voice" },
    { id: "messages", icon: "🗑️", label: "Deleted messages" }
];

export function entryIcon(entry: LogEntry) {
    if (entry.type === "voiceMute" && !entry.enabled) return "🔊";
    return TYPE_INFO[entry.type].icon;
}

export function entryTone(entry: LogEntry): Tone {
    if ((entry.type === "voiceMute" || entry.type === "voiceDeafen") && !entry.enabled) return "positive";
    return TYPE_INFO[entry.type].tone;
}

export function entryTitle(entry: LogEntry) {
    switch (entry.type) {
        case "timeout": return "Timed out";
        case "timeoutRemoved": return "Timeout removed early";
        case "ban": return entry.confidence === "confirmed" ? "Banned" : entry.confidence === "probable" ? "Probably banned" : "Possibly banned or purged";
        case "unban": return "Unbanned";
        case "kick": return "Kicked";
        case "leave": return "Left or was removed";
        case "voiceMute": return entry.enabled ? "Server muted in voice" : "Server unmuted in voice";
        case "voiceDeafen": return entry.enabled ? "Server deafened in voice" : "Server undeafened in voice";
        case "messageDelete": return entry.bulk ? "Message bulk deleted" : "Message deleted";
    }
}

export function fmtDate(ms: number) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function fmtDay(ms: number) {
    return new Date(ms).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export const fmtDuration = (ms: number) => formatDuration(Math.max(0, ms), true);

export function describeTimeoutLength(ms: number) {
    const preset = TIMEOUT_PRESETS.find(([length]) => Math.abs(ms - length) <= Math.max(3000, length * 0.01));
    return preset ? `${preset[1]} (Discord preset)` : fmtDuration(ms);
}

export function toMs(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

export function rawUserTag(user: RawUser) {
    if (!user.username) return undefined;
    return user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username;
}

export function channelLabel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return undefined;
    return channel.guild_id ? `#${channel.name}` : channel.name || "Direct Message";
}

export const memberKey = (guildId: string, userId: string) => `${guildId}-${userId}`;
