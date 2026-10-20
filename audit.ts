/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildStore, PermissionsBits, PermissionStore, RestAPI, SnowflakeUtils } from "@webpack/common";

import { settings } from "./settings";
import { findLatest, logger, updateEntry } from "./store";
import { AuditLogEntry, RawUser } from "./types";
import { rawUserTag, toMs } from "./utils";

const ActionType = {
    MEMBER_KICK: 20,
    MEMBER_BAN_ADD: 22,
    MEMBER_BAN_REMOVE: 23,
    MEMBER_UPDATE: 24,
    MESSAGE_DELETE: 72,
    MESSAGE_BULK_DELETE: 73,
    AUTO_MODERATION_TIMEOUT: 145
} as const;

const MATCH_WINDOW = 2 * 60_000;

export type LookupKind = "ban" | "unban" | "removal" | "timeout" | "timeoutRemoved" | "voice" | "delete" | "bulkDelete";

export interface LookupRequest {
    kind: LookupKind;
    entryId: string;
    userId: string;
    channelId?: string;
    until?: number;
    voiceKey?: "mute" | "deaf";
    enabled?: boolean;
}

interface Lookup extends LookupRequest {
    at: number;
    attempts: number;
}

const pending = new Map<string, Lookup[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastFetch = new Map<string, number>();
const deleteCounts = new Map<string, number>();

const createdAt = (log: AuditLogEntry) => SnowflakeUtils.extractTimestamp(log.id);
const findChange = (log: AuditLogEntry, key: string) => log.changes?.find(c => c.key === key);

export function canReadAuditLog(guildId: string) {
    if (!settings.store.useAuditLog) return false;
    const guild = GuildStore.getGuild(guildId);
    return guild != null && PermissionStore.can(PermissionsBits.VIEW_AUDIT_LOG, guild);
}

export function queueAuditLookup(guildId: string, request: LookupRequest) {
    if (!canReadAuditLog(guildId)) return;
    pending.set(guildId, [...pending.get(guildId) ?? [], { ...request, at: Date.now(), attempts: 0 }]);
    schedule(guildId, 1500);
}

export function stopAuditLookups() {
    timers.forEach(clearTimeout);
    timers.clear();
    pending.clear();
}

function schedule(guildId: string, delay: number) {
    if (timers.has(guildId)) return;
    const wait = Math.max(delay, (lastFetch.get(guildId) ?? 0) + 5000 - Date.now());
    timers.set(guildId, setTimeout(() => {
        runLookups(guildId).catch(e => logger.warn("Could not read the audit log of", guildId, e));
    }, wait));
}

async function runLookups(guildId: string) {
    timers.delete(guildId);
    const lookups = pending.get(guildId) ?? [];
    pending.delete(guildId);
    if (!lookups.length) return;

    lastFetch.set(guildId, Date.now());
    const { body } = await RestAPI.get({ url: `/guilds/${guildId}/audit-logs`, query: { limit: 100 } });
    const logs: AuditLogEntry[] = body?.audit_log_entries ?? [];
    const users: RawUser[] = body?.users ?? [];
    const names = new Map(users.map(u => [u.id, rawUserTag(u)]));

    const retry: Lookup[] = [];
    for (const lookup of lookups) {
        if (!findLatest(e => e.id === lookup.entryId)) continue;

        const match = findMatch(lookup, logs);
        if (match) applyMatch(lookup, match.log, match.sure, names);
        else if (lookup.attempts === 0) retry.push({ ...lookup, attempts: 1 });
        else applyNoMatch(lookup, logs, names);
    }

    for (const log of logs) {
        if (log.options?.count) deleteCounts.set(log.id, Number(log.options.count));
    }

    if (retry.length) {
        pending.set(guildId, [...retry, ...pending.get(guildId) ?? []]);
        schedule(guildId, 5000);
    }
}

function findMatch(lookup: Lookup, logs: AuditLogEntry[]): { log: AuditLogEntry; sure: boolean; } | undefined {
    const near = (log: AuditLogEntry) => Math.abs(createdAt(log) - lookup.at) < MATCH_WINDOW;
    const about = (log: AuditLogEntry, ...types: number[]) => types.includes(log.action_type) && log.target_id === lookup.userId;
    let log: AuditLogEntry | undefined;

    switch (lookup.kind) {
        case "ban":
            log = logs.find(l => about(l, ActionType.MEMBER_BAN_ADD) && near(l));
            break;
        case "unban":
            log = logs.find(l => about(l, ActionType.MEMBER_BAN_REMOVE) && near(l));
            break;
        case "removal":
            log = logs.find(l => about(l, ActionType.MEMBER_BAN_ADD, ActionType.MEMBER_KICK) && near(l));
            break;
        case "timeout":
            log = logs.find(l =>
                (about(l, ActionType.AUTO_MODERATION_TIMEOUT) && near(l))
                || (about(l, ActionType.MEMBER_UPDATE) && Math.abs(toMs(findChange(l, "communication_disabled_until")?.new_value) - (lookup.until ?? 0)) < 2000)
            );
            break;
        case "timeoutRemoved":
            log = logs.find(l => {
                const change = findChange(l, "communication_disabled_until");
                return about(l, ActionType.MEMBER_UPDATE) && near(l) && change != null && !change.new_value;
            });
            break;
        case "voice":
            log = logs.find(l => about(l, ActionType.MEMBER_UPDATE) && near(l) && findChange(l, lookup.voiceKey ?? "mute")?.new_value === lookup.enabled);
            break;
        case "bulkDelete":
            log = logs.find(l => l.action_type === ActionType.MESSAGE_BULK_DELETE && l.target_id === lookup.channelId && near(l));
            break;
        case "delete":
            for (const l of logs) {
                if (!about(l, ActionType.MESSAGE_DELETE) || l.options?.channel_id !== lookup.channelId) continue;

                // Discord merges repeated deletions into one entry and bumps its count, so a fresh deletion
                // either creates a new entry or raises the count of an existing one.
                const previous = deleteCounts.get(l.id);
                const fresh = createdAt(l) >= lookup.at - 10_000;
                const bumped = previous !== undefined && Number(l.options?.count ?? 0) > previous;
                if (fresh || bumped) return { log: l, sure: true };
                if (previous === undefined && lookup.at - createdAt(l) < 5 * 60_000) return { log: l, sure: false };
            }
            return;
    }

    return log && { log, sure: true };
}

function applyMatch(lookup: Lookup, log: AuditLogEntry, sure: boolean, names: Map<string, string | undefined>) {
    const automod = log.action_type === ActionType.AUTO_MODERATION_TIMEOUT;
    const moderatorId = automod ? undefined : log.user_id ?? undefined;
    const moderator = {
        moderatorId,
        moderatorTag: automod ? "AutoMod" : moderatorId && names.get(moderatorId),
        reason: log.reason,
        auditLogId: log.id
    };

    switch (lookup.kind) {
        case "removal":
            updateEntry(lookup.entryId, {
                ...moderator,
                type: log.action_type === ActionType.MEMBER_BAN_ADD ? "ban" : "kick",
                confidence: "confirmed",
                note: undefined
            });
            break;
        case "timeout":
            updateEntry(lookup.entryId, { ...moderator, startedAt: createdAt(log), startPrecise: true, note: undefined });
            break;
        case "delete":
            updateEntry(lookup.entryId, {
                ...moderator,
                confidence: sure ? "confirmed" : "probable",
                deletedBy: sure ? "A moderator, according to the audit log." : "Probably a moderator: the audit log has a matching entry, but it may be older."
            });
            break;
        case "bulkDelete":
            updateEntry(lookup.entryId, { ...moderator, confidence: "confirmed", deletedBy: "A moderator with a bulk delete, according to the audit log." });
            break;
        default:
            updateEntry(lookup.entryId, { ...moderator, confidence: "confirmed" });
    }
}

function applyNoMatch(lookup: Lookup, logs: AuditLogEntry[], names: Map<string, string | undefined>) {
    switch (lookup.kind) {
        case "removal":
            updateEntry(lookup.entryId, {
                type: "leave",
                confidence: "confirmed",
                note: "The audit log has no kick or ban for this member, so they most likely left on their own."
            });
            break;
        case "delete":
            updateEntry(lookup.entryId, {
                confidence: "probable",
                deletedBy: "Most likely the author: the audit log has no entry for this deletion."
            });
            break;
        case "bulkDelete": {
            const ban = logs.find(l => l.action_type === ActionType.MEMBER_BAN_ADD && l.target_id === lookup.userId && Math.abs(createdAt(l) - lookup.at) < MATCH_WINDOW);
            if (!ban) break;
            updateEntry(lookup.entryId, {
                moderatorId: ban.user_id ?? undefined,
                moderatorTag: ban.user_id ? names.get(ban.user_id) : undefined,
                reason: ban.reason,
                auditLogId: ban.id,
                confidence: "confirmed",
                deletedBy: "Wiped by the ban of the author, according to the audit log."
            });
        }
    }
}
