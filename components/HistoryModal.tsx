/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { Alerts, Clickable, FluxDispatcher, GuildMemberStore, GuildStore, IconUtils, Modal, openModal, React, ScrollerThin, Select, showToast, SnowflakeUtils, TextInput, useMemo, UserStore, useState, VoiceStateStore } from "@webpack/common";
import type { ReactNode } from "react";

import { clearEntries, exportEntries, getEntries, subscribe } from "../store";
import { Category, LogEntry } from "../types";
import { CATEGORIES, cl, entryTitle, fmtDate, fmtDay, toMs, Tone, TYPE_INFO } from "../utils";
import { Countdown, EntryCard } from "./EntryCard";

const PAGE_SIZE = 50;

export function openHistoryModal(userId?: string, guildId?: string) {
    openModal(props => (
        <ErrorBoundary>
            <HistoryModal modalProps={props} userId={userId} guildId={guildId} />
        </ErrorBoundary>
    ));
}

export function confirmClear(userId?: string) {
    Alerts.show({
        title: userId ? "Clear this user's history?" : "Clear the whole history?",
        body: userId
            ? "Every event logged for this user will be deleted. This can't be undone."
            : "Every logged ban, timeout, kick, voice mute and deleted message will be deleted. This can't be undone.",
        confirmText: "Clear",
        cancelText: "Cancel",
        confirmColor: "danger",
        onConfirm: () => clearEntries(userId)
    });
}

function guildName(guildId: string, fallback?: string) {
    return GuildStore.getGuild(guildId)?.name ?? fallback ?? "Unknown server";
}

function searchableText(entry: LogEntry) {
    return [
        entryTitle(entry), entry.userId, entry.userTag, entry.guildName, entry.channelName, entry.reason, entry.note,
        entry.moderatorTag, entry.deletedBy, entry.message?.content, entry.message?.attachments.map(a => a.name).join(" ")
    ].join(" ").toLowerCase();
}

function StatusItem({ icon, tone, children }: { icon: string; tone: Tone; children: ReactNode; }) {
    return (
        <div className={cl("status-item", `tone-${tone}`)}>
            <span className={cl("status-icon")}>{icon}</span>
            <span>{children}</span>
        </div>
    );
}

function recheck(userId: string, guildIds: string[]) {
    if (!guildIds.length) {
        showToast({ text: "You don't share any loaded server with this user." });
        return;
    }
    FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds, userIds: [userId] });
    showToast({ text: "Asked Discord for fresh member data, changes will show up here.", variant: "success" });
}

function UserHeader({ userId, entries }: { userId: string; entries: LogEntry[]; }) {
    const user = UserStore.getUser(userId);
    const fallbackTag = entries.findLast(e => e.userTag)?.userTag;
    const avatar = user?.getAvatarURL(undefined, 128) ?? IconUtils.getDefaultAvatarURL(userId);
    const sharedGuilds = [...new Set([...GuildMemberStore.memberOf(userId), ...entries.map(e => e.guildId)])]
        .filter((id): id is string => !!id && !!GuildStore.getGuild(id));

    const now = Date.now();
    const status: ReactNode[] = [];

    for (const guildId of GuildMemberStore.memberOf(userId)) {
        const until = toMs(GuildMemberStore.getMember(guildId, userId)?.communicationDisabledUntil);
        if (until <= now) continue;
        status.push(
            <StatusItem key={`timeout-${guildId}`} icon="⏳" tone="warning">
                Timed out in <b>{guildName(guildId)}</b>: <Countdown until={until} /> left, ends {fmtDate(until)}
            </StatusItem>
        );
    }

    const voice = VoiceStateStore.getVoiceStateForUser(userId);
    if (voice?.guildId && voice.mute)
        status.push(<StatusItem key="voice-mute" icon="🔇" tone="warning">Server muted in voice in <b>{guildName(voice.guildId)}</b></StatusItem>);
    if (voice?.guildId && voice.deaf)
        status.push(<StatusItem key="voice-deaf" icon="🎧" tone="warning">Server deafened in voice in <b>{guildName(voice.guildId)}</b></StatusItem>);

    const lastBanEvent = new Map<string, LogEntry>();
    for (const e of entries) {
        if (e.guildId && (e.type === "ban" || e.type === "unban")) lastBanEvent.set(e.guildId, e);
    }
    for (const [guildId, e] of lastBanEvent) {
        if (e.type !== "ban" || e.confidence === "possible" || GuildMemberStore.isMember(guildId, userId)) continue;
        status.push(
            <StatusItem key={`ban-${guildId}`} icon="🔨" tone="danger">
                {e.confidence === "confirmed" ? "Banned" : "Probably banned"} from <b>{guildName(guildId, e.guildName)}</b> since {fmtDate(e.timestamp)}
            </StatusItem>
        );
    }

    return (
        <div className={cl("user-card")}>
            <div className={cl("user")}>
                <img className={cl("avatar")} src={avatar} alt="" />
                <div className={cl("user-info")}>
                    <div className={cl("user-name")}>{user?.globalName ?? user?.username ?? fallbackTag ?? "Unknown user"}</div>
                    <div className={cl("user-sub")}>
                        <span>@{user?.username ?? fallbackTag ?? "unknown"}</span>
                        <Clickable className={cl("link")} onClick={() => copyWithToast(userId, "User ID copied.")}>🆔 {userId}</Clickable>
                        <span>🎂 Account created {fmtDate(SnowflakeUtils.extractTimestamp(userId))}</span>
                        {user?.bot && <span>🤖 Bot</span>}
                    </div>
                </div>
                <div className={cl("user-actions")}>
                    <Button size="small" variant="secondary" onClick={() => openUserProfile(userId)}>👤 Profile</Button>
                    <Button size="small" variant="secondary" onClick={() => recheck(userId, sharedGuilds)}>🔄 Re-check</Button>
                </div>
            </div>
            <div className={cl("section-title")}>📌 Current status</div>
            <div className={cl("status")}>
                {status.length
                    ? status
                    : <StatusItem icon="✅" tone="positive">No active timeout, voice mute or ban seen right now.</StatusItem>}
            </div>
        </div>
    );
}

interface HistoryModalProps {
    modalProps: RenderModalProps;
    userId?: string;
    guildId?: string;
}

function HistoryModal({ modalProps, userId, guildId }: HistoryModalProps) {
    const all = React.useSyncExternalStore(subscribe, getEntries);
    const [category, setCategory] = useState<Category>("all");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE_SIZE);

    const entries = useMemo(() => userId ? all.filter(e => e.userId === userId) : all, [all, userId]);
    const guildOptions = useMemo(() => {
        const names = new Map<string, string>();
        for (const e of entries) {
            if (e.guildId) names.set(e.guildId, guildName(e.guildId, e.guildName));
        }
        return [
            { value: "all", label: "🌐 All servers" },
            ...[...names].map(([value, label]) => ({ value, label: `🏠 ${label}` }))
        ];
    }, [entries]);

    const [guildFilter, setGuildFilter] = useState(() => guildId && entries.some(e => e.guildId === guildId) ? guildId : "all");

    const counts = useMemo(() => {
        const result = Object.fromEntries(CATEGORIES.map(c => [c.id, 0])) as Record<Category, number>;
        for (const e of entries) {
            if (guildFilter !== "all" && e.guildId !== guildFilter) continue;
            result.all++;
            result[TYPE_INFO[e.type].category]++;
        }
        return result;
    }, [entries, guildFilter]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return entries.filter(e =>
            (category === "all" || TYPE_INFO[e.type].category === category)
            && (guildFilter === "all" || e.guildId === guildFilter)
            && (!q || searchableText(e).includes(q))
        ).reverse();
    }, [entries, category, guildFilter, query]);

    const user = userId ? UserStore.getUser(userId) : undefined;
    const name = user?.globalName ?? user?.username ?? entries.findLast(e => e.userTag)?.userTag ?? userId;

    let lastDay = "";
    const timeline = visible.slice(0, limit).map(entry => {
        const day = fmtDay(entry.timestamp);
        const newDay = day !== lastDay;
        lastDay = day;
        return (
            <React.Fragment key={entry.id}>
                {newDay && <div className={cl("day")} role="separator"><span>📅 {day}</span></div>}
                <EntryCard entry={entry} showUser={!userId} />
            </React.Fragment>
        );
    });

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={userId ? `📜 Mod History: ${name}` : "📜 Mod History Log"}
            subtitle={userId
                ? `${entries.length} logged event${entries.length === 1 ? "" : "s"} for this user`
                : `${all.length} logged event${all.length === 1 ? "" : "s"} across every user`}
            actions={[
                { text: "Export JSON", variant: "secondary", onClick: () => exportEntries(entries, userId ?? "all") },
                { text: userId ? "Clear this user" : "Clear everything", variant: "critical-primary", onClick: () => confirmClear(userId) }
            ]}
        >
            <div className={cl("root")}>
                {userId && <UserHeader userId={userId} entries={entries} />}

                <div className={cl("chips")}>
                    {CATEGORIES.map(c => (
                        <Button
                            key={c.id}
                            size="small"
                            variant={category === c.id ? "primary" : "secondary"}
                            onClick={() => {
                                setCategory(c.id);
                                setLimit(PAGE_SIZE);
                            }}
                        >
                            {c.icon} {c.label} <span className={cl("chip-count")}>{counts[c.id]}</span>
                        </Button>
                    ))}
                </div>

                <div className={cl("filter-row")}>
                    <div className={cl("guild-select")}>
                        <Select
                            options={guildOptions}
                            select={(v: string) => {
                                setGuildFilter(v);
                                setLimit(PAGE_SIZE);
                            }}
                            isSelected={(v: string) => v === guildFilter}
                            serialize={String}
                        />
                    </div>
                    <div className={cl("search")}>
                        <TextInput placeholder="🔍 Search content, reasons, servers, moderators..." value={query} onChange={setQuery} />
                    </div>
                </div>

                <ScrollerThin className={cl("timeline")} fade>
                    {timeline.length
                        ? timeline
                        : (
                            <div className={cl("empty")}>
                                <div className={cl("empty-icon")}>🕊️</div>
                                <div>Nothing logged here yet.</div>
                                <div className={cl("muted")}>Events are recorded while Discord is open and the plugin is enabled.</div>
                            </div>
                        )}
                    {visible.length > limit && (
                        <div className={cl("more")}>
                            <Button variant="secondary" size="small" onClick={() => setLimit(l => l + PAGE_SIZE)}>
                                ⬇️ Show more ({visible.length - limit} left)
                            </Button>
                        </div>
                    )}
                </ScrollerThin>
            </div>
        </Modal>
    );
}
