/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type EntryType =
    | "timeout"
    | "timeoutRemoved"
    | "ban"
    | "unban"
    | "kick"
    | "leave"
    | "voiceMute"
    | "voiceDeafen"
    | "messageDelete";

export type Confidence = "confirmed" | "probable" | "possible";

export type Category = "all" | "timeouts" | "bans" | "removals" | "voice" | "messages";

export interface MemberSnapshot {
    nick?: string | null;
    joinedAt?: string;
    roles?: string[];
    timeoutUntil?: number;
}

export interface CachedAttachment {
    name: string;
    url: string;
    size?: number;
}

export interface CachedMessage {
    id: string;
    channelId: string;
    guildId?: string;
    authorId: string;
    authorTag: string;
    bot: boolean;
    content: string;
    attachments: CachedAttachment[];
    embeds: number;
    stickers: string[];
    timestamp: number;
    editedTimestamp?: number;
    replyTo?: string;
}

export interface LogEntry {
    id: string;
    type: EntryType;
    userId: string;
    userTag?: string;
    guildId?: string;
    guildName?: string;
    timestamp: number;
    confidence: Confidence;
    source: string;
    note?: string;

    enabled?: boolean;
    moderatorId?: string;
    moderatorTag?: string;
    reason?: string;
    auditLogId?: string;
    member?: MemberSnapshot;

    until?: number;
    startedAt?: number;
    startPrecise?: boolean;
    endedAt?: number;

    channelId?: string;
    channelName?: string;
    message?: CachedMessage;
    deletedBy?: string;
    bulk?: number;
}

export type NewEntry = Omit<LogEntry, "id" | "timestamp" | "guildName" | "userTag"> & {
    timestamp?: number;
    userTag?: string;
};

export interface RawUser {
    id: string;
    username?: string;
    global_name?: string | null;
    globalName?: string | null;
    discriminator?: string;
    bot?: boolean;
}

export interface RawMessage {
    id: string;
    channel_id?: string;
    guild_id?: string;
    author?: RawUser;
    content?: string;
    attachments?: { filename?: string; url?: string; size?: number; }[];
    embeds?: unknown[];
    sticker_items?: { name?: string; }[];
    timestamp?: string;
    edited_timestamp?: string | null;
    message_reference?: { message_id?: string; };
    webhook_id?: string;
}

export interface MemberAction {
    type: string;
    guildId?: string;
    user?: RawUser;
    communicationDisabledUntil?: string | null;
}

export interface FluxVoiceState {
    userId: string;
    guildId?: string | null;
    channelId?: string | null;
    mute?: boolean;
    deaf?: boolean;
}

export interface AuditLogChange {
    key: string;
    old_value?: unknown;
    new_value?: unknown;
}

export interface AuditLogEntry {
    id: string;
    action_type: number;
    user_id?: string | null;
    target_id?: string | null;
    reason?: string;
    changes?: AuditLogChange[];
    options?: { channel_id?: string; count?: string; };
}
