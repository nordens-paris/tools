"""Loads config.toml on top of the defaults below. Every key here can be
overridden in config.toml; anything left out keeps its default."""
import copy
import re
import secrets
import tomllib
from types import SimpleNamespace

DEFAULTS = {
    "game": {
        "battlenet_exe": r"C:\Program Files (x86)\Battle.net\Battle.net.exe",
        "game_dir": r"C:\Program Files (x86)\World of Warcraft\_forever_",
        "process_name": "Wow.exe",
        "launch_method": "battlenet",  # "battlenet", "battlenet-exec" or "direct"
        "launch_family": "WoWF",  # Battle.net game family (case-sensitive)
        "launch_code": "wowf",  # Battle.net game id, for the Play-button fallback
        "ocr_language": "en-US",
    },
    "schedule": {"start_at": "", "standby": False},
    "watch": {"interval_seconds": 20, "ocr_scale": 2.0, "save_screenshots": True},
    "alerts": {
        "eta_source": "earliest",
        "update_every_minutes": 30,
        "heads_up_minutes": 30,
        "alarm_minutes": 15,
        "alarm_on_queue_done": True,
        "alarm_repeat_seconds": 120,
        "alarm_max_repeats": 20,
        "local_sound": True,
        "alarm_sound": "",  # path to your own .wav; empty = built-in soft chime
        "give_up_minutes": 20,
    },
    "ntfy": {"server": "https://ntfy.sh", "topic": "", "token": ""},
    "reconnect": {
        "enabled": False,  # off by default: watch and alert only, never click in the game on its own
        "auto_launch": True,
        "action_cooldown_seconds": 30,
        "stuck_minutes": 8,
        "relaunch_wait_seconds": 90,
        "max_relaunches": 30,
        "click_buttons": ["Okay", "OK", "Reconnect", "Connect", "Retry"],
        "realm_name": "",
        "auto_enter_world": False,
        "auto_enter_world_after_minutes": 10,
    },
    "dashboard": {"enabled": True, "host": "127.0.0.1", "port": 8765},
    "health": {"ping_url": "", "ping_every_seconds": 60},
    "screens": {
        "disconnected": ["disconnected", "unable to connect", "lost connection", "connection timed out",
                         "failed to connect", "cannot connect", "could not connect", "server is down",
                         "servers are down", "unable to validate"],
        "queue": ["position in queue", "estimated time", "servers are full", "realm is full"],
        "char_select": ["enter world", "create character", "create new character", "delete character",
                        "toggle character list"],
        "realm_list": ["realm selection", "realm name", "population"],
        "connecting": ["connecting", "authenticating", "retrieving", "handshaking", "logging in",
                       "getting server information", "server information",
                       "success"],
        "password": ["email or phone", "password"],
        "login": ["reconnect", "log out", "manage account", "cinematics", "credits"],
    },
}


def _merge(base, override):
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def _ns(d):
    return SimpleNamespace(**{k: _ns(v) if isinstance(v, dict) else v for k, v in d.items()})


def load(path):
    data = copy.deepcopy(DEFAULTS)
    with open(path, "rb") as f:
        _merge(data, tomllib.load(f))
    cfg = _ns(data)
    cfg.raw = data
    return cfg


def ensure_topic(cfg, path):
    """Give the user a private random ntfy topic on first run and save it to the config.
    Anyone who knows the topic can read the alerts and send commands, so it must be unguessable."""
    if cfg.ntfy.topic:
        return False
    topic = "wqw-" + secrets.token_hex(8)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new, n = re.subn(r'(?m)^(topic\s*=\s*)""', rf'\g<1>"{topic}"', text, count=1)
    if n:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
    cfg.ntfy.topic = topic
    return True


# --- finding Battle.net and WoW on other people's PCs -------------------------

def _reg_values(paths, name):
    import winreg
    out = []
    for hive, key in paths:
        try:
            with winreg.OpenKey(hive, key) as k:
                out.append(winreg.QueryValueEx(k, name)[0])
        except OSError:
            pass
    return out


def _wow_roots():
    """Candidate "World of Warcraft" folders, most reliable first."""
    import os
    import winreg
    roots = []
    for p in _reg_values([(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft"),
                          (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Blizzard Entertainment\World of Warcraft")],
                         "InstallPath"):
        roots.append(os.path.dirname(os.path.normpath(p)))
    # Battle.net's own install database lists every game folder.
    try:
        with open(r"C:\ProgramData\Battle.net\Agent\product.db", "rb") as f:
            blob = f.read().decode("latin-1")
        for m in re.finditer(r"[A-Za-z]:[\\/][^\x00-\x1f\"*?<>|]*?World of Warcraft", blob):
            roots.append(os.path.normpath(m.group(0)))
    except OSError:
        pass
    for drive in "CDEFGH":
        for sub in (r"Program Files (x86)\World of Warcraft", r"Program Files\World of Warcraft",
                    r"World of Warcraft", r"Games\World of Warcraft", r"Blizzard\World of Warcraft"):
            roots.append(f"{drive}:\\{sub}")
    seen, unique = set(), []
    for r in roots:
        if r.lower() not in seen:
            seen.add(r.lower())
            unique.append(r)
    return unique


def _battlenet_candidates():
    import winreg
    cands = []
    for loc in _reg_values([(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Battle.net")],
                           "InstallLocation"):
        cands.append(loc.rstrip("\\/") + r"\Battle.net.exe")
    for drive in "CDEFGH":
        cands += [rf"{drive}:\Program Files (x86)\Battle.net\Battle.net.exe", rf"{drive}:\Program Files\Battle.net\Battle.net.exe",
                  rf"{drive}:\Battle.net\Battle.net.exe"]
    return cands


def autodetect(cfg):
    """Fill in battlenet_exe / game_dir when the configured ones don't exist on this PC.
    Returns a list of human-readable notes about what was found or is missing."""
    import os
    g, notes = cfg.game, []
    if not os.path.isfile(g.battlenet_exe):
        found = next((p for p in _battlenet_candidates() if os.path.isfile(p)), None)
        if found:
            g.battlenet_exe = found
            notes.append(f"Found Battle.net: {found}")
        else:
            notes.append("Battle.net.exe not found - set battlenet_exe in config.toml")
    if not os.path.isdir(g.game_dir):
        flavor = os.path.basename(os.path.normpath(g.game_dir))  # e.g. "_forever_"
        found = next((os.path.join(r, flavor) for r in _wow_roots() if os.path.isdir(os.path.join(r, flavor))), None)
        if found:
            g.game_dir = found
            notes.append(f"Found WoW Forever: {found}")
        else:
            notes.append(f"WoW Forever folder ({flavor}) not found yet - install the game, "
                         f"or set game_dir in config.toml")
    return notes
