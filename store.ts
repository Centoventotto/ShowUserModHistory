/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { saveFile } from "@utils/web";
import { GuildStore, UserStore } from "@webpack/common";

import { settings } from "./settings";
import { LogEntry, NewEntry } from "./types";

export const logger = new Logger("ShowUserModHistory");

const STORE_KEY = "ShowUserModHistory_entries";

let entries: LogEntry[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let idCounter = 0;
const listeners = new Set<() => void>();

export const getEntries = () => entries;

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function commit(next: LogEntry[]) {
    entries = trim(next);
    listeners.forEach(l => l());
    if (!loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveEntries, 2000);
}

function trim(list: LogEntry[]) {
    let excess = list.length - settings.store.maxEntries;
    if (excess <= 0) return list;

    const dropped = new Set<LogEntry>();
    for (const e of list) {
        if (excess === 0) break;
        if (e.type !== "messageDelete") continue;
        dropped.add(e);
        excess--;
    }

    const kept = list.filter(e => !dropped.has(e));
    return excess > 0 ? kept.slice(excess) : kept;
}

export async function loadEntries() {
    if (loaded) return;
    const saved = await DataStore.get<LogEntry[]>(STORE_KEY) ?? [];
    loaded = true;
    commit([...saved, ...entries]);
}

export async function saveEntries() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!loaded) return;
    await DataStore.set(STORE_KEY, entries).catch(e => logger.error("Failed to save history", e));
}

function describeUser(userId: string) {
    const user = UserStore.getUser(userId);
    if (!user) return undefined;
    return user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username;
}

export function addEntries(list: NewEntry[]) {
    if (!list.length) return [];

    const created = list.map(e => ({
        ...e,
        id: `${Date.now().toString(36)}-${(idCounter++).toString(36)}`,
        timestamp: e.timestamp ?? Date.now(),
        userTag: e.userTag ?? describeUser(e.userId),
        guildName: e.guildId ? GuildStore.getGuild(e.guildId)?.name : undefined
    } satisfies LogEntry));

    commit([...entries, ...created]);
    return created;
}

export const addEntry = (entry: NewEntry) => addEntries([entry])[0];

export function updateEntry(id: string, patch: Partial<LogEntry>) {
    commit(entries.map(e => e.id === id ? { ...e, ...patch } : e));
}

export function findLatest(predicate: (e: LogEntry) => boolean): LogEntry | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (predicate(entries[i])) return entries[i];
    }
}

export function removeEntry(id: string) {
    commit(entries.filter(e => e.id !== id));
}

export function clearEntries(userId?: string) {
    commit(userId ? entries.filter(e => e.userId !== userId) : []);
}

export function exportEntries(list: LogEntry[], name: string) {
    const data = new TextEncoder().encode(JSON.stringify(list, null, 2));
    const fileName = `mod-history-${name}-${new Date().toISOString().slice(0, 10)}.json`;

    if (IS_DISCORD_DESKTOP) DiscordNative.fileManager.saveWithDialog(data, fileName);
    else saveFile(new File([data], fileName, { type: "application/json" }));
}
