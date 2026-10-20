/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { React } from "@webpack/common";

import { exportEntries, getEntries, subscribe } from "../store";
import { cl } from "../utils";
import { confirmClear, openHistoryModal } from "./HistoryModal";

export function ManageHistory() {
    const entries = React.useSyncExternalStore(subscribe, getEntries);

    return (
        <div className={cl("manage")}>
            <span className={cl("manage-count")}>💾 {entries.length} events saved</span>
            <div className={cl("manage-buttons")}>
                <Button size="small" onClick={() => openHistoryModal()}>📜 Open full log</Button>
                <Button size="small" variant="secondary" onClick={() => exportEntries(entries, "all")}>📤 Export JSON</Button>
                <Button size="small" variant="dangerPrimary" onClick={() => confirmClear()}>🧹 Clear all</Button>
            </div>
        </div>
    );
}
