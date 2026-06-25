# Mario vs. Donkey Kong: Tipping Stars — Web (Chromium) Port

A browser port of the Wii U game **Mario vs. Donkey Kong: Tipping Stars**. It
runs the original game's code in a modern browser by shimming the Wii U
Nintendo Web Framework (NWF) APIs, converting the Wii U texture/audio formats
to web-friendly ones, and lazily/asynchronously loading assets so it starts
quickly even on slow connections.

> **This repository contains no Nintendo game files.** It only contains the
> port's own code (the browser shims and build tools) and **patches** that
> describe the changes made to the original game's scripts. To get a playable
> build you must supply your **own** copy of the original game's files. Nothing
> here will run on its own.

---

## What's in this repo

| Path | What it is |
|------|------------|
| `overlay/` | Port-only files that are **added** on top of the game. Most importantly `scripts/chromium/*` — the NWF shims, the GTX texture runtime, the multi‑channel audio engine, the asset preloader, save handling, etc. Also `tools/` (the offline GTX→PNG converter). |
| `patches/` | Unified diffs (one per file) describing every change the port makes to the **original** game scripts (50 files). These are applied on top of your game files at build time. `patches/_index.txt` lists what each patch targets. |
| `build.py` | The build script. Combines your game files + `overlay/` + `patches/` into a runnable port. |

---

## Requirements
* **Your own dump of Mario vs. Donkey Kong Tipping Stars** — the game must be in decrypted/loadiine format, build accepts either the **dump root** (the folder that contains `content/app/...`), or the **app folder** itself (the one that directly contains `scripts/` and `audio/`).
* **Python 3.7+** — runs the build, applies the patches, and converts the
  textures (no third‑party Python packages required).
* **ffmpeg** *(optional but recommended)* — extracts the per‑world
  level‑selection music tracks from the game's multi‑channel audio. If ffmpeg
  is missing the build still succeeds; only the world‑specific level‑select
  tracks are skipped.

---

## Build it

From this folder:

```bash
python build.py --src "/path/to/your/game/files" --out build/chromium-port
```

Examples:

```bash
# Pointing at a dump root (the folder containing content/app)
python build.py --src "D:/dumps/MvDK Tipping Stars"

# Pointing straight at the app folder
python build.py --src "D:/dumps/MvDK Tipping Stars/content/app"
```

`--out` is optional and defaults to `build/chromium-port`.

The build will:

1. copy your game files into the output folder,
2. overlay the port-only files (`scripts/chromium`, `tools`),
3. apply the 50 patches to the modified game scripts,
4. convert the Wii U **GTX** textures to **PNG** (pure Python — ~338 texture
   bundles, so this step takes a few minutes),
5. extract the per‑world level‑select music with ffmpeg (if available).

---

## Run it

The port must be served over **HTTP** — opening `index.html` via `file://`
will not work (it loads scripts, textures and data with relative `fetch`/XHR
requests). Any static web server works; the simplest is Python's:

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory build/chromium-port
```

Then open <http://127.0.0.1:8765/>.

### Controls

* **Mouse / touch / stylus** — emulates the Wii U GamePad touch input.
* **Arrow keys / WASD** — move the camera in bigger levels.
* **Esc** — open the pause menu.
* **Ctrl + Z** — undo on the level editor.

---

## Updating the port

If you change a **port-only** file, edit it under `overlay/` and rebuild.

If you change one of the **original** game scripts, regenerate its patch from
your built tree against the pristine original, e.g.:

```bash
git -c core.autocrlf=false diff --no-index \
    "ORIGINAL/scripts/foo/Bar.js" "build/chromium-port/scripts/foo/Bar.js" \
    > patches/scripts__foo__Bar.js.patch
```

(make sure the `--- a/…` / `+++ b/…` header lines use the file's path relative
to the app root, matching the other patches).

---

## Notes & limitations

* Only tested with the EU version of the game, not sure how it will work with other regions.
* Online features (Miiverse, the community level sharing, etc.) are stubbed or
  disabled — this port targets **offline** play (story/solo, bonus, the level
  editor, local save).
* The default view is **GamePad** mode; TV-screen assets are not loaded unless
  needed, to keep startup light.
* Save data is stored locally in the browser.
* This is a fan project for preservation/educational purposes and is **not**
  affiliated with or endorsed by Nintendo. You must own the game and provide
  your own copy of its files.
