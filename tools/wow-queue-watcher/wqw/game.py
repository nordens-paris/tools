"""The real game: what the watcher sees and does on your PC. sim.py offers the
same methods against a fake game for testing."""
import os
import subprocess
import time

from . import vision, winapi


class RealClock:
    def now(self):
        return time.time()

    def sleep(self, seconds):
        time.sleep(seconds)


class GameSource:
    def __init__(self, cfg, log):
        self.g = cfg.game
        self.log = log

    def _pids(self):
        return winapi.find_pids(self.g.process_name, self.g.game_dir)

    def _hwnd(self):
        pids = self._pids()
        return winapi.find_main_window(pids) if pids else None

    def process_running(self):
        return bool(self._pids())

    def grab(self):
        hwnd = self._hwnd()
        if not hwnd or winapi.is_minimized(hwnd):
            return None
        return winapi.capture(hwnd)

    def click(self, x, y, double=False):
        hwnd = self._hwnd()
        if hwnd:
            winapi.focus(hwnd)
            winapi.click(hwnd, x, y, double)

    def show(self):
        hwnd = self._hwnd()
        if hwnd:
            winapi.focus(hwnd)

    def key(self, name):
        hwnd = self._hwnd()
        if hwnd:
            winapi.focus(hwnd)
            winapi.press(name)

    def launch(self):
        if self.g.launch_method == "direct":
            # Note: a direct start lands on the email/password screen.
            exe = os.path.join(self.g.game_dir, self.g.process_name)
            self.log.info("Launching %s", exe)
            subprocess.Popen([exe], cwd=self.g.game_dir)
            return True
        if self._launch_exec():
            return True
        if self.other_versions():
            # Battle.net started a different WoW version than the one we watch (its version
            # dropdown is on another entry). Clicking Play would only start yet another copy.
            return False
        if self.g.launch_method == "battlenet-exec":
            return False
        self.log.warning("Battle.net didn't start the game by itself - trying its Play button")
        return self._launch_play_button()

    def _launch_exec(self):
        """Ask Battle.net to start the game family, exactly like pressing Play (the game gets
        "-launcherlogin" and logs in with your Battle.net session - no password, no clicks).
        It starts whichever version is selected in Battle.net's version dropdown."""
        self.log.info('Starting through Battle.net (--exec="launch %s")', self.g.launch_family)
        subprocess.Popen([self.g.battlenet_exe, f"--exec=launch {self.g.launch_family}"])
        # On the beta this starts the game within 2 s. On the live / stress-test product Battle.net
        # only selects the game and nothing starts, so don't wait long before clicking Play.
        for _ in range(5):
            time.sleep(2)
            if self.process_running():
                return True
            if others := self.other_versions():
                self.log.warning("Battle.net started %s instead of the game in %s", others[0], self.g.game_dir)
                return False
        return False

    def other_versions(self):
        """Paths of other WoW clients (Wow.exe, WowB.exe, ...) that are running but are not
        the one in game_dir - e.g. the beta when we're set up for the live game."""
        mine = set(self._pids())
        root = os.path.normcase(os.path.dirname(os.path.normpath(self.g.game_dir)))
        paths = []
        for pid in winapi.find_pids("wow*.exe"):
            path = winapi.process_path(pid)
            if pid not in mine and path and os.path.normcase(path).startswith(root + os.sep):
                paths.append(path)
        return paths

    def _launch_play_button(self):
        """Fallback: open the game's page in Battle.net and click its Play button."""
        self.log.info("Opening battlenet://%s and clicking Play", self.g.launch_code)
        os.startfile(f"battlenet://{self.g.launch_code}")
        for _ in range(15):
            time.sleep(2)
            pids = winapi.find_pids("Battle.net.exe")
            hwnd = winapi.find_main_window(pids) if pids else None
            if not hwnd:
                continue
            if winapi.is_minimized(hwnd):
                winapi.focus(hwnd)
                continue
            reading = vision.Reading("", *vision.ocr(winapi.capture(hwnd), self.g.ocr_language, 1.5))
            if self.process_running():
                self.log.info("Battle.net says the game is already running")
                return True
            if pt := _play_button(reading):
                winapi.focus(hwnd)
                winapi.click(hwnd, *pt)
                self.log.info("Clicked Play in Battle.net")
                return True
            for blocker in ("Update", "Install", "Log In"):
                if vision.find_text(reading, blocker):
                    self.log.warning("Battle.net shows '%s' instead of Play", blocker)
                    return False
        self.log.warning("Couldn't find the Play button in Battle.net")
        return False

    def kill(self):
        for pid in self._pids():
            self.log.info("Killing Wow.exe pid %s", pid)
            winapi.kill_pid(pid)
        time.sleep(3)


def _play_button(reading):
    """Centre of Battle.net's Play button. The button's text stands on a line of its own, so prefer
    that over a "Play ..." sentence in a news tile; the biggest such text is the button."""
    alone = [ln for ln in reading.lines if vision.norm(" ".join(w.text for w in ln)) == "play"]
    if alone:
        ln = max(alone, key=lambda ln: max(w.h for w in ln))
        x0, y0 = min(w.x for w in ln), min(w.y for w in ln)
        x1, y1 = max(w.x + w.w for w in ln), max(w.y + w.h for w in ln)
        return (x0 + x1) / 2, (y0 + y1) / 2
    return vision.find_text(reading, "Play")
