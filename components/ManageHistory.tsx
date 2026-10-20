/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Clickable, GuildStore, React } from "@webpack/common";

import { parseGuildIds, setGuildBlacklisted, settings } from "../settings";
import { exportEntries, getEntries, subscribe } from "../store";
import { cl } from "../utils";
import { confirmClear, openHistoryModal } from "./HistoryModal";

const BLACKLIST_KEYS: "blacklistedGuilds"[] = ["blacklistedGuilds"];

export function ManageHistory() {
    const entries = React.useSyncExternalStore(subscribe, getEntries);
    const blacklist = parseGuildIds(settings.use(BLACKLIST_KEYS).blacklistedGuilds);

    return (
        <div className={cl("manage")}>
            <div className={cl("manage-row")}>
                <span className={cl("manage-count")}>💾 {entries.length} events saved</span>
                <div className={cl("manage-buttons")}>
                    <Button size="small" onClick={() => openHistoryModal()}>📜 Open full log</Button>
                    <Button size="small" variant="secondary" onClick={() => exportEntries(entries, "all")}>📤 Export JSON</Button>
                    <Button size="small" variant="dangerPrimary" onClick={() => confirmClear()}>🧹 Clear all</Button>
                </div>
            </div>
            <div className={cl("manage-row")}>
                <span className={cl("manage-count")}>🚫 Servers not logged</span>
                <div className={cl("blacklist")}>
                    {blacklist.length
                        ? blacklist.map(id => (
                            <span key={id} className={cl("blacklist-item")}>
                                {GuildStore.getGuild(id)?.name ?? id}
                                <Clickable className={cl("blacklist-remove")} aria-label="Log this server again" onClick={() => setGuildBlacklisted(id, false)}>
                                    ✖
                                </Clickable>
                            </span>
                        ))
                        : <span className={cl("muted")}>None. Right click a server and pick Stop logging in Mod History.</span>}
                </div>
            </div>
        </div>
    );
}
