"""A fake WoW for testing the whole watcher in fast-forward: it draws login,
queue, disconnect and character-select screens as images (so the real OCR runs)
and reacts to clicks and key presses.

Scenario: servers are down for the first two connection attempts, then the account screen,
the queue, and - once the queue is done - the gameplay-ruleset screen (before character select). You get
disconnected 15 min into the queue, the game crashes 8 min into the next queue,
then the queue finishes and you "wake up" and enter the world 4 min later."""
import random
import time

from PIL import Image, ImageDraw, ImageFont


class SimClock:
    """Virtual time: sleep() jumps forward instead of waiting."""

    def __init__(self, real_factor=0.0):
        self.t = time.time()
        self.real_factor = real_factor  # >0 = also really wait (virtual seconds x factor)

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds
        time.sleep(max(0.005, seconds * self.real_factor))


def _font(size, bold=False):
    try:
        return ImageFont.truetype("arialbd.ttf" if bold else "arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


class SimGame:
    W, H = 1280, 720

    def __init__(self, clock, log, start_pos=1500, rate_per_min=30, server_down_attempts=2,
                 dc_after_min=15, crash_after_min=8, places_lost=350, wake_after_min=4,
                 account_screen=True, ruleset_screen=True, ruleset_user_after_min=5):
        self.clock, self.log = clock, log
        self.rate = rate_per_min / 60
        self.start_pos = start_pos
        self.server_down = server_down_attempts
        self.dc_after = dc_after_min * 60
        self.crash_after = crash_after_min * 60
        self.places_lost = places_lost
        self.wake_after = wake_after_min * 60
        self.queue_sessions = 0
        self.account_done = not account_screen
        self.ruleset_done = not ruleset_screen
        self.ruleset_pick = None  # always None: the watcher never chooses a ruleset
        self.ruleset_user_after = ruleset_user_after_min * 60  # when "you" would pick one yourself
        self.screen = "off"
        self.since = clock.now()
        self.pos = None
        self.queue_pos0 = None
        self.buttons = {}
        self.f = _font(22)
        self.fb = _font(22, bold=True)
        self.fbig = _font(30, bold=True)

    def _go(self, screen):
        if screen != self.screen:
            self.log.info("  [sim] %s -> %s", self.screen, screen)
        self.screen, self.since = screen, self.clock.now()

    def _elapsed(self):
        return self.clock.now() - self.since

    def _advance(self):
        el = self._elapsed()
        if self.screen == "connecting" and el >= 20:
            if self.server_down > 0:
                self.server_down -= 1
                self._go("server_down")
            else:
                self._after_login()
        elif self.screen == "ruleset" and el >= self.ruleset_user_after:
            self.log.info("  [sim] you picked a ruleset yourself")
            self.ruleset_done = True
            self._go("charselect")
        elif self.screen == "queue":
            self.pos = max(0, int(self.queue_pos0 - self.rate * el))
            if self.queue_sessions == 1 and el >= self.dc_after:
                self._go("dc")
            elif self.queue_sessions == 2 and el >= self.crash_after:
                self.log.info("  [sim] game crashed")
                self._go("off")
            elif self.pos == 0:
                self._go("charselect" if self.ruleset_done else "ruleset")
        elif self.screen == "charselect" and el >= self.wake_after:
            self.log.info("  [sim] you woke up and pressed Enter World")
            self._go("ingame")

    def _after_login(self):
        """Next screen once the connection is up: account (first time only) -> queue."""
        if not self.account_done:
            self._go("account")
        else:
            self.queue_sessions += 1
            self.queue_pos0 = self.start_pos if self.pos is None else self.pos + self.places_lost
            self.pos = self.queue_pos0
            self._go("queue")

    # --- the same interface as game.GameSource -----------------------------

    def process_running(self):
        self._advance()
        return self.screen != "off"

    def grab(self):
        self._advance()
        return self._render()

    def click(self, x, y, double=False):
        for name, (x0, y0, x1, y1) in self.buttons.items():
            if x0 - 5 <= x <= x1 + 5 and y0 - 5 <= y <= y1 + 5:
                self.log.info("  [sim] clicked '%s'", name)
                self._press(name)
                return
        self.log.info("  [sim] click at (%d, %d) hit nothing", x, y)

    def key(self, name):
        self.log.info("  [sim] key %s", name)
        if name == "enter":
            default = {"dc": "Okay", "server_down": "Okay", "login": "Reconnect", "charselect": "Enter World",
                       "queue": "Cancel", "connecting": "Cancel"}
            if self.screen in default:
                self._press(default[self.screen])

    def show(self):
        pass

    def launch(self):
        if self.screen == "off":
            self._go("connecting")

    def kill(self):
        self._go("off")

    def _press(self, name):
        if self.screen in ("dc", "server_down") and name == "Okay":
            self._go("login")
        elif self.screen == "login" and name == "Reconnect":
            self._go("connecting")
        elif self.screen == "charselect" and name == "Enter World":
            self._go("ingame")
        elif self.screen == "queue" and name == "Cancel":
            self.log.warning("  [sim] QUEUE CANCELLED - the watcher threw away the queue spot!")
            self._go("login")
        elif self.screen == "connecting" and name == "Cancel":
            self._go("login")
        elif self.screen == "account" and name == "Accept":
            self.account_done = True
            self._after_login()


    # --- drawing -----------------------------------------------------------

    def _button(self, d, label, cx, cy):
        tw = d.textlength(label, font=self.fb)
        box = (cx - tw / 2 - 18, cy - 16, cx + tw / 2 + 18, cy + 18)
        d.rectangle(box, fill=(110, 12, 10), outline=(200, 160, 60), width=2)
        d.text((cx - tw / 2, cy - 12), label, font=self.fb, fill=(255, 210, 0))
        self.buttons[label] = box

    def _dialog(self, d, lines, button=None, height=220):
        x0, y0, x1, y1 = 380, 250, 900, 250 + height
        d.rectangle((x0, y0, x1, y1), fill=(12, 12, 14), outline=(150, 150, 160), width=3)
        y = y0 + 35
        for ln in lines:
            tw = d.textlength(ln, font=self.f)
            d.text(((self.W - tw) / 2, y), ln, font=self.f, fill=(255, 210, 0))
            y += 36
        if button:
            self._button(d, button, self.W / 2, y1 - 40)

    def _render(self):
        self.buttons = {}
        if self.screen == "ingame":
            rnd = random.Random(int(self.clock.now()) // 60)
            img = Image.new("RGB", (self.W, self.H), (40, 70, 35))
            d = ImageDraw.Draw(img)
            for _ in range(40):
                x, y = rnd.randrange(self.W), rnd.randrange(self.H)
                d.ellipse((x, y, x + 60, y + 40), fill=(30, rnd.randrange(60, 110), 30))
            return img
        img = Image.new("RGB", (self.W, self.H), (18, 22, 40))
        d = ImageDraw.Draw(img)
        if self.screen in ("login", "connecting", "server_down", "dc", "queue", "account"):
            d.text((470, 90), "WORLD OF WARCRAFT", font=self.fbig, fill=(200, 170, 80))
            d.text((20, self.H - 30), "Version 1.60.1 (sim)", font=_font(14), fill=(160, 160, 160))
        if self.screen == "login":
            self._button(d, "Reconnect", self.W / 2, 330)
            self._button(d, "Log Out", self.W / 2, 420)
            for i, label in enumerate(["Menu", "Create Account", "Quit"]):
                self._button(d, label, self.W - 120, 560 + i * 50)
        elif self.screen == "connecting":
            self._dialog(d, ["Connecting"], "Cancel")
        elif self.screen == "server_down":
            self._dialog(d, ["Unable to connect.", "Please try again later."], "Okay")
        elif self.screen == "dc":
            self._dialog(d, ["You have been disconnected from the server.", "(WOW51900319)"], "Okay")
        elif self.screen == "queue":
            eta = max(1, round(self.pos / (self.rate * 60 * 0.7)))  # Blizzard's estimate runs pessimistic
            self._dialog(d, ["Login Servers are Full", f"Position in queue: {self.pos}",
                             f"Estimated time: {eta} min"], "Cancel")
        elif self.screen == "account":
            self._dialog(d, ["World of Warcraft Accounts", "Select an account", "PLAYER1", "WoW1"], height=300)
            self._button(d, "Accept", self.W / 2 - 100, 500)
            self._button(d, "Cancel", self.W / 2 + 100, 500)
        elif self.screen == "ruleset":
            for text, y, font in (("Choose Your Gameplay Ruleset", 40, self.fbig),
                                  ("You will only be able to interact with players who choose the same ruleset.", 90, self.f)):
                tw = d.textlength(text, font=font)
                d.text(((self.W - tw) / 2, y), text, font=font, fill=(255, 255, 255) if y == 40 else (255, 210, 0))
            blurbs = {"Normal": ["This ruleset allows you", "to focus on adventuring", "and fighting monsters."],
                      "PvP": ["This ruleset allows you", "to focus on player", "versus player combat."],
                      "Roleplay": ["This ruleset has strict", "naming conventions and", "behavior rules."]}
            for i, title in enumerate(("Normal", "PvP", "Roleplay")):
                x0 = 150 + i * 360
                box = (x0, 150, x0 + 300, 560)
                chosen = self.ruleset_pick == title
                d.rectangle(box, fill=(40, 34, 20) if chosen else (24, 22, 28), outline=(255, 210, 0) if chosen else (110, 110, 120), width=3)
                tw = d.textlength(title, font=self.fb)
                d.text((x0 + (300 - tw) / 2, 175), title, font=self.fb, fill=(230, 190, 40))
                for j, ln in enumerate(blurbs[title]):
                    tw = d.textlength(ln, font=self.f)
                    d.text((x0 + (300 - tw) / 2, 300 + j * 30), ln, font=self.f, fill=(200, 200, 205))
                self.buttons[title] = box
            self._button(d, "Cancel", 110, self.H - 50)
            if self.ruleset_pick:
                self._button(d, "Select", self.W - 110, self.H - 50)
            else:  # greyed out until a card is chosen
                tw = d.textlength("Select", font=self.fb)
                d.rectangle((self.W - 110 - tw / 2 - 18, self.H - 66, self.W - 110 + tw / 2 + 18, self.H - 32), fill=(50, 50, 55), outline=(90, 90, 95), width=2)
                d.text((self.W - 110 - tw / 2, self.H - 62), "Select", font=self.fb, fill=(150, 150, 155))
        elif self.screen == "charselect":
            d.text((990, 60), "Grommash", font=self.fb, fill=(255, 210, 0))
            d.text((990, 95), "Level 1 Orc Warrior", font=self.f, fill=(220, 220, 220))
            self._button(d, "Enter World", self.W / 2, self.H - 70)
            self._button(d, "Create New Character", 1090, self.H - 130)
            self._button(d, "Delete Character", 1090, self.H - 70)
        return img
