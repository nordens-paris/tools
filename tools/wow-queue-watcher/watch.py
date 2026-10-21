"""WoW Queue Watcher - watches the WoW Forever login queue, alerts your phone
through ntfy, and (optionally) reconnects for you.

    python watch.py                    run the watcher
    python watch.py --standby          run it, but wait for a start command from the phone
    python watch.py sim                fast-forward simulation against a fake game (no phone pushes)
    python watch.py sim --live         same, but really send the pushes to your phone
    python watch.py test-notify        send a test push and listen for button presses
    python watch.py test-capture       screenshot + OCR the running game once
    python watch.py test-ocr IMG...     OCR saved screenshots (e.g. from a stream)
    python watch.py test-launch        launch the game the way the watcher will
    python watch.py test-sound         play the PC alarm sound for 15 s
"""
import argparse
import logging
import os
import shutil
import sys
import time

from PIL import Image

from wqw import config as C
from wqw import vision as V
from wqw.notify import CommandListener, Notifier

# Next to the .exe when packaged with PyInstaller, next to this file otherwise.
HERE = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


def setup_logging(data_dir, verbose=False):
    os.makedirs(data_dir, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%H:%M:%S")
    log = logging.getLogger("wqw")
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    log.handlers.clear()
    for h in (logging.StreamHandler(sys.stdout), logging.FileHandler(os.path.join(data_dir, "wqw.log"), encoding="utf-8")):
        h.setFormatter(fmt)
        log.addHandler(h)
    return log


def load_cfg(args, log=None):
    path = os.path.abspath(args.config)
    example = os.path.join(os.path.dirname(path), "config.example.toml")
    if not os.path.exists(path) and os.path.exists(example):
        # config.toml holds your private phone topic, so it isn't in git - start from the example.
        shutil.copyfile(example, path)
    if not os.path.exists(path):
        sys.exit(f"Config file not found: {path}")
    cfg = C.load(path)
    if C.ensure_topic(cfg, path):
        line = "=" * 64
        print(f"\n{line}\n  FIRST RUN - your private phone topic is:  {cfg.ntfy.topic}\n"
              f"  In the ntfy app: + > Subscribe to topic > {cfg.ntfy.topic}\n"
              f"  (saved in {os.path.basename(path)} - keep it to yourself)\n{line}\n")
    say = log.info if log else print
    if getattr(args, "beta", False):
        # Same settings and phone topic, but aimed at the Forever beta client.
        g = cfg.game
        g.game_dir = os.path.join(os.path.dirname(os.path.normpath(g.game_dir)), "_classic_beta_")
        g.process_name, g.launch_code = "WowB.exe", "wow_classic_beta"
        say("BETA mode: watching the WoW Forever beta (select 'WoW: Forever - Beta' in Battle.net)")
    for note in C.autodetect(cfg):
        say(note)
    try:
        cfg.game.ocr_language, warning = V.pick_language(cfg.game.ocr_language)
        if warning:
            (log.warning if log else print)(warning)
    except RuntimeError as e:
        sys.exit(str(e))
    return cfg


def cmd_run(args):
    from wqw import winapi
    from wqw.dashboard import serve
    from wqw.game import GameSource, RealClock
    from wqw.watcher import Watcher

    data_dir = os.path.join(HERE, "logs")
    log = setup_logging(data_dir, args.verbose)
    cfg = load_cfg(args, log)
    if _already_running(cfg):
        log.error("A watcher is already running (dashboard on port %s). Stop it first with stop.bat, "
                  "or send 'quit' from your phone.", cfg.dashboard.port)
        return
    if args.standby:
        cfg.schedule.standby = True
    winapi.make_dpi_aware()
    winapi.keep_awake(True)
    notifier = Notifier(cfg, log)
    w = Watcher(cfg, GameSource(cfg, log), RealClock(), notifier, log, data_dir)
    CommandListener(notifier, w.command, log).start()
    if cfg.dashboard.enabled:
        serve(w, cfg.dashboard.host, cfg.dashboard.port, log)
    log.info("Phone topic: %s/%s  (commands: %s)", cfg.ntfy.server, cfg.ntfy.topic, notifier.cmd_url)
    log.info("Auto-reconnect: %s | press Ctrl+C to stop", "ON" if cfg.reconnect.enabled else "off")

    # Closing the console window kills Python outright; Windows gives a close handler ~5 s,
    # enough to tell the phone the watcher is gone.
    import ctypes

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)
    def on_console_close(event):
        if event in (2, 5, 6):  # CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT
            notifier.send("WoW queue watcher stopped", "The watcher window was closed.", "high", ("stop_sign",))
        return False

    ctypes.windll.kernel32.SetConsoleCtrlHandler(on_console_close, True)
    try:
        w.run()
    except KeyboardInterrupt:
        w.running = False
    finally:
        winapi.keep_awake(False)


def _already_running(cfg):
    import requests
    try:
        return requests.get(f"http://127.0.0.1:{cfg.dashboard.port}/api/state", timeout=2).ok
    except requests.RequestException:
        return False


def cmd_sim(args):
    from wqw.dashboard import serve
    from wqw.sim import SimClock, SimGame
    from wqw.watcher import Watcher
    from wqw import vision

    data_dir = os.path.join(HERE, "logs", "sim")
    log = setup_logging(data_dir, args.verbose)
    cfg = load_cfg(args)
    cfg.alerts.local_sound = args.sound
    cfg.schedule.start_at = ""
    cfg.schedule.standby = args.standby
    clock = SimClock(args.slow)
    notifier = Notifier(cfg, log, dry_run=not args.live)
    game = SimGame(clock, log)
    w = Watcher(cfg, game, clock, notifier, log, data_dir)
    if args.dashboard:
        serve(w, cfg.dashboard.host, cfg.dashboard.port, log)

    # Stop a couple of virtual minutes after reaching the world (or after 6 virtual hours).
    def stop_when(wt):
        if wt.state == vision.IN_GAME and clock.now() - wt.state_since > 120:
            return True
        return clock.now() - wt.started > 6 * 3600

    w.stop_when = stop_when
    t0 = time.time()
    w.run()
    log.info("Simulated %.0f virtual minutes in %.0f real seconds. Log: %s",
             (clock.now() - w.started) / 60, time.time() - t0, os.path.join(data_dir, "wqw.log"))


def cmd_test_notify(args):
    from wqw.sim import SimClock, SimGame

    log = setup_logging(os.path.join(HERE, "logs"), args.verbose)
    cfg = load_cfg(args)
    n = Notifier(cfg, log)
    game = SimGame(SimClock(), log, server_down_attempts=0)
    game.launch()
    game.clock.sleep(25)
    ok = n.send("Test from WoW Queue Watcher", "If you can read this, phone alerts work. Try the buttons.",
                "high", ("test_tube",), ("ack", "status"), game.grab())
    if not ok:
        log.error("Sending failed - check the [ntfy] settings and your internet connection.")
        return
    log.info("Sent to %s/%s. Listening 90 s for button presses / messages on %s ...",
             cfg.ntfy.server, cfg.ntfy.topic, n.cmd_url)
    CommandListener(n, lambda text, origin: log.info("Got command from phone: %r", text), log).start()
    time.sleep(90)
    if args.alarm:
        log.info("Sending a max-priority alarm-style push now.")
        n.send("Test ALARM", "This is what the queue alarm looks like.", "max", ("rotating_light",), ("ack",))


def cmd_test_sound(args):
    from wqw.notify import LocalAlarm

    cfg = load_cfg(args)
    print("Playing the PC alarm for 15 seconds (it gets a bit louder after a minute in a real alarm)...")
    alarm = LocalAlarm(True, cfg.alerts.alarm_sound)
    alarm.start()
    time.sleep(15)
    alarm.stop()


def cmd_test_capture(args):
    from wqw import winapi
    from wqw.game import GameSource

    data_dir = os.path.join(HERE, "logs")
    log = setup_logging(data_dir, args.verbose)
    cfg = load_cfg(args)
    winapi.make_dpi_aware()
    src = GameSource(cfg, log)
    if not src.process_running():
        log.error("No %s running from %s. Start WoW Forever first.", cfg.game.process_name, cfg.game.game_dir)
        return
    img = src.grab()
    if img is None:
        log.error("Found the game but couldn't capture it (is it minimized?).")
        return
    out = os.path.join(data_dir, "capture-test.png")
    img.save(out)
    log.info("Saved %s (%dx%d)", out, *img.size)
    _print_reading(V.read(img, cfg))


def cmd_test_ocr(args):
    cfg = load_cfg(args)
    for path in args.images:
        print(f"\n=== {path}")
        _print_reading(V.read(Image.open(path), cfg))


def cmd_test_launch(args):
    from wqw.game import GameSource

    log = setup_logging(os.path.join(HERE, "logs"), args.verbose)
    cfg = load_cfg(args)
    src = GameSource(cfg, log)
    if src.process_running():
        log.info("WoW Forever is already running.")
        return
    src.launch()
    for i in range(90):
        if src.process_running():
            log.info("WoW Forever started after %d s - launching works.", i)
            return
        time.sleep(1)
    log.error("WoW didn't start within 90 s. Check launch_code / launch_method in config.toml.")


def _print_reading(r):
    print(f"Screen:        {r.state}")
    print(f"Position:      {r.position}")
    print(f"Blizzard ETA:  {r.blizzard_eta} min")
    print(f"Error code:    {r.error_code}")
    print("OCR text:\n  " + (r.text.replace("\n", "\n  ") or "(nothing)"))


def main():
    p = argparse.ArgumentParser(description="WoW Forever queue watcher")
    p.add_argument("--config", default=os.path.join(HERE, "config.toml"))
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--beta", action="store_true", help="watch the WoW Forever beta client instead of the live game")
    p.add_argument("--standby", action="store_true",
                   help="don't launch yet - wait for 'start' / 'start 18:30' / 'start in 45m' from the phone")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("run")
    s = sub.add_parser("sim")
    s.add_argument("--live", action="store_true", help="really send pushes to your phone")
    s.add_argument("--sound", action="store_true", help="play the local alarm sound")
    s.add_argument("--dashboard", action="store_true")
    s.add_argument("--slow", type=float, default=0.0, help="real seconds per virtual second, e.g. 0.02")
    t = sub.add_parser("test-notify")
    t.add_argument("--alarm", action="store_true", help="also send a max-priority alarm push")
    sub.add_parser("test-capture")
    sub.add_parser("test-sound")
    o = sub.add_parser("test-ocr")
    o.add_argument("images", nargs="+")
    sub.add_parser("test-launch")
    args = p.parse_args()
    {None: cmd_run, "run": cmd_run, "sim": cmd_sim, "test-notify": cmd_test_notify,
     "test-capture": cmd_test_capture, "test-sound": cmd_test_sound, "test-ocr": cmd_test_ocr, "test-launch": cmd_test_launch}[args.cmd](args)


if __name__ == "__main__":
    main()
