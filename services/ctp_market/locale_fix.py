"""Force a libc locale that exists on minimal cloud images.

CTP MdApi calls std::locale("") and abort()s the whole process when LANG/LC_ALL
names a locale that was never generated (en_US.UTF-8, zh_CN.UTF-8, C.UTF-8).
POSIX "C" is always present. Call apply() before importing openctp_*.
"""

from __future__ import annotations

import ctypes
import locale as py_locale
import os

_LC_KEYS = (
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "LC_NUMERIC",
    "LC_TIME",
    "LC_COLLATE",
    "LC_MONETARY",
    "LC_MESSAGES",
    "LC_PAPER",
    "LC_NAME",
    "LC_ADDRESS",
    "LC_TELEPHONE",
    "LC_MEASUREMENT",
    "LC_IDENTIFICATION",
)


def apply(name: str = "C") -> str:
    for key in _LC_KEYS:
        os.environ.pop(key, None)
    os.environ["LANG"] = name
    os.environ["LC_ALL"] = name
    os.environ["LC_CTYPE"] = name
    try:
        py_locale.setlocale(py_locale.LC_ALL, name)
    except py_locale.Error:
        pass
    try:
        libc = ctypes.CDLL("libc.so.6")
        libc.setlocale.argtypes = [ctypes.c_int, ctypes.c_char_p]
        libc.setlocale.restype = ctypes.c_char_p
        libc.setlocale(int(py_locale.LC_ALL), name.encode())
        libc.setenv.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
        libc.setenv.restype = ctypes.c_int
        for key in ("LANG", "LC_ALL", "LC_CTYPE"):
            libc.setenv(key.encode(), name.encode(), 1)
        libc.unsetenv.argtypes = [ctypes.c_char_p]
        for key in _LC_KEYS:
            if key in ("LANG", "LC_ALL", "LC_CTYPE"):
                continue
            libc.unsetenv(key.encode())
    except Exception:
        pass
    return name
