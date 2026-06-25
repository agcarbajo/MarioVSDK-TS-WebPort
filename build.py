#!/usr/bin/env python3
"""
Build the Mario vs. Donkey Kong: Tipping Stars browser port.

This repository contains ONLY the port's own code (browser shims, build
tools) and patches against the original game's files. It does NOT contain
any Nintendo assets or code. To produce a runnable port you must supply
your own copy of the original Wii U game files.

The build:
  1. copies the original game's app files into the output folder,
  2. overlays the port-only files (scripts/chromium, tools),
  3. applies the patches to the modified original files,
  4. converts the GTX textures to PNG (pure Python, no extra deps),
  5. extracts the per-world level-select music tracks (needs ffmpeg).

Usage:
    python build.py --src "<path to game files>" [--out build/chromium-port]

--src may point at:
  * a raw Wii U dump root (the folder containing content/app/...), or
  * the app folder itself (the one containing scripts/ and audio/).
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
OVERLAY = REPO / "overlay"
PATCHES = REPO / "patches"

# world N (1..7) -> stereo channel pair extracted from the 14-channel
# level_select_full.ogg. Confirmed against the game's channel flags.
LEVEL_SELECT_FULL = "audio/sounds/level_select_full.ogg"
WORLD_TRACK_COUNT = 7


def info(msg):  print("[build] " + msg)
def warn(msg):  print("[build] WARNING: " + msg)
def fail(msg):
    print("[build] ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def find_app_root(src: Path) -> Path:
    """Locate the game's app folder (the one holding scripts/ and audio/)."""
    candidates = [
        src,
        src / "content" / "app",
        src / "app",
    ]
    for c in candidates:
        if (c / "scripts").is_dir() and (c / "audio").is_dir():
            return c
    # last resort: search a couple of levels down
    for c in src.rglob("scripts"):
        app = c.parent
        if (app / "audio").is_dir():
            return app
    fail("Could not find the game app folder (expected a directory that "
         "contains both 'scripts/' and 'audio/') under: %s" % src)


def copy_original(app_root: Path, out: Path):
    if out.exists():
        info("Cleaning existing output folder: %s" % out)
        shutil.rmtree(out)
    info("Copying original game files -> %s" % out)
    shutil.copytree(app_root, out)


def apply_overlay(out: Path):
    n = 0
    for path in OVERLAY.rglob("*"):
        if path.is_file():
            rel = path.relative_to(OVERLAY)
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dst)
            n += 1
    info("Overlaid %d port-only file(s)." % n)


def _apply_unified_diff(target_bytes: bytes, patch_bytes: bytes) -> bytes:
    """Apply a single-file unified diff (as produced by `git diff`) to bytes.

    Pure Python so the build needs no external `patch`/`git`. Lines are split on
    "\\n" only and any "\\r" rides along as content, so CRLF and LF files are both
    handled losslessly. Raises AssertionError if the context does not match
    (i.e. the supplied original file is not the expected version)."""
    text = target_bytes.decode("latin-1")
    orig_ends_nl = text.endswith("\n")
    orig = text.split("\n")
    if orig_ends_nl:
        orig = orig[:-1]                       # drop trailing-newline artifact

    plines = patch_bytes.decode("latin-1").split("\n")
    i = 0
    hunks = []
    while i < len(plines):
        if plines[i].startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", plines[i])
            ostart = int(m.group(1)); body = []; i += 1
            while i < len(plines) and not plines[i].startswith("@@") \
                    and not plines[i].startswith("diff --git"):
                body.append(plines[i]); i += 1
            hunks.append((ostart, body))
        else:
            i += 1

    out = []; cursor = 0
    for ostart, body in hunks:
        start_idx = ostart - 1
        out.extend(orig[cursor:start_idx]); cursor = start_idx
        for line in body:
            if line.startswith("\\") or line == "":   # eof marker / artifact
                continue
            tag, content = line[:1], line[1:]
            if tag == " ":
                assert orig[cursor] == content, "context mismatch at line %d" % (cursor + 1)
                out.append(content); cursor += 1
            elif tag == "-":
                assert orig[cursor] == content, "delete mismatch at line %d" % (cursor + 1)
                cursor += 1
            elif tag == "+":
                out.append(content)

    if cursor >= len(orig):                    # last hunk reached EOF -> patch decides newline
        last_body = hunks[-1][1] if hunks else []
        new_no_nl_eof = False; prev_tag = None
        for line in last_body:
            if line.startswith("\\"):
                if prev_tag in (" ", "+"):
                    new_no_nl_eof = True
            elif line != "":
                prev_tag = line[:1]; new_no_nl_eof = False
        new_ends_nl = not new_no_nl_eof
    else:
        out.extend(orig[cursor:])
        new_ends_nl = orig_ends_nl

    body_text = "\n".join(out)
    if new_ends_nl:
        body_text += "\n"
    return body_text.encode("latin-1")


def apply_patches(out: Path):
    patch_files = sorted(p for p in PATCHES.glob("*.patch"))
    if not patch_files:
        warn("No patch files found in %s" % PATCHES)
        return
    failed = []
    for patch in patch_files:
        pb = patch.read_bytes()
        m = re.search(rb"^\+\+\+ b/(.+)$", pb, re.M)
        if not m:
            failed.append((patch.name, "could not read target path from patch"))
            continue
        rel = m.group(1).decode("latin-1").strip()
        target = out / rel
        if not target.exists():
            failed.append((patch.name, "target file missing: %s" % rel))
            continue
        try:
            target.write_bytes(_apply_unified_diff(target.read_bytes(), pb))
        except Exception as ex:  # noqa: BLE001
            failed.append((patch.name, str(ex)))
    if failed:
        for name, err in failed:
            warn("patch failed: %s -> %s" % (name, err))
        fail("%d patch(es) did not apply. Your game files are probably a "
             "different version than this port targets (EU)." % len(failed))
    info("Applied %d patch(es)." % len(patch_files))


def convert_textures(out: Path, python: str):
    script = out / "tools" / "convert_gtx.py"
    if not script.exists():
        fail("convert_gtx.py missing from overlay/tools.")
    info("Converting GTX textures to PNG (~338 bundles; this can take "
         "several minutes)...")
    res = subprocess.run([python, str(script)], cwd=str(out))
    # convert_gtx returns non-zero only if some surfaces are unsupported;
    # the supported ones are still written. Surface a warning, don't abort.
    if res.returncode != 0:
        warn("convert_gtx.py reported unsupported GTX surfaces (see above). "
             "Converted assets that are supported were still written.")
    info("Texture conversion done -> %s" % (out / "converted"))


def extract_world_music(out: Path, ffmpeg: str):
    full = out / LEVEL_SELECT_FULL
    if not full.exists():
        warn("%s not found; skipping per-world level-select music. The world "
             "selection screen will still work but world-specific tracks may "
             "fall back." % LEVEL_SELECT_FULL)
        return
    if not ffmpeg:
        warn("ffmpeg not found on PATH; skipping per-world level-select music "
             "extraction. Install ffmpeg and re-run to enable it.")
        return
    info("Extracting %d per-world level-select tracks with ffmpeg..." % WORLD_TRACK_COUNT)
    for world in range(1, WORLD_TRACK_COUNT + 1):
        left = 2 * (world - 1)
        right = left + 1
        dst = out / "audio" / "sounds" / ("level_select_world_%d.ogg" % world)
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", str(full),
               "-af", "pan=stereo|c0=c%d|c1=c%d" % (left, right),
               "-c:a", "libvorbis", "-q:a", "6", str(dst)]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            warn("ffmpeg failed for world %d:\n        %s"
                 % (world, res.stderr.decode("utf-8", "replace").strip()))
            return
    info("Per-world level-select music extracted.")


def main():
    ap = argparse.ArgumentParser(description="Build the MvDK: Tipping Stars browser port.")
    ap.add_argument("--src", required=True,
                    help="Path to your original game files (dump root or app folder).")
    ap.add_argument("--out", default=str(REPO / "build" / "chromium-port"),
                    help="Output folder for the built port (default: build/chromium-port).")
    args = ap.parse_args()

    src = Path(os.path.abspath(os.path.expanduser(args.src)))
    out = Path(os.path.abspath(os.path.expanduser(args.out)))
    if not src.exists():
        fail("--src path does not exist: %s" % src)

    ffmpeg = shutil.which("ffmpeg")
    python = sys.executable or "python"

    app_root = find_app_root(src)
    info("Using game files from: %s" % app_root)

    copy_original(app_root, out)
    apply_overlay(out)
    apply_patches(out)
    convert_textures(out, python)
    extract_world_music(out, ffmpeg)

    info("")
    info("Build complete: %s" % out)
    info("Serve it over HTTP (NOT file://), for example:")
    info('    python -m http.server 8765 --bind 127.0.0.1 --directory "%s"' % out)
    info("Then open http://127.0.0.1:8765/")


if __name__ == "__main__":
    main()
