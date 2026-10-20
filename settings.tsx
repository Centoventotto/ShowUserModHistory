/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { ManageHistory } from "./components/ManageHistory";

export const settings = definePluginSettings({
    logTimeouts: {
        type: OptionType.BOOLEAN,
        description: "Log timeouts (mutes) with start, end, duration and remaining time.",
        default: true
    },
    logTimeoutRemovals: {
        type: OptionType.BOOLEAN,
        description: "Log when a timeout is removed before it ends.",
        default: true
    },
    logBans: {
        type: OptionType.BOOLEAN,
        description: "Log bans and unbans, including probable bans detected from message purges.",
        default: true
    },
    logMemberRemovals: {
        type: OptionType.BOOLEAN,
        description: "Log members leaving a server or getting kicked.",
        default: true
    },
    logVoiceMutes: {
        type: OptionType.BOOLEAN,
        description: "Log server mutes and server deafens in voice channels.",
        default: true
    },
    logDeletedMessages: {
        type: OptionType.BOOLEAN,
        description: "Log deleted messages with their content and who most likely deleted them.",
        default: true
    },
    logBulkDeletes: {
        type: OptionType.BOOLEAN,
        description: "Log messages removed by bulk deletions, like purges and bans that wipe message history.",
        default: true
    },
    logDirectMessages: {
        type: OptionType.BOOLEAN,
        description: "Also log deleted messages in DMs and group DMs.",
        default: false
    },
    ignoreOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Don't log your own deleted messages.",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Don't log anything about bots.",
        default: true
    },
    useAuditLog: {
        type: OptionType.BOOLEAN,
        description: "On servers where you can view the audit log, read it to find out who did it and why.",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a ban or a timeout happens.",
        default: false
    },
    contextMenuButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Show Mod History button when you right click a user.",
        default: true
    },
    maxEntries: {
        type: OptionType.SLIDER,
        description: "Maximum number of saved events. The oldest deleted messages are dropped first.",
        markers: [1000, 2500, 5000, 10000, 20000],
        default: 5000,
        stickToMarkers: true
    },
    messageCacheSize: {
        type: OptionType.SLIDER,
        description: "How many recent messages to remember, so their content is known if they get deleted.",
        markers: [1000, 2500, 5000, 10000, 20000],
        default: 5000,
        stickToMarkers: true
    },
    manage: {
        type: OptionType.COMPONENT,
        description: "Open, export or clear the saved history.",
        component: ManageHistory
    }
});
