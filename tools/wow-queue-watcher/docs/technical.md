# WoW Queue Watcher

Watches the WoW Forever login queue on your PC, sends your Android phone push
notifications with the time left, wakes you with an alarm when the queue gets
short, and (optionally, off by default) can click or relaunch its way back in after a disconnect.

It works by taking screenshots of the game window and reading them with the
built-in Windows OCR. It never reads or changes game memory or files.

## What it does

| When | Phone gets |
|---|---|
| You get into the queue | Position, Blizzard's estimate and a screenshot |
| Every 30 min | A quiet update: position, Blizzard ETA, measured-pace ETA, "in at ~03:40" |
| ETA ≤ 30 min | High-priority heads-up |
| ETA ≤ 15 min | **ALARM**: max priority, repeats until you tap **I'm up**. The PC speakers sound too. |
| Queue finished (character select) | **ALARM** with an **Enter world** button you can tap from bed |
| Disconnect, crash or closed game | Alert with a screenshot. With auto-reconnect on, it then tries to get back in automatically. |
| Not back in the queue after 20 min | **ALARM** |
| The watcher itself stops | Alert |

**ETA:** Blizzard's estimate is often off, so the watcher also measures how fast
your position is actually dropping. By default it alerts on whichever ETA is
sooner (`eta_source = "earliest"`).

**Auto-reconnect** (`[reconnect]`, **off by default**, turn on with `enabled = true`): on an error or login screen it clicks
`Okay` / `Login` / `Reconnect` (or presses Enter). If the game crashed or closed,
it relaunches it through Battle.net (opens the game's page and clicks Play). If it's stuck for 8 minutes, it kills the
game and relaunches. It never clicks anything while you're in the queue.

**Scheduled start** (`[schedule] start_at`, or `start 18:30` from your phone):
leave it running before server opening and it launches the game at that time.
Until then it keeps the PC awake. Once the game is up, it keeps retrying while
the servers are still down.

**Dashboard:** http://localhost:8765 shows a live graph, the latest screenshot,
an event log and the same buttons as the phone.

## Phone setup (Android, about 3 minutes)

1. Install **ntfy** from the Play Store (or F-Droid).
2. Tap **+**, choose *Subscribe to topic*, and enter your topic from `config.toml`
   (`topic = "wqw-..."`). `config.toml` is created from `config.example.toml` on the first
   run and is git-ignored, because the topic is private. Turn on **Use another server** only if you changed `server`.
3. Make the alarm able to wake you:
   - ntfy, then **Settings**: turn on **Keep alerting for highest priority** (the
     alarm keeps ringing until you dismiss it).
   - Open the topic, then the **⋮** menu, then **Settings / Notifications**: set the
     **Max priority** channel to *Override Do Not Disturb* with a loud sound.
   - Android **Settings, Apps, ntfy, Battery**: set it to **Unrestricted** so
     notifications aren't delayed while the phone sleeps.
4. On the PC, run `start.bat test-notify --alarm` from a terminal in this folder.
   You should get a test push with a screenshot. Tap its buttons and the PC window
   prints what it received.

> `start.bat <args>` is the shortcut for `python watch.py <args>` everywhere in
> this guide. Double-clicking `start.bat` with no arguments starts the watcher.

Sending commands: type them in the ntfy app, in the same topic the alerts
arrive in (the text box at the bottom). The watcher's own alerts have a title and
your messages don't, which is how it tells them apart.

## Stopping the watcher

- **From your phone:** send `quit`.
- **On the PC:** double-click **`stop.bat`**. This also works when the watcher runs
  without a window. It first asks the watcher to stop, so you still get the
  "stopped" push.
- **Dashboard:** the **Quit watcher** button.
- Close the `start.bat` / `standby.bat` window.

To close the game yourself while the watcher keeps running, send `standby` (or
`pause`) first. Otherwise auto-reconnect treats it as a crash and starts the game
again.

Starting a second watcher while one is already running just shows a message
and exits.

## Starting the queue from your phone (when you're out)

Before you leave, double-click **`standby.bat`** (or `start-beta.bat --standby` for
the beta). The watcher keeps the PC awake and launches nothing until you tell it to.
Then, from anywhere, type in your ntfy alerts topic:

| Send | What happens |
|---|---|
| `start` (or tap **Start now**) | Launches WoW and joins the queue right away |
| `start 18:30` | Launches at 18:30. A time that has already passed today means tomorrow. |
| `start in 45m` / `start in 1h30` / `start in 2 hours` | Launches after that delay |
| `cancel` | Cancels a scheduled start and goes back to standby |
| `standby` | Stops watching and goes back to standby. The game is left as it is. |

You get a push confirming each one. When it starts, you get the usual queue
pushes: position, Blizzard's estimate and "in at ~19:40". Use them to judge
whether you'll be home in time.

All commands:

| Command | Does |
|---|---|
| `status` | Status text plus a screenshot |
| `ack` | Stops the alarm |
| `enter` | Presses Enter World at character select |
| `reconnect` | Kills and relaunches the game |
| `pause` / `resume` | Stops or restarts clicking and relaunching. Alerts continue. |
| `quit` | Stops the watcher |

## PC checklist for the night

- WoW in **windowed fullscreen**, *not minimized*. Other windows on top are fine.
- **Don't lock the PC** (Win+L). Windows blocks screenshots and clicks on the lock
  screen. The watcher already stops the PC from sleeping and the screen from
  turning off.
- Windows Update: set *active hours* to cover the night so it doesn't reboot.
- Battle.net: stay logged in ("keep me logged in") so relaunching doesn't need a password.
- Optional: set `[health] ping_url` to a free https://healthchecks.io check and
  connect healthchecks.io to ntfy. Then you also get alerted if the whole PC or
  your internet dies.

## Tested on the Forever beta (2026-10-20)

`start-beta.bat` (or `start.bat --beta <command>`) watches the beta client
(`_classic_beta_\WowB.exe`). These were verified on the real client:

- **Launching:** `Battle.net.exe --exec="launch WoWF"` starts the game exactly
  like the Play button, with no clicking, and you go straight to character select
  with no password. `WoWF` is case-sensitive. It starts whichever version is picked
  in Battle.net's version dropdown on the Forever page, so on launch day select
  **WoW: Forever**, not the Beta. If the game doesn't start within 30 s, the watcher
  falls back to opening the Forever page and clicking **Play**.
- **Crash recovery:** with the game killed mid-run, the watcher relaunched it and
  was back at character select in about 30 s.
- **Wrong version:** if Battle.net starts a different WoW version than the
  config watches (e.g. the Beta while `start.bat` watches the live game), you
  get a "Wrong WoW version running" push. It never starts a second copy.

`start.bat` watches the **live** game. `start-beta.bat` watches the **beta**.
- **Screens recognized:** character select; the logged-out screen (**Reconnect** /
  **Log Out**); the email/password screen.
- **Recovery:** on the logged-out screen it clicks **Reconnect** and you're back at
  character select. Alarm push, **I'm up** and **Enter world** from the phone all worked.
- **Password screen** (the game was started without Battle.net): it never types
  anything and never pushes that screenshot (it shows your email). It closes the
  game and restarts it through Battle.net.

- **Queue dialog:** checked against a real beta queue screenshot (PC Gamer,
  September 2026). It reads "Login Servers are Full / Position in queue: 16862 /
  Estimated time: 36 min" and has a **Cancel** button. The watcher reads it with
  a gold-text OCR pass. It never clicks or restarts anything while it sees
  "queue", "servers are full", "estimated" or "position in", and it never presses
  Enter blindly (on this dialog, Enter means Cancel).

Still untested: whether `battlenet://wowf` picks the live Forever version on
launch day. Once Forever is out, run `start.bat test-launch` once.

To check the queue dialog early, use screenshots of a real queue:

```
start.bat test-ocr shot1.png shot2.jpg
```

If a screen is classified wrong, add the words OCR printed to the matching list
under `[screens]` in `config.toml`.

Good sources for queue screenshots: Classic launch (2019) and Anniversary launch
(2024) streams or VODs show the same "Realm is Full / Position in queue /
Estimated time" dialog. Pause on it and take a screenshot (Win+Shift+S) at the
same resolution you play at.

## Testing without the game

`start.bat sim` runs the full watcher against a fake game in fast-forward.
The scenario: servers are down, then you get a disconnect, a crash, the alarms,
character select, and finally the world. It prints the pushes instead of sending
them. Add `--live` to really send them, or `--dashboard --slow 0.02` to watch it
on the dashboard.

## Settings worth knowing

All of them are in `config.toml` with comments. The most important ones:

- `alarm_minutes`, `heads_up_minutes`, `update_every_minutes`
- `[reconnect] enabled`: off by default ("watch only"). Turn on for auto-reconnect.
- `auto_enter_world`: if nobody answers the queue-done alarm within 10 minutes,
  press Enter World so the character-select idle timer doesn't kick you.
  Off by default, and only works with `[reconnect] enabled = true`.
- `start_at = "2026-11-04 18:00"`

## A note on the rules

Reading the screen and sending yourself notifications doesn't interact with the
game. The auto-reconnect and Enter-world features *do* send clicks and key
presses to the game. Blizzard's Terms of Use don't allow unauthorized
automation, though this does nothing during gameplay. That's why they're off by
default. Turn them on with `[reconnect] enabled = true` at your own discretion.
