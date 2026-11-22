# Less Chat for Foundry VTT v14

Less Chat keeps the chat window small during play. By default it displays the
50 most recent messages visible to you. Scroll to the top to load 20 older
messages at a time. When you return to the bottom, it removes the extra cards
from the window. Foundry keeps the messages in the world's chat history.

Both limits are configurable per client. The sidebar and popout each maintain
their own scroll position. Foundry handles posting, notifications, and whisper
replies, including `/reply`.

## Installation from source

Building requires Node.js, npm, GNU Make, and standard Unix command-line tools.
Run these commands from the repository root.

```sh
npm ci
make all VERSION=v2.1.0
```

Copy the contents of `dist/` into `Data/modules/less-chat/` in your Foundry
user data directory. Restart Foundry and enable **Less Chat** in your world.
This fork uses the original module ID and existing client settings. Installing
it in that directory replaces the original module files.

## Compatibility

The manifest declares a minimum of Foundry VTT 13.344. The v14 port was tested
in Chromium against Foundry 14.370's chat log with simulated world data.
Testing in a live world and on a v13 runtime is still pending.

## Attribution and license

Trent Piepho created the [original Less Chat module](https://github.com/xyzzy42/less-chat)
in 2025. In November 2026, Wyderar adapted it for Foundry VTT v14 with
assistance from OpenAI Codex.

Less Chat is free software under the GNU General Public License, version 3 or
any later version (`GPL-3.0-or-later`). The build includes the full [license](LICENSE).
