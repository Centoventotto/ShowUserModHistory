/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { isNonNullish } from "@utils/guards";
import { Message } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildRoleStore, MessageStore, UserStore } from "@webpack/common";

import { queueAuditLookup } from "./audit";
import { openHistoryModal } from "./components/HistoryModal";
import { isGuildBlacklisted, settings } from "./settings";
import { addEntries, addEntry, findLatest, getEntries, logger, updateEntry } from "./store";
import { CachedMessage, EntryType, FluxVoiceState, LogEntry, MemberAction, MemberSnapshot, NewEntry, RawMessage, RawUser } from "./types";
import { channelLabel, entryIcon, entryTitle, fmtDate, memberKey, rawUserTag, RECENT_WINDOW, toMs } from "./utils";

const LEAVE_NOTE = "Discord only tells everyone that this member is gone. Without audit log access it can't tell apart leaving, a kick or a ban.";
const PURGE_NOTE = "Their messages were bulk deleted when they disappeared from the server, which is what happens when someone is banned with message deletion.";
const FIRST_SEEN_NOTE = "This was already active when your client first saw it, so the exact start time is unknown.";

const knownTimeouts = new Map<string, number>();
const voiceStates = new Map<string, { mute: boolean; deaf: boolean; }>();
const messageCache = new Map<string, CachedMessage>();
let recentBulk: { guildId: string; at: number; authors: Map<string, number>; }[] = [];
let lastTimeoutVersion: number | undefined;
let diffQueued = false;

export function resetTracker() {
    knownTimeouts.clear();
    voiceStates.clear();
    messageCache.clear();
    recentBulk = [];
    lastTimeoutVersion = undefined;
    diffQueued = false;
}

function isIgnoredUser(userId: string, bot?: boolean) {
    return settings.store.ignoreBots && (bot ?? UserStore.getUser(userId)?.bot ?? false);
}

function defer(fn: () => void) {
    setTimeout(() => {
        try {
            fn();
        } catch (e) {
            logger.error("Failed to process an event", e);
        }
    });
}

function notify(entry: LogEntry) {
    if (!settings.store.notify) return;
    const user = UserStore.getUser(entry.userId);
    const extra = entry.until ? ` until ${fmtDate(entry.until)}` : "";

    showNotification({
        title: `${entryIcon(entry)} ${entryTitle(entry)}: ${user?.username ?? entry.userTag ?? entry.userId}`,
        body: `In ${entry.guildName ?? "a server"}${extra}. Click to open their mod history.`,
        icon: user?.getAvatarURL(entry.guildId, 128),
        onClick: () => openHistoryModal(entry.userId, entry.guildId)
    });
}

function snapshotMember(guildId: string, userId: string): MemberSnapshot | undefined {
    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return undefined;

    return {
        nick: member.nick,
        joinedAt: member.joinedAt,
        roles: member.roles.map(id => GuildRoleStore.getRole(guildId, id)?.name).filter(isNonNullish),
        timeoutUntil: toMs(member.communicationDisabledUntil) > Date.now() ? toMs(member.communicationDisabledUntil) : undefined
    };
}

function findRecent(guildId: string, userId: string, types: EntryType[], window = RECENT_WINDOW) {
    const now = Date.now();
    return findLatest(e => e.guildId === guildId && e.userId === userId && types.includes(e.type) && now - e.timestamp < window);
}

function refineRecentDeletions(guildId: string, userId: string, deletedBy: string) {
    const now = Date.now();
    for (const e of getEntries()) {
        if (e.type === "messageDelete" && e.guildId === guildId && e.userId === userId && e.confidence === "possible" && now - e.timestamp < RECENT_WINDOW)
            updateEntry(e.id, { deletedBy, confidence: "probable" });
    }
}

// #region Timeouts

export function handleTimeout(guildId: string, userId: string, until: number, precise: boolean, source: string) {
    const key = memberKey(guildId, userId);
    const now = Date.now();
    const previous = knownTimeouts.get(key);
    const isTimeoutFor = (e: LogEntry, end?: number) => e.type === "timeout" && e.guildId === guildId && e.userId === userId && e.until === end;

    if (until > now) {
        knownTimeouts.set(key, until);
        if (previous === until || !settings.store.logTimeouts || isIgnoredUser(userId) || isGuildBlacklisted(guildId)) return;
        if (findLatest(e => isTimeoutFor(e, until))) return;

        const replaced = previous && previous > now ? findLatest(e => isTimeoutFor(e, previous)) : undefined;
        if (replaced) updateEntry(replaced.id, { endedAt: now, note: "Replaced by a newer timeout." });

        const entry = addEntry({
            type: "timeout",
            guildId,
            userId,
            until,
            startedAt: precise ? now : undefined,
            startPrecise: precise,
            confidence: "confirmed",
            source,
            note: replaced && previous ? `This changed a timeout that was going to end on ${fmtDate(previous)}.` : precise ? undefined : FIRST_SEEN_NOTE
        });

        queueAuditLookup(guildId, { kind: "timeout", entryId: entry.id, userId, until });
        if (precise) {
            refineRecentDeletions(guildId, userId, "Probably a moderator: the author was timed out at the same time.");
            notify(entry);
        }
        return;
    }

    if (previous === undefined) return;
    knownTimeouts.delete(key);
    if (previous <= now) return;

    const open = findLatest(e => isTimeoutFor(e, previous));
    if (open) updateEntry(open.id, { endedAt: now });
    if (!settings.store.logTimeoutRemovals || isIgnoredUser(userId) || isGuildBlacklisted(guildId)) return;

    const entry = addEntry({
        type: "timeoutRemoved",
        guildId,
        userId,
        until: previous,
        startedAt: open?.startedAt,
        startPrecise: open?.startPrecise,
        endedAt: now,
        confidence: "confirmed",
        source
    });
    queueAuditLookup(guildId, { kind: "timeoutRemoved", entryId: entry.id, userId });
}

export function onMemberStoreChange() {
    const version = GuildMemberStore.getCommunicationDisabledVersion();
    if (version === lastTimeoutVersion || diffQueued) return;
    lastTimeoutVersion = version;
    diffQueued = true;
    defer(diffTimeouts);
}

function diffTimeouts() {
    diffQueued = false;
    const source = "Member data received by your client";
    const seen = new Set<string>();

    for (const [key, value] of Object.entries(GuildMemberStore.getCommunicationDisabledUserMap())) {
        const [guildId, userId] = key.split("-");
        if (!userId) continue;
        seen.add(key);
        handleTimeout(guildId, userId, toMs(value), false, source);
    }

    for (const key of [...knownTimeouts.keys()]) {
        if (seen.has(key)) continue;
        const [guildId, userId] = key.split("-");
        if (GuildMemberStore.isMember(guildId, userId)) handleTimeout(guildId, userId, 0, false, source);
        else knownTimeouts.delete(key);
    }
}

// #endregion

// #region Members, bans and kicks

function memberUpdated(action: MemberAction) {
    const { guildId, user } = action;
    if (!guildId || !user || !("communicationDisabledUntil" in action)) return;

    const member = GuildMemberStore.getMember(guildId, user.id);
    const before = toMs(member?.communicationDisabledUntil);
    const after = toMs(action.communicationDisabledUntil);
    if (before === after) return;

    defer(() => {
        const source = "Live member update (GUILD_MEMBER_UPDATE)";
        if (before > Date.now() && !knownTimeouts.has(memberKey(guildId, user.id)))
            handleTimeout(guildId, user.id, before, false, source);
        handleTimeout(guildId, user.id, after, member != null, source);
    });
}

function memberRemoved(guildId: string, user: RawUser, member?: MemberSnapshot) {
    const key = memberKey(guildId, user.id);
    knownTimeouts.delete(key);
    voiceStates.delete(key);
    if (isIgnoredUser(user.id, user.bot) || isGuildBlacklisted(guildId)) return;

    const recent = findRecent(guildId, user.id, ["ban", "kick", "leave"]);
    if (recent) {
        updateEntry(recent.id, {
            member: recent.member ?? member,
            ...(recent.type === "ban" && recent.confidence === "possible" ? { confidence: "probable", note: PURGE_NOTE } : {})
        });
        return;
    }

    const now = Date.now();
    const purged = recentBulk.some(b => b.guildId === guildId && now - b.at < RECENT_WINDOW && b.authors.has(user.id));
    if (!(purged ? settings.store.logBans : settings.store.logMemberRemovals)) return;

    const entry = addEntry({
        type: purged ? "ban" : "leave",
        guildId,
        userId: user.id,
        userTag: rawUserTag(user),
        member,
        confidence: purged ? "probable" : "confirmed",
        source: "Member removed (GUILD_MEMBER_REMOVE)",
        note: purged ? PURGE_NOTE : LEAVE_NOTE
    });

    refineRecentDeletions(guildId, user.id, "Probably a moderator: the author left or was removed from the server at the same time.");
    queueAuditLookup(guildId, { kind: "removal", entryId: entry.id, userId: user.id });
    if (purged) notify(entry);
}

function banAdded(guildId: string, user: RawUser, member?: MemberSnapshot) {
    const key = memberKey(guildId, user.id);
    knownTimeouts.delete(key);
    voiceStates.delete(key);
    if (!settings.store.logBans || isIgnoredUser(user.id, user.bot) || isGuildBlacklisted(guildId)) return;

    const source = "Ban event (GUILD_BAN_ADD)";
    const recent = findRecent(guildId, user.id, ["ban", "leave"]);
    let entry: LogEntry;

    if (recent) {
        updateEntry(recent.id, { type: "ban", confidence: "confirmed", source, note: undefined, member: recent.member ?? member });
        entry = { ...recent, type: "ban", confidence: "confirmed" };
    } else {
        entry = addEntry({ type: "ban", guildId, userId: user.id, userTag: rawUserTag(user), member, confidence: "confirmed", source });
    }

    refineRecentDeletions(guildId, user.id, "Wiped by the ban of the author.");
    queueAuditLookup(guildId, { kind: "ban", entryId: entry.id, userId: user.id });
    notify(entry);
}

function banRemoved(guildId: string, user: RawUser) {
    if (!settings.store.logBans || isIgnoredUser(user.id, user.bot) || isGuildBlacklisted(guildId)) return;

    const entry = addEntry({
        type: "unban",
        guildId,
        userId: user.id,
        userTag: rawUserTag(user),
        confidence: "confirmed",
        source: "Unban event (GUILD_BAN_REMOVE)"
    });
    queueAuditLookup(guildId, { kind: "unban", entryId: entry.id, userId: user.id });
}

/**
 * Runs before Discord's own stores handle the event, so the member is still cached
 * and we can read what changed.
 */
export function interceptor(action: MemberAction) {
    try {
        const { guildId, user } = action;
        switch (action.type) {
            case "GUILD_MEMBER_UPDATE":
                memberUpdated(action);
                break;
            case "GUILD_MEMBER_REMOVE":
                if (guildId && user) {
                    const member = snapshotMember(guildId, user.id);
                    defer(() => memberRemoved(guildId, user, member));
                }
                break;
            case "GUILD_BAN_ADD":
                if (guildId && user) {
                    const member = snapshotMember(guildId, user.id);
                    defer(() => banAdded(guildId, user, member));
                }
                break;
            case "GUILD_BAN_REMOVE":
                if (guildId && user) defer(() => banRemoved(guildId, user));
                break;
        }
    } catch (e) {
        logger.error("Interceptor failed", e);
    }
    return false;
}

// #endregion

// #region Voice

export function onVoiceStates(states: FluxVoiceState[]) {
    for (const state of states) {
        const { guildId, userId, channelId } = state;
        if (!guildId || !channelId) continue;

        const key = memberKey(guildId, userId);
        const previous = voiceStates.get(key);
        const next = { mute: !!state.mute, deaf: !!state.deaf };
        voiceStates.set(key, next);
        if (!settings.store.logVoiceMutes || isIgnoredUser(userId) || isGuildBlacklisted(guildId)) continue;

        for (const kind of ["mute", "deaf"] as const) {
            const enabled = next[kind];
            if (previous ? previous[kind] === enabled : !enabled) continue;

            const type = kind === "mute" ? "voiceMute" : "voiceDeafen";
            if (!previous && findLatest(e => e.type === type && e.guildId === guildId && e.userId === userId)?.enabled) continue;

            const entry = addEntry({
                type,
                guildId,
                userId,
                enabled,
                channelId,
                channelName: channelLabel(channelId),
                startedAt: previous ? Date.now() : undefined,
                startPrecise: !!previous,
                confidence: "confirmed",
                source: "Voice state update (VOICE_STATE_UPDATES)",
                note: previous ? undefined : FIRST_SEEN_NOTE
            });
            if (previous) queueAuditLookup(guildId, { kind: "voice", entryId: entry.id, userId, voiceKey: kind, enabled });
        }
    }
}

// #endregion

// #region Messages

function wantsChannel(guildId?: string) {
    return guildId ? !isGuildBlacklisted(guildId) : settings.store.logDirectMessages;
}

export function cacheMessage(raw: RawMessage, fallbackChannelId?: string) {
    const channelId = raw.channel_id ?? fallbackChannelId;
    if (!raw.id || !channelId || !raw.author) return;

    const guildId = raw.guild_id ?? ChannelStore.getChannel(channelId)?.guild_id;
    if (!wantsChannel(guildId)) return;

    messageCache.delete(raw.id);
    messageCache.set(raw.id, {
        id: raw.id,
        channelId,
        guildId,
        authorId: raw.author.id,
        authorTag: rawUserTag(raw.author) ?? raw.author.id,
        bot: !!raw.author.bot || !!raw.webhook_id,
        content: raw.content ?? "",
        attachments: (raw.attachments ?? []).map(a => ({ name: a.filename ?? "file", url: a.url ?? "", size: a.size })),
        embeds: raw.embeds?.length ?? 0,
        stickers: (raw.sticker_items ?? []).map(s => s.name ?? "sticker"),
        timestamp: toMs(raw.timestamp),
        editedTimestamp: toMs(raw.edited_timestamp) || undefined,
        replyTo: raw.message_reference?.message_id
    });

    const max = settings.store.messageCacheSize;
    for (const id of messageCache.keys()) {
        if (messageCache.size <= max) break;
        messageCache.delete(id);
    }
}

export function updateCachedMessage(raw: RawMessage) {
    const cached = messageCache.get(raw.id);
    if (!cached || raw.content == null) return;
    cached.content = raw.content;
    cached.editedTimestamp = toMs(raw.edited_timestamp) || Date.now();
}

function fromStoreMessage(message: Message, channelId: string): CachedMessage {
    return {
        id: message.id,
        channelId,
        guildId: ChannelStore.getChannel(channelId)?.guild_id,
        authorId: message.author.id,
        authorTag: message.author.username,
        bot: message.author.bot || !!message.webhookId,
        content: message.content,
        attachments: message.attachments.map(a => ({ name: a.filename, url: a.url, size: a.size })),
        embeds: message.embeds.length,
        stickers: (message.stickerItems ?? []).map(s => s.name),
        timestamp: toMs(message.timestamp),
        editedTimestamp: toMs(message.editedTimestamp) || undefined,
        replyTo: message.messageReference?.message_id
    };
}

function takeMessage(channelId: string, id: string) {
    const cached = messageCache.get(id);
    if (cached) {
        messageCache.delete(id);
        return cached;
    }
    const stored = MessageStore.getMessage(channelId, id);
    return stored ? fromStoreMessage(stored, channelId) : undefined;
}

function shouldLogMessage(message: CachedMessage) {
    if (!wantsChannel(message.guildId)) return false;
    if (settings.store.ignoreOwnMessages && message.authorId === UserStore.getCurrentUser()?.id) return false;
    return !(settings.store.ignoreBots && message.bot);
}

function guessDeleter(message: CachedMessage, at: number) {
    if (!message.guildId) return "The author: only they can delete their messages in DMs.";

    const related = findLatest(e =>
        e.guildId === message.guildId && e.userId === message.authorId && Math.abs(at - e.timestamp) < RECENT_WINDOW
        && (e.type === "ban" || e.type === "kick" || e.type === "leave" || (e.type === "timeout" && !!e.startPrecise))
    );

    switch (related?.type) {
        case "timeout": return "Probably a moderator: the author was timed out at the same time.";
        case "ban": return "Probably wiped by the ban of the author.";
        case "kick":
        case "leave": return "Probably a moderator: the author left or was removed from the server at the same time.";
    }
}

function deletionEntry(message: CachedMessage, at: number, bulk?: number): NewEntry {
    const guess = guessDeleter(message, at);
    return {
        type: "messageDelete",
        timestamp: at,
        userId: message.authorId,
        userTag: message.authorTag,
        guildId: message.guildId,
        channelId: message.channelId,
        channelName: channelLabel(message.channelId),
        message,
        bulk,
        confidence: guess ? message.guildId ? "probable" : "confirmed" : "possible",
        deletedBy: guess ?? (bulk
            ? "A moderator purge or a ban that wiped message history. Discord doesn't say which without audit log access."
            : "Unknown: the author or a moderator. Discord doesn't say who deleted a message."),
        source: bulk ? "Bulk deletion (MESSAGE_DELETE_BULK)" : "Message deleted (MESSAGE_DELETE)"
    };
}

export function onMessageDelete(id: string, channelId: string) {
    const message = takeMessage(channelId, id);
    if (!message || !settings.store.logDeletedMessages || !shouldLogMessage(message)) return;

    const entry = addEntry(deletionEntry(message, Date.now()));
    if (message.guildId) queueAuditLookup(message.guildId, { kind: "delete", entryId: entry.id, userId: message.authorId, channelId });
}

function inferBanFromPurge(guildId: string, channelId: string, authors: Map<string, number>) {
    if (!settings.store.logBans) return;

    for (const [authorId, count] of authors) {
        if (isIgnoredUser(authorId)) continue;

        const recent = findRecent(guildId, authorId, ["ban", "kick", "leave"], RECENT_WINDOW * 2);
        if (recent) {
            if (recent.type === "leave" && recent.confidence === "confirmed" && !recent.moderatorId)
                updateEntry(recent.id, { type: "ban", confidence: "probable", note: PURGE_NOTE });
            continue;
        }
        if (authors.size !== 1) continue;

        addEntry({
            type: "ban",
            guildId,
            userId: authorId,
            channelId,
            channelName: channelLabel(channelId),
            confidence: "possible",
            source: "Bulk deletion (MESSAGE_DELETE_BULK)",
            note: `All ${count} known messages removed by this bulk deletion were from this user. This is what a ban with message deletion looks like, but a moderator purging only their messages looks the same.`
        });
    }
}

export function onBulkDelete(ids: string[], channelId: string, guildId?: string) {
    const now = Date.now();
    const messages = ids.map(id => takeMessage(channelId, id)).filter(isNonNullish);
    const resolvedGuildId = guildId ?? messages[0]?.guildId;
    if (isGuildBlacklisted(resolvedGuildId)) return;

    if (resolvedGuildId) {
        const authors = new Map<string, number>();
        for (const m of messages) authors.set(m.authorId, (authors.get(m.authorId) ?? 0) + 1);
        recentBulk = [...recentBulk.filter(b => now - b.at < RECENT_WINDOW), { guildId: resolvedGuildId, at: now, authors }];
        inferBanFromPurge(resolvedGuildId, channelId, authors);
    }

    if (!settings.store.logDeletedMessages || !settings.store.logBulkDeletes) return;

    const created = addEntries(messages.filter(shouldLogMessage).map(m => deletionEntry(m, now, ids.length)));
    if (!resolvedGuildId) return;
    for (const entry of created)
        queueAuditLookup(resolvedGuildId, { kind: "bulkDelete", entryId: entry.id, userId: entry.userId, channelId });
}

// #endregion
