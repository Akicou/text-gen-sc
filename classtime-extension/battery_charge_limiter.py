#!/usr/bin/env python3
"""
ASUS ROG Strix Battery Charge Limiter
======================================
Runs in the background, managing charging:
  - Stops charging when battery > 95%
  - Resumes charging when battery <= 60%

Requires: pip install psutil pystray Pillow pywin32
Run as Administrator (required for device management).

Author: Generated for ROG Strix battery management
"""

import time
import subprocess
import sys
import os
import threading
import logging
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
REQUIRED = ["psutil", "pystray", "PIL", "win32api", "win32gui"]
missing = []
for mod in REQUIRED:
    try:
        __import__(mod)
    except ImportError:
        missing.append(mod)
if missing:
    print(f"Missing packages. Install with:\n  pip install psutil pystray Pillow pywin32\n\nMissing: {missing}")
    sys.exit(1)

import psutil
import pystray
from PIL import Image, ImageDraw
import win32api
import win32gui

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHARGE_HIGH_THRESHOLD = 95    # Stop charging above this
CHARGE_LOW_THRESHOLD  = 60    # Resume charging at or below this
POLL_INTERVAL         = 30    # Seconds between battery checks
LOG_FILE              = Path.home() / "battery_limiter.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("BatteryLimiter")

# ---------------------------------------------------------------------------
# Battery Charging Control via Windows PnP Device
# ---------------------------------------------------------------------------
def _run_powershell(command: str) -> tuple:
    """Run a PowerShell command and return (stdout, stderr, returncode)."""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True, text=True, timeout=30,
    )
    return result.stdout.strip(), result.stderr.strip(), result.returncode


def get_battery_device_id() -> str | None:
    """Find the ACPI battery device instance ID."""
    stdout, _, rc = _run_powershell(
        'Get-PnpDevice -Class Battery -Status OK | '
        'Where-Object { $_.InstanceId -like "*ACPI*" } | '
        'Select-Object -First 1 -ExpandProperty InstanceId'
    )
    if rc == 0 and stdout:
        return stdout
    # Fallback: try WMI
    stdout, _, rc = _run_powershell(
        "(Get-CimInstance Win32_Battery).__RelPath"
    )
    return None


# Cache the device ID so we only look it up once
_battery_device_id: str | None = None
_device_id_checked = False

def get_cached_device_id() -> str | None:
    global _battery_device_id, _device_id_checked
    if not _device_id_checked:
        _battery_device_id = get_battery_device_id()
        _device_id_checked = True
        if _battery_device_id:
            log.info(f"Battery device found: {_battery_device_id}")
        else:
            log.warning("Could not auto-detect battery device. Using fallback method.")
    return _battery_device_id


def disable_charging() -> bool:
    """Disable the battery device to stop charging."""
    dev_id = get_cached_device_id()
    if dev_id:
        stdout, stderr, rc = _run_powershell(
            f'Disable-PnpDevice -InstanceId "{dev_id}" -Confirm:$false'
        )
        if rc == 0:
            log.info("✓ Charging DISABLED (battery device paused)")
            return True
        log.warning(f"Disable failed: {stderr}")
    return False


def enable_charging() -> bool:
    """Re-enable the battery device to allow charging."""
    dev_id = get_cached_device_id()
    if dev_id:
        stdout, stderr, rc = _run_powershell(
            f'Enable-PnpDevice -InstanceId "{dev_id}" -Confirm:$false'
        )
        if rc == 0:
            log.info("✓ Charging ENABLED (battery device restored)")
            return True
        log.warning(f"Enable failed: {stderr}")
    return False


# ---------------------------------------------------------------------------
# Battery Reading
# ---------------------------------------------------------------------------
def get_battery_info() -> dict:
    """Return battery percentage, charging status, and whether on AC."""
    bat = psutil.sensors_battery()
    if bat is None:
        return {"percent": 0, "charging": False, "plugged": False, "time_left": None}

    return {
        "percent": bat.percent,
        "charging": bat.power_plugged and bat.percent < 100,
        "plugged": bat.power_plugged,
        "time_left": bat.secsleft if bat.secsleft != psutil.POWER_TIME_UNLIMITED else None,
    }


# ---------------------------------------------------------------------------
# Core Control Logic  (hysteresis)
# ---------------------------------------------------------------------------
class BatteryManager:
    def __init__(self):
        self.charging_disabled = False
        self.last_state = None
        self.stats = {
            "cycles": 0,
            "disable_count": 0,
            "enable_count": 0,
            "start_time": datetime.now(),
        }

    def update(self) -> dict:
        """
        Core hysteresis loop:
          - Battery > 95%  →  disable charging
          - Battery <= 60%  →  enable charging
          - Between 60-95%  →  maintain current state (hysteresis band)
        """
        info = get_battery_info()
        pct = info["percent"]
        plugged = info["plugged"]

        old_state = self.charging_disabled
        action = "no change"

        if not plugged:
            # Not plugged in — nothing to control
            if self.charging_disabled:
                # Re-enable in case it was disabled and user unplugged/replugged
                enable_charging()
                self.charging_disabled = False
            action = "on battery"
        else:
            if pct > CHARGE_HIGH_THRESHOLD and not self.charging_disabled:
                disable_charging()
                self.charging_disabled = True
                self.stats["disable_count"] += 1
                self.stats["cycles"] += 1
                action = f"DISABLED charging ({pct}%)"

            elif pct <= CHARGE_LOW_THRESHOLD and self.charging_disabled:
                enable_charging()
                self.charging_disabled = False
                self.stats["enable_count"] += 1
                self.stats["cycles"] += 1
                action = f"ENABLED charging ({pct}%)"

            else:
                action = f"hold ({pct}%)"

        if old_state != self.charging_disabled:
            self.last_state = self.charging_disabled

        return {
            "percent": pct,
            "plugged": plugged,
            "charging_disabled": self.charging_disabled,
            "action": action,
            "time_left": info["time_left"],
        }


# ---------------------------------------------------------------------------
# System Tray Icon
# ---------------------------------------------------------------------------
def create_icon_image(percent: int, charging_disabled: bool) -> Image.Image:
    """Draw a simple battery icon with the current percentage."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Battery body
    bx, by, bw, bh = 8, 14, 42, 36
    draw.rectangle([bx, by, bx + bw, by + bh], outline="white", width=2)
    # Battery terminal
    draw.rectangle([bx + bw, by + 10, bx + bw + 6, by + bh - 10], fill="white")

    # Fill l
... (truncated, 5016 more chars)