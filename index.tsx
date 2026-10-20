/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { User } from "@vencord/discord-types";
import { FluxDispatcher, GuildMemberStore, Menu } from "@webpack/common";

import { stopAuditLookups } from "./audit";
import { openHistoryModal } from "./components/HistoryModal";
import { settings } from "./settings";
import { loadEntries, logger, saveEntries } from "./store";
import { cacheMessage, interceptor, onBulkDelete, onMemberStoreChange, onMessageDelete, onVoiceStates, resetTracker, updateCachedMessage } from "./tracker";
import { FluxVoiceState, RawMessage } from "./types";

function HistoryIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z" />
        </svg>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user, guildId }: { user?: User; guildId?: string; }) => {
    if (!user || !settings.store.contextMenuButton) return;

    children.push(
        <Menu.MenuItem
            id="vc-show-mod-history"
            label="Show Mod History"
            icon={HistoryIcon}
            action={() => openHistoryModal(user.id, guildId)}
        />
    );
};

export default definePlugin({
    name: "ShowUserModHistory",
    description: "Logs bans, timeouts, kicks, voice mutes and deleted messages from the events Discord sends to every member, and shows a user's history from their right click menu.",
    authors: [{ name: "centoventotto", id: 838808975558311948n }],
    tags: ["Servers", "Utility"],
    searchTerms: ["moderation", "ban", "timeout", "mute", "kick", "deleted", "logger", "audit"],
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    toolboxActions: {
        "Open Mod History Log"() {
            openHistoryModal();
        }
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic?: boolean; }) {
            if (!optimistic) cacheMessage(message);
        },
        MESSAGE_UPDATE({ message }: { message: RawMessage; }) {
            updateCachedMessage(message);
        },
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: { channelId: string; messages: RawMessage[]; }) {
            for (const message of messages) cacheMessage(message, channelId);
        },
        MESSAGE_DELETE({ id, channelId }: { id: string; channelId: string; }) {
            onMessageDelete(id, channelId);
        },
        MESSAGE_DELETE_BULK({ ids, channelId, guildId }: { ids: string[]; channelId: string; guildId?: string; }) {
            onBulkDelete(ids, channelId, guildId);
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: FluxVoiceState[]; }) {
            onVoiceStates(voiceStates);
        }
    },

    start() {
        loadEntries().catch(e => logger.error("Failed to load history", e));
        FluxDispatcher.addInterceptor(interceptor);

        if (typeof GuildMemberStore.getCommunicationDisabledUserMap === "function" && typeof GuildMemberStore.getCommunicationDisabledVersion === "function") {
            GuildMemberStore.addChangeListener(onMemberStoreChange);
            onMemberStoreChange();
        } else {
            logger.warn("GuildMemberStore has no timeout map, timeouts will only be seen from live member updates.");
        }
    },

    stop() {
        const interceptors: unknown[] = FluxDispatcher._interceptors ?? [];
        const index = interceptors.indexOf(interceptor);
        if (index !== -1) interceptors.splice(index, 1);

        GuildMemberStore.removeChangeListener(onMemberStoreChange);
        stopAuditLookups();
        resetTracker();
        saveEntries();
    }
});
