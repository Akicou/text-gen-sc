# 🔋 ASUS ROG Strix — Battery Charge Limiter

A Python background script that manages your laptop's battery charging
using **hysteresis logic** to extend battery lifespan.

## How It Works

| Battery Level | Action |
|--------------|--------|
| Above 95%    | 🚫 Charging **disabled** (stops at 95%) |
| 61–95%       | ⏸️ No change (hysteresis band) |
| ≤ 60%        | ⚡ Charging **enabled** (resumes) |

This hysteresis band (60–95%) prevents rapid on/off cycling of the charger.

## Quick Start

### 1. Install Dependencies
```bash
pip install psutil pystray Pillow pywin32
```

### 2. Run as Administrator
```bash
python battery_charge_limiter.py
```

### 3. System Tray
- A **battery icon** appears in your system tray
- Green fill = charging enabled, Red fill = charging paused
- Right-click for options:
  - Force Charge ON/OFF
  - View battery status
  - Open log file
  - Quit (re-enables charging)

## Auto-Start on Boot

### Option A: Task Scheduler (Recommended)
Run `install_startup.bat` as Administrator, or manually:

1. Open **Task Scheduler** (taskschd.msc)
2. Create Basic Task → Name: "BatteryChargeLimiter"
3. Trigger: "When I log on"
4. Action: "Start a program"
   - Program: `pythonw`
   - Arguments: `C:\path\to\battery_charge_limiter.py`
5. Check "Run with highest privileges"

### Option B: Startup Folder
1. Create a shortcut to `battery_charge_limiter.py`
2. Move it to:
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`

## Configuration

Edit the top of `battery_charge_limiter.py`:

```python
CHARGE_HIGH_THRESHOLD = 95    # Stop charging above this %
CHARGE_LOW_THRESHOLD  = 60    # Resume charging at or below this %
POLL_INTERVAL         = 30    # Seconds between checks
```

## How It Works (Technical)

The script controls charging by **disabling/enabling the Windows ACPI
battery PnP device** — the same mechanism that Windows uses when you
unplug a battery. This is safe and reversible.

When the script exits, it **always re-enables charging** so your
laptop isn't stuck in a non-charging state.

## Logs

All activity is logged to: `~/battery_limiter.log`

## Important Notes

- **Run as Administrator** — Required to control PnP devices
- **ASUS Armoury Crate** already has "Battery Health Charging" with
  similar presets (60%/80%/100%). Consider using that first!
- This script works on **any Windows laptop**, not just ASUS
- The script re-enables charging automatically when you quit

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Not running as Admin" | Right-click → Run as administrator |
| Battery device not found | Try updating ASUS ATK drivers |
| Icon not visible | Check the hidden tray (up arrow) |
| Charging not stopping | Some models need BIOS battery threshold set to 100% |
