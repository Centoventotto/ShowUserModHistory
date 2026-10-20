# ShowUserModHistory

An [Equicord](https://github.com/Equicord/Equicord) plugin that keeps a moderation history for every user you come across: **bans, timeouts (mutes), kicks, leaves, voice server mutes/deafens and deleted messages**.

It works **without moderator permissions**. Discord sends a lot of moderation-related data to every member of a server (it's what you can see in DevTools): member updates with the timeout end date, members disappearing from the server, bulk message deletions, voice states and so on. The plugin listens to those events, connects them together and stores everything locally.

Right click any user and pick **Show Mod History** to open their history.

## Features

| | What is logged | Details collected |
|---|---|---|
| ⏳ | **Timeouts** | Detection date, start time, end time, duration (recognises Discord presets like 1 hour or 1 day), live countdown of the remaining time, early removal, changes to an existing timeout |
| ✅ | **Timeout removed early** | When it was removed, time served, time skipped |
| 🔨 | **Bans** | Confirmed bans (`GUILD_BAN_ADD`), *probable* bans (member removed and their messages wiped at the same time), *possible* bans (all messages of one user purged at once), unbans |
| 👢 🚪 | **Kicks and leaves** | Join date and how long they were a member, nickname, roles, active timeout at the time |
| 🔇 🎧 | **Voice server mutes / deafens** | Channel, start, end |
| 🗑️ | **Deleted messages** | Content, attachments, stickers, embeds, reply, sent time, edit time, deletion time, how long the message lived, single or bulk deletion, **who most likely deleted it** |

Every event shows a confidence badge:

- **✔ Confirmed**: seen directly in an event from Discord or in the audit log.
- **≈ Probable**: deduced from events that happened together (for example a member vanishing while their messages are bulk deleted).
- **? Unverified**: a best guess, Discord doesn't send enough information to be sure.

### Who deleted a message?

Discord never tells regular members who deleted a message, so the plugin works it out:

- In DMs only the author can delete, so it's the author.
- If the author was banned, kicked, removed or timed out at the same moment, it was most likely a moderator.
- Bulk deletions are purges or bans that wipe message history.
- **If you can view the audit log** of the server, the plugin reads it and shows the exact moderator and reason for deletions, bans, kicks, timeouts and voice mutes. When the audit log has no entry for a deletion, the author deleted it themselves.

### Interface

- **Show Mod History** in the user right click menu.
- A header with avatar, ID, account creation date and the **current status** (active timeout with live countdown, voice mute, ban).
- Category filters with counters: 📜 All, ⏳ Timeouts, 🔨 Bans, 🚪 Kicks & leaves, 🔇 Voice, 🗑️ Deleted messages.
- Server filter and full text search (message content, reasons, moderators, servers).
- A timeline grouped by day, every event with its own coloured card and emoji labels.
- 🔄 **Re-check** asks Discord for fresh member data of that user.
- Export to JSON, copy a single event, remove events, clear a user or everything.
- A global log of every user from the Equicord toolbox (**Open Mod History Log**) or from the plugin settings.
- Right click a server and pick **Stop logging in Mod History** to blacklist it (and **Resume logging in Mod History** to undo).

### Settings

Every feature can be turned on or off on its own:

- Log timeouts / log early timeout removals
- Log bans / log kicks and leaves
- Log voice server mutes and deafens
- Log deleted messages / log bulk deletions / log deletions in DMs
- Ignore your own messages / ignore bots
- Server blacklist: servers that are never logged, editable as a list of IDs or from the server right click menu, with the blacklisted servers listed by name in the settings
- Use the audit log when you have access to it
- Notifications when a ban or timeout happens
- Show or hide the **Show Mod History** button
- Maximum number of saved events and size of the message cache

## Installation

ShowUserModHistory is a user plugin, so you need to build Equicord from source.

1. Set up the Equicord devbuild as described in the [Equicord README](https://github.com/Equicord/Equicord#installing-equicord-devbuild):
   ```sh
   git clone https://github.com/Equicord/Equicord
   cd Equicord
   pnpm install --frozen-lockfile
   ```
2. Download `ShowUserModHistory.zip` from the [latest release](https://github.com/centoventotto/ShowUserModHistory/releases/latest).
3. Extract it into `Equicord/src/userplugins/`, so you end up with `Equicord/src/userplugins/ShowUserModHistory/index.tsx`.
   You can also clone this repository there directly:
   ```sh
   cd Equicord/src/userplugins
   git clone https://github.com/centoventotto/ShowUserModHistory
   ```
4. From the `Equicord` folder, build and inject:
   ```sh
   pnpm build
   pnpm inject
   ```
5. Restart Discord and enable **ShowUserModHistory** in Settings → Equicord → Plugins.

## Limitations

- Only events that happen **while Discord is open** with the plugin enabled can be logged. Older history isn't available, except what the audit log still contains if you can read it.
- Discord only sends member data for members your client has loaded (member list, chat, voice). Timeouts of members you never see can't be detected, and a timeout already running when first seen has an unknown start time (it is marked as such).
- Without audit log access Discord doesn't say whether a member who disappeared left, was kicked or was banned. The plugin marks bans as *probable* or *possible* based on message purges, and confirms them when a ban event or the audit log says so.
- Deleted message content is only known if the message was loaded or received by your client before being deleted.
- Everything is stored locally in Discord's IndexedDB through Equicord's DataStore. Nothing is sent anywhere.

## License

GPL-3.0-or-later, like Equicord and Vencord.
