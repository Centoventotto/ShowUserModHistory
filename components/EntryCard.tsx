/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { useTimer } from "@utils/react";
import { Clickable, GuildStore, IconUtils, moment, Parser, React, Tooltip, UserStore } from "@webpack/common";
import type { ReactNode } from "react";

import { removeEntry } from "../store";
import { CachedMessage, Confidence, LogEntry } from "../types";
import { cl, describeTimeoutLength, entryIcon, entryTitle, entryTone, fmtDate, fmtDuration, toMs } from "../utils";
import { openHistoryModal } from "./HistoryModal";

const CONFIDENCE: Record<Confidence, { icon: string; label: string; help: string; }> = {
    confirmed: { icon: "✔", label: "Confirmed", help: "Seen directly in an event from Discord or in the audit log." },
    probable: { icon: "≈", label: "Probable", help: "Deduced from events that happened together, very likely right." },
    possible: { icon: "?", label: "Unverified", help: "A guess: Discord doesn't send enough information to be sure." }
};

interface Row {
    icon: string;
    label: string;
    value: ReactNode;
}

export function Countdown({ until }: { until: number; }) {
    useTimer({ interval: 1000 });
    const left = until - Date.now();
    return <span className={cl("countdown")}>{left > 0 ? fmtDuration(left) : "ended"}</span>;
}

function UserLink({ id, tag }: { id?: string; tag?: string; }) {
    if (!id) return <>{tag ?? "Unknown"}</>;
    const user = UserStore.getUser(id);
    return (
        <Clickable className={cl("link")} onClick={() => openUserProfile(id)}>
            @{user?.username ?? tag ?? id}
        </Clickable>
    );
}

function buildRows(entry: LogEntry): Row[] {
    const rows: Row[] = [];
    const add = (icon: string, label: string, value: ReactNode) => {
        if (value != null && value !== false && value !== "" && value !== 0) rows.push({ icon, label, value });
    };
    const until = entry.until ?? 0;

    add("📅", entry.type === "messageDelete" ? "Deleted" : "Detected", fmtDate(entry.timestamp));

    switch (entry.type) {
        case "timeout":
            add("🕐", "Started", entry.startedAt
                ? fmtDate(entry.startedAt)
                : `Unknown, already active on ${fmtDate(entry.timestamp)}`);
            add("🏁", "Ends", fmtDate(until));
            add("⏱️", "Duration", entry.startedAt
                ? describeTimeoutLength(until - entry.startedAt)
                : `At least ${fmtDuration(until - entry.timestamp)}`);
            if (entry.endedAt) add("✅", "Ended early", `${fmtDate(entry.endedAt)}, ${fmtDuration(until - entry.endedAt)} before the end`);
            else add("⌛", "Remaining", until > Date.now() ? <Countdown until={until} /> : `Expired ${moment(until).fromNow()}`);
            break;
        case "timeoutRemoved":
            add("🕐", "Timed out since", entry.startedAt && fmtDate(entry.startedAt));
            add("🏁", "Was going to end", until && fmtDate(until));
            add("⏱️", "Time served", entry.startedAt && entry.endedAt && fmtDuration(entry.endedAt - entry.startedAt));
            add("⌛", "Time skipped", until && entry.endedAt && fmtDuration(until - entry.endedAt));
            break;
        case "voiceMute":
        case "voiceDeafen":
            add("🔊", "Voice channel", entry.channelName);
            add("🕐", "Started", entry.startPrecise === false ? "Unknown, already active when first seen" : undefined);
            break;
        case "messageDelete": {
            const m = entry.message;
            add("✉️", "Sent", m && fmtDate(m.timestamp));
            add("⏲️", "Lifetime", m && fmtDuration(entry.timestamp - m.timestamp));
            add("✏️", "Last edited", m?.editedTimestamp && fmtDate(m.editedTimestamp));
            add("🧹", "Deleted by", entry.deletedBy);
            add("📦", "Bulk deletion", entry.bulk && `${entry.bulk} messages removed at once`);
            add("🆔", "Message ID", m?.id);
            break;
        }
    }

    if (entry.moderatorId || entry.moderatorTag)
        add("👮", "Moderator", <UserLink id={entry.moderatorId} tag={entry.moderatorTag} />);
    add("📝", "Reason", entry.reason);

    const { member } = entry;
    if (member) {
        const joined = toMs(member.joinedAt);
        add("📆", "Joined server", joined && `${fmtDate(joined)} (member for ${fmtDuration(entry.timestamp - joined)})`);
        add("🏷️", "Nickname", member.nick);
        add("🎭", "Roles", member.roles?.join(", "));
        add("⏳", "Was timed out until", member.timeoutUntil && fmtDate(member.timeoutUntil));
    }

    return rows;
}

function formatSize(bytes?: number) {
    if (!bytes) return "";
    return bytes > 1024 * 1024 ? ` (${(bytes / 1024 / 1024).toFixed(1)} MB)` : ` (${Math.ceil(bytes / 1024)} KB)`;
}

function MessagePreview({ message }: { message: CachedMessage; }) {
    return (
        <div className={cl("message")}>
            {message.content
                ? <div className={cl("message-content")}>{Parser.parse(message.content, true, { channelId: message.channelId, messageId: message.id, allowLinks: true })}</div>
                : <div className={cl("muted")}>No text content.</div>}
            {message.attachments.map(a => (
                <a key={a.url || a.name} className={cl("attachment")} href={a.url} target="_blank" rel="noreferrer">
                    📎 {a.name}{formatSize(a.size)}
                </a>
            ))}
            {message.stickers.length > 0 && <div className={cl("muted")}>🏷️ Stickers: {message.stickers.join(", ")}</div>}
            {message.embeds > 0 && <div className={cl("muted")}>🧩 {message.embeds} embed{message.embeds === 1 ? "" : "s"}</div>}
            {message.replyTo && <div className={cl("muted")}>↩️ Reply to message {message.replyTo}</div>}
        </div>
    );
}

function UserLine({ entry }: { entry: LogEntry; }) {
    const user = UserStore.getUser(entry.userId);
    const avatar = user?.getAvatarURL(entry.guildId, 32) ?? IconUtils.getDefaultAvatarURL(entry.userId);

    return (
        <Clickable className={cl("entry-user")} onClick={() => openHistoryModal(entry.userId)}>
            <img className={cl("entry-avatar")} src={avatar} alt="" />
            <span className={cl("entry-user-name")}>{user?.globalName ?? user?.username ?? entry.userTag ?? "Unknown user"}</span>
            <span className={cl("muted")}>{entry.userId}</span>
        </Clickable>
    );
}

export function EntryCard({ entry, showUser }: { entry: LogEntry; showUser: boolean; }) {
    const guild = entry.guildId ? GuildStore.getGuild(entry.guildId) : undefined;
    const guildIcon = guild?.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 32 }) : undefined;
    const confidence = CONFIDENCE[entry.confidence];
    const rows = buildRows(entry);

    return (
        <div className={cl("entry", `tone-${entryTone(entry)}`)}>
            <div className={cl("entry-icon")}>{entryIcon(entry)}</div>
            <div className={cl("entry-body")}>
                <div className={cl("entry-header")}>
                    <span className={cl("entry-title")}>{entryTitle(entry)}</span>
                    <Tooltip text={entry.type === "messageDelete" ? `Who deleted it: ${confidence.help}` : confidence.help}>
                        {props => (
                            <span {...props} className={cl("badge", `badge-${entry.confidence}`)}>
                                {confidence.icon} {entry.type === "messageDelete" ? `Deleter ${confidence.label.toLowerCase()}` : confidence.label}
                            </span>
                        )}
                    </Tooltip>
                    <Tooltip text={fmtDate(entry.timestamp)}>
                        {props => <span {...props} className={cl("entry-time")}>{moment(entry.timestamp).fromNow()}</span>}
                    </Tooltip>
                </div>

                {showUser && <UserLine entry={entry} />}

                <div className={cl("entry-place")}>
                    {guildIcon ? <img className={cl("guild-icon")} src={guildIcon} alt="" /> : <span>🏠</span>}
                    <span>{guild?.name ?? entry.guildName ?? (entry.guildId ? "Unknown server" : "Direct messages")}</span>
                    {entry.channelName && <span className={cl("muted")}>· {entry.channelName}</span>}
                </div>

                {rows.length > 0 && (
                    <div className={cl("grid")}>
                        {rows.map(r => (
                            <React.Fragment key={r.label}>
                                <span className={cl("label")}>{r.icon} {r.label}</span>
                                <span className={cl("value")}>{r.value}</span>
                            </React.Fragment>
                        ))}
                    </div>
                )}

                {entry.message && <MessagePreview message={entry.message} />}
                {entry.note && <div className={cl("note")}>ℹ️ {entry.note}</div>}

                <div className={cl("entry-footer")}>
                    <span className={cl("muted")}>📡 {entry.source}</span>
                    <div className={cl("entry-actions")}>
                        <Button size="min" variant="secondary" onClick={() => copyWithToast(JSON.stringify(entry, null, 2), "Event copied as JSON.")}>
                            📋 Copy
                        </Button>
                        <Button size="min" variant="dangerSecondary" onClick={() => removeEntry(entry.id)}>
                            ✖ Remove
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
