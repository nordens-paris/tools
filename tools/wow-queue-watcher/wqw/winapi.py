"""Win32 helpers (ctypes only): find the WoW process and window, capture it,
send clicks and keys, and keep the PC awake."""
import ctypes
import ctypes.wintypes as wt
import fnmatch
import os
import subprocess
import time

from PIL import Image, ImageGrab

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

ULONG_PTR = ctypes.c_size_t
INVALID_HANDLE = ctypes.c_void_p(-1).value


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
                ("th32DefaultHeapID", ULONG_PTR), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long),
                ("dwFlags", wt.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _INPUTUNION)]


WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

# Handles are pointer-sized; without explicit signatures ctypes truncates them on 64-bit.
user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.IsWindow.argtypes = [wt.HWND]
user32.IsIconic.argtypes = [wt.HWND]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
user32.GetDC.argtypes = [wt.HWND]
user32.GetDC.restype = wt.HDC
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
user32.PrintWindow.argtypes = [wt.HWND, wt.HDC, wt.UINT]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.BringWindowToTop.argtypes = [wt.HWND]
user32.GetForegroundWindow.restype = wt.HWND
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.SendInput.argtypes = [wt.UINT, ctypes.c_void_p, ctypes.c_int]
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
gdi32.CreateCompatibleBitmap.restype = wt.HBITMAP
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
kernel32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
kernel32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)]
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.SetThreadExecutionState.argtypes = [wt.DWORD]
kernel32.SetThreadExecutionState.restype = wt.DWORD

SCANCODES = {"enter": 0x1C, "escape": 0x01, "space": 0x39, "alt": 0x38}


def make_dpi_aware():
    """Use physical pixels so window coordinates, captures and clicks all line up."""
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass


def keep_awake(on=True):
    ES_CONTINUOUS, ES_SYSTEM_REQUIRED, ES_DISPLAY_REQUIRED = 0x80000000, 0x1, 0x2
    flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED if on else 0)
    kernel32.SetThreadExecutionState(flags)


# --- processes -------------------------------------------------------------

def process_path(pid):
    h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return None
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wt.DWORD(len(buf))
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return buf.value
        return None
    finally:
        kernel32.CloseHandle(h)


def find_pids(exe_name, game_dir=""):
    """PIDs of processes named exe_name (wildcards allowed), optionally only those started from game_dir
    (several WoW flavours all ship a Wow.exe)."""
    snap = kernel32.CreateToolhelp32Snapshot(0x2, 0)
    if snap in (None, INVALID_HANDLE):
        return []
    pids = []
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if fnmatch.fnmatch(entry.szExeFile.lower(), exe_name.lower()):
                pids.append(entry.th32ProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)
    if game_dir:
        want = os.path.normcase(os.path.normpath(game_dir))
        pids = [p for p in pids
                if (path := process_path(p)) and os.path.normcase(os.path.dirname(path)) == want]
    return pids


def kill_pid(pid):
    subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)


# --- windows -----------------------------------------------------------------

def client_size(hwnd):
    r = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    return r.right - r.left, r.bottom - r.top


def find_main_window(pids):
    """Largest visible top-level window owned by one of pids."""
    pids = set(pids)
    found = []

    @WNDENUMPROC
    def cb(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            w, h = client_size(hwnd)
            found.append((w * h, hwnd))
        return True

    user32.EnumWindows(cb, 0)
    if not found:
        return None
    return max(found, key=lambda f: f[0])[1]


def is_minimized(hwnd):
    return bool(user32.IsIconic(hwnd))


def _printwindow(hwnd, w, h):
    hdc_win = user32.GetDC(hwnd)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_win)
    bmp = gdi32.CreateCompatibleBitmap(hdc_win, w, h)
    old = gdi32.SelectObject(hdc_mem, bmp)
    try:
        # PW_CLIENTONLY | PW_RENDERFULLCONTENT: the latter is what makes DirectX windows work
        user32.PrintWindow(hwnd, hdc_mem, 3)
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = w
        bmi.bmiHeader.biHeight = -h  # top-down rows
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        buf = ctypes.create_string_buffer(w * h * 4)
        gdi32.GetDIBits(hdc_mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
        return Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1)
    finally:
        gdi32.SelectObject(hdc_mem, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(hwnd, hdc_win)


def _is_blank(img):
    return all(hi < 8 for _, hi in img.getextrema())


def capture(hwnd):
    """Screenshot of the window's client area. Tries PrintWindow first (works even
    when covered), then falls back to grabbing that part of the screen."""
    w, h = client_size(hwnd)
    if w <= 0 or h <= 0:
        return None
    img = None
    try:
        img = _printwindow(hwnd, w, h)
    except Exception:
        img = None
    if img is None or _is_blank(img):
        pt = wt.POINT(0, 0)
        user32.ClientToScreen(hwnd, ctypes.byref(pt))
        img = ImageGrab.grab(bbox=(pt.x, pt.y, pt.x + w, pt.y + h), all_screens=True)
    return img


# --- input -------------------------------------------------------------------

def _send(*inputs):
    arr = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _key_input(scan, up=False):
    flags = 0x0008 | (0x0002 if up else 0)  # KEYEVENTF_SCANCODE (| KEYEVENTF_KEYUP)
    return INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(0, scan, flags, 0, 0)))


def _mouse_input(flags):
    return INPUT(type=0, u=_INPUTUNION(mi=MOUSEINPUT(0, 0, 0, flags, 0, 0)))


def focus(hwnd):
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    if user32.GetForegroundWindow() != hwnd:
        # Windows only lets a background process take focus right after keyboard input;
        # a lone Alt tap satisfies that without doing anything in the game.
        _send(_key_input(SCANCODES["alt"]), _key_input(SCANCODES["alt"], up=True))
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.4)


def click(hwnd, x, y, double=False):
    """Left-click at client coordinates (x, y)."""
    pt = wt.POINT(int(x), int(y))
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    user32.SetCursorPos(pt.x, pt.y)
    time.sleep(0.15)
    for _ in range(2 if double else 1):
        _send(_mouse_input(0x0002))  # LEFTDOWN
        time.sleep(0.05)
        _send(_mouse_input(0x0004))  # LEFTUP
        time.sleep(0.08)


def press(key):
    scan = SCANCODES[key]
    _send(_key_input(scan))
    time.sleep(0.06)
    _send(_key_input(scan, up=True))
