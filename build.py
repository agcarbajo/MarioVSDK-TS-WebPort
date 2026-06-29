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
import concurrent.futures
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
OVERLAY = REPO / "overlay"
PATCHES = REPO / "patches"
HOST_DIR = REPO / "host"
DIST_DIR = REPO / "dist"
ICON_ICO = REPO / "electron" / "game-icon.ico"     # Windows / generic
ICON_ICNS = REPO / "electron" / "game-icon.icns"   # macOS (optional)

# world N (1..7) -> stereo channel pair extracted from the 14-channel
# level_select_full.ogg. Confirmed against the game's channel flags.
LEVEL_SELECT_FULL = "audio/sounds/level_select_full.ogg"
WORLD_TRACK_COUNT = 7

# The real Wii U game icon (used for the web favicon and the desktop app icon).
GAME_ICON_SRC = "meta/iconTex.tga"
WEB_ICON_NAME = "game-icon.png"


def info(msg):  print("[build] " + msg)
def warn(msg):  print("[build] WARNING: " + msg)
def fail(msg):
    print("[build] ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def _fmt_eta(seconds):
    if seconds is None or seconds < 0:
        return "--:--"
    seconds = int(seconds)
    if seconds >= 3600:
        return "%d:%02d:%02d" % (seconds // 3600, (seconds % 3600) // 60, seconds % 60)
    return "%d:%02d" % (seconds // 60, seconds % 60)


class Progress:
    """Single-line, live build progress: overall %, current task %, and ETA.

    Each stage is given a rough weight (its expected share of total build time)
    so the overall percentage advances smoothly across stages, and the ETA is
    derived from elapsed time versus overall fraction done."""

    STAGES = [
        ("Copying game files",   30),
        ("Overlaying port files", 2),
        ("Applying patches",      3),
        ("Converting textures",  50),
        ("Extracting music",     15),
    ]

    def __init__(self):
        self.total_w = sum(w for _, w in self.STAGES)
        self.start = time.time()
        self.name = ""
        self.weight = 0
        self.before = 0

    def stage(self, index):
        self.name, self.weight = self.STAGES[index]
        self.before = sum(w for _, w in self.STAGES[:index])
        self.update(0.0)

    def update(self, frac):
        frac = 0.0 if frac < 0 else (1.0 if frac > 1 else frac)
        overall = (self.before + self.weight * frac) / self.total_w
        elapsed = time.time() - self.start
        eta = (elapsed * (1 - overall) / overall) if overall > 0.02 else None
        line = "[build] total %3d%%  |  %-21s %3d%%  |  ETA %s" % (
            round(overall * 100), self.name, round(frac * 100), _fmt_eta(eta))
        sys.stdout.write("\r" + line + "    ")
        sys.stdout.flush()

    def done_stage(self):
        self.update(1.0)
        sys.stdout.write("\n")
        sys.stdout.flush()


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


def _patched_targets() -> set:
    """Relative paths (posix) of the game files the patches modify."""
    targets = set()
    for patch in PATCHES.glob("*.patch"):
        m = re.search(rb"^\+\+\+ b/(.+)$", patch.read_bytes(), re.M)
        if m:
            targets.add(m.group(1).decode("latin-1").strip())
    return targets


def _copy_workers() -> int:
    # Copying game files is I/O-bound, so oversubscribe cores a little.
    return min(16, (os.cpu_count() or 4) * 4)


def copy_original(app_root: Path, out: Path, prog: Progress, incremental: bool = False):
    """Copy the game's app files into the output folder, in parallel.

    With ``incremental`` and an existing output, only new/changed files are
    copied: a file is recopied if it's missing, if its size/mtime differs, or if
    it is a patch target (so patches always re-apply to a pristine copy). This
    makes repeated rebuilds with the same game files much faster."""
    patched = _patched_targets() if incremental else set()
    if not incremental and out.exists():
        shutil.rmtree(out)
    files = [p for p in app_root.rglob("*") if p.is_file()]
    total = len(files) or 1

    def do_copy(src):
        rel = src.relative_to(app_root).as_posix()
        dst = out / rel
        if incremental and dst.exists() and rel not in patched:
            try:
                ss = src.stat(); ds = dst.stat()
                if ss.st_size == ds.st_size and ss.st_mtime <= ds.st_mtime + 1:
                    return  # unchanged -> skip
            except OSError:
                pass
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    with concurrent.futures.ThreadPoolExecutor(max_workers=_copy_workers()) as ex:
        futs = [ex.submit(do_copy, s) for s in files]
        for n, f in enumerate(concurrent.futures.as_completed(futs), 1):
            f.result()
            if n % 40 == 0 or n == total:
                prog.update(n / total)


def apply_overlay(out: Path, prog: Progress):
    files = [p for p in OVERLAY.rglob("*") if p.is_file()]
    total = len(files) or 1
    for n, path in enumerate(files, 1):
        dst = out / path.relative_to(OVERLAY)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dst)
        prog.update(n / total)


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


def apply_patches(out: Path, prog: Progress):
    patch_files = sorted(p for p in PATCHES.glob("*.patch"))
    if not patch_files:
        warn("No patch files found in %s" % PATCHES)
        return
    total = len(patch_files)
    failed = []
    for n, patch in enumerate(patch_files, 1):
        pb = patch.read_bytes()
        m = re.search(rb"^\+\+\+ b/(.+)$", pb, re.M)
        if not m:
            failed.append((patch.name, "could not read target path from patch"))
        else:
            rel = m.group(1).decode("latin-1").strip()
            target = out / rel
            if not target.exists():
                failed.append((patch.name, "target file missing: %s" % rel))
            else:
                try:
                    target.write_bytes(_apply_unified_diff(target.read_bytes(), pb))
                except Exception as ex:  # noqa: BLE001
                    failed.append((patch.name, str(ex)))
        prog.update(n / total)
    if failed:
        sys.stdout.write("\n")
        for name, err in failed:
            warn("patch failed: %s -> %s" % (name, err))
        fail("%d patch(es) did not apply. Your game files are probably a "
             "different version than this port targets (EU)." % len(failed))


def convert_textures(out: Path, python: str, prog: Progress, incremental: bool = False):
    """Run the parallel GTX->PNG converter, streaming its progress.

    Returns (warnings, returncode). The converter emits machine-readable
    'PROGRESS done total' lines (one per finished bundle) which drive the
    progress bar, plus 'WARN ...' lines for unsupported surfaces.

    With ``incremental`` the converter skips bundles already converted in a
    previous build (their PNGs never change), reconverting only the rest."""
    script = out / "tools" / "convert_gtx.py"
    if not script.exists():
        fail("convert_gtx.py missing from overlay/tools.")
    cmd = [python, "-u", str(script), "--porcelain"]
    if incremental:
        cmd.append("--incremental")
    proc = subprocess.Popen(
        cmd,
        cwd=str(out), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    warns = []
    other = []
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("PROGRESS"):
            parts = line.split()
            if len(parts) == 3:
                done, total = int(parts[1]), int(parts[2]) or 1
                prog.update(done / total)
        elif line.startswith("WARN "):
            warns.append(line[5:].strip())
        elif line.strip():
            other.append(line)
    proc.wait()
    if proc.returncode != 0 and not warns and other:
        warns.extend(other[-5:])
    return warns, proc.returncode


def extract_world_music(out: Path, ffmpeg: str, prog: Progress, incremental: bool = False):
    # Incremental: the per-world tracks are derived from the fixed source audio,
    # so if they all already exist there is nothing to redo.
    if incremental:
        outs = [out / "audio" / "sounds" / ("level_select_world_%d.ogg" % w)
                for w in range(1, WORLD_TRACK_COUNT + 1)]
        if all(o.exists() for o in outs):
            prog.update(1.0)
            return None
    full = out / LEVEL_SELECT_FULL
    if not full.exists() or not ffmpeg:
        prog.update(1.0)
        if not full.exists():
            return "%s not found; skipping per-world level-select music." % LEVEL_SELECT_FULL
        return ("ffmpeg not found on PATH; skipping per-world level-select music. "
                "Install ffmpeg and re-run to enable it.")
    for world in range(1, WORLD_TRACK_COUNT + 1):
        left = 2 * (world - 1)
        right = left + 1
        dst = out / "audio" / "sounds" / ("level_select_world_%d.ogg" % world)
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", str(full),
               "-af", "pan=stereo|c0=c%d|c1=c%d" % (left, right),
               "-c:a", "libvorbis", "-q:a", "6", str(dst)]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        prog.update(world / WORLD_TRACK_COUNT)
        if res.returncode != 0:
            return ("ffmpeg failed for world %d: %s"
                    % (world, res.stderr.decode("utf-8", "replace").strip()))
    return None


def _find_game_icon(src: Path):
    """Locate the Wii U game icon (meta/iconTex.tga) in the supplied dump."""
    for c in [src / GAME_ICON_SRC, src / "content" / ".." / GAME_ICON_SRC]:
        if c.exists():
            return c
    found = list(src.rglob("iconTex.tga"))
    return found[0] if found else None


def prepare_web_icon(src: Path, out: Path, ffmpeg: str):
    """Convert the game's icon to a PNG in the web root (used as the favicon and
    as the desktop app's window icon). Returns the PNG path or None."""
    icon = _find_game_icon(src)
    if not icon:
        warn("game icon (%s) not found in the supplied files; using default icon." % GAME_ICON_SRC)
        return None
    if not ffmpeg:
        warn("ffmpeg not found; skipping game icon (favicon/app icon).")
        return None
    dst = out / WEB_ICON_NAME
    res = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(icon), str(dst)],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0 or not dst.exists():
        warn("could not convert the game icon: %s" % res.stderr.decode("utf-8", "replace").strip())
        return None
    info("Game icon -> %s" % dst)
    return dst


def _png_to_ico(png_path: Path, ico_path: Path):
    """Wrap a PNG into a single-image .ico (PNG-compressed icon, Vista+)."""
    png = png_path.read_bytes()
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    bw = 0 if width >= 256 else width
    bh = 0 if height >= 256 else height
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", bw, bh, 0, 0, 1, 32, len(png), 22)
    ico_path.write_bytes(header + entry + png)


def _has_module(python: str, module: str) -> bool:
    return subprocess.run([python, "-c", "import %s" % module],
                          stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def _frozen_app_paths(app_name: str):
    """Return (report_dir, exe_path, web_dst) for the PyInstaller onedir output
    on the current OS. report_dir is the folder to hand to the user."""
    onedir = DIST_DIR / app_name
    if sys.platform.startswith("win"):
        exe = onedir / (app_name + ".exe")
        return onedir, exe, onedir / "web"
    if sys.platform == "darwin":
        appbundle = DIST_DIR / (app_name + ".app")
        if appbundle.is_dir():
            macos = appbundle / "Contents" / "MacOS"
            return appbundle, macos / app_name, appbundle / "Contents" / "Resources" / "web"
        return onedir, onedir / app_name, onedir / "web"
    return onedir, onedir / app_name, onedir / "web"  # linux


def package_app(out: Path, app_name: str, python: str):
    """Build a standalone desktop app (host + game) for the current OS."""
    host_py = HOST_DIR / "host.py"
    if not host_py.exists():
        fail("host/host.py is missing; cannot package the app.")
    if not _has_module(python, "PyInstaller"):
        fail("PyInstaller is required for --package. Install it with:\n"
             "        %s -m pip install pyinstaller" % python)

    have_webview = _has_module(python, "webview")
    mode = "native window (pywebview)" if have_webview else "default browser"
    info("Packaging desktop app '%s' for %s [%s] ..." % (app_name, sys.platform, mode))
    if not have_webview:
        info("  tip: `%s -m pip install pywebview` before packaging to get a "
             "native windowed app instead of opening the browser." % python)

    work = REPO / "build" / "_pyinstaller"
    cmd = [python, "-m", "PyInstaller", "--noconfirm", "--clean",
           "--name", app_name,
           "--distpath", str(DIST_DIR),
           "--workpath", str(work),
           "--specpath", str(work)]
    # Use the real game icon (same one as the favicon / Electron app).
    icon = ICON_ICNS if sys.platform == "darwin" else ICON_ICO
    if icon and icon.exists():
        cmd += ["--icon", str(icon)]
    if have_webview:
        # GUI app (no console) + make sure pywebview's backend files are bundled.
        cmd += ["--windowed", "--collect-all", "webview"]
    cmd.append(str(host_py))

    info("Running PyInstaller (this takes a moment) ...")
    if subprocess.run(cmd).returncode != 0:
        fail("PyInstaller failed to package the host.")

    report_dir, exe, web_dst = _frozen_app_paths(app_name)
    if not exe.exists():
        fail("Packaged executable not found where expected: %s" % exe)

    if web_dst.exists():
        shutil.rmtree(web_dst)
    web_dst.parent.mkdir(parents=True, exist_ok=True)
    info("Copying the built game into the app: %s" % web_dst)
    shutil.copytree(out, web_dst)

    info("")
    info("Desktop app ready:")
    info("  executable: %s" % exe)
    info("  folder:     %s" % report_dir)


def _run_node_tool(parts, cwd):
    """Run an npm/npx command. On Windows these are .cmd shims that need the
    shell, so build a properly quoted command line; elsewhere run the list."""
    if os.name == "nt":
        return subprocess.run(subprocess.list2cmdline(parts), cwd=str(cwd), shell=True)
    return subprocess.run(parts, cwd=str(cwd))


def package_electron(out: Path, app_name: str):
    """Build a fully self-contained Electron app (bundles its own Chromium)."""
    electron_dir = REPO / "electron"
    if not (electron_dir / "main.js").exists():
        fail("electron/main.js is missing; cannot build the Electron app.")
    if not (shutil.which("npm") or shutil.which("npm.cmd")):
        fail("Node.js + npm are required for the Electron app.\n"
             "        Install Node.js from https://nodejs.org/ and re-run.")

    out_root = DIST_DIR / "electron"
    info("Building self-contained Electron app '%s' for %s ..." % (app_name, sys.platform))

    info("Installing Electron build dependencies (first run downloads Electron; "
         "this can take a while) ...")
    if _run_node_tool(["npm", "install"], electron_dir).returncode != 0:
        fail("`npm install` failed in the electron/ folder.")

    info("Packaging with @electron/packager (this can take a few minutes) ...")
    pkg_cmd = ["npx", "@electron/packager", ".", app_name,
               "--out", str(out_root), "--overwrite", "--asar"]

    # Use the real game icon for the executable when we have it (Windows .ico).
    web_icon = out / WEB_ICON_NAME
    if web_icon.exists() and sys.platform.startswith("win"):
        ico = electron_dir / "game-icon.ico"
        try:
            _png_to_ico(web_icon, ico)
            pkg_cmd += ["--icon", str(ico)]
        except Exception as ex:  # noqa: BLE001
            warn("could not build .ico for the executable: %s" % ex)

    if _run_node_tool(pkg_cmd, electron_dir).returncode != 0:
        fail("@electron/packager failed.")

    matches = sorted(p for p in out_root.glob(app_name + "-*") if p.is_dir())
    if not matches:
        fail("Could not find the packaged Electron app under %s" % out_root)
    app_dir = matches[-1]

    # Work out where the app's resources live and where the launcher is.
    if sys.platform == "darwin":
        bundles = list(app_dir.glob("*.app"))
        base = bundles[0] if bundles else app_dir
        web_dst = base / "Contents" / "Resources" / "web"
        exe = (base / "Contents" / "MacOS" / app_name) if bundles else base / app_name
        report_dir = base
    else:
        web_dst = app_dir / "resources" / "web"
        exe = app_dir / (app_name + ".exe") if sys.platform.startswith("win") else app_dir / app_name
        report_dir = app_dir

    if web_dst.exists():
        shutil.rmtree(web_dst)
    web_dst.parent.mkdir(parents=True, exist_ok=True)
    # Move (not copy) the built port into the app, so the only copy that remains
    # is the one inside the Electron app — no separate build/chromium-port.
    info("Moving the built game into the app: %s" % web_dst)
    shutil.move(str(out), str(web_dst))

    info("")
    info("Self-contained desktop app ready:")
    info("  executable: %s" % exe)
    info("  folder:     %s" % report_dir)
    info("  (the standalone build/chromium-port was moved into the app)")


def main():
    ap = argparse.ArgumentParser(description="Build the MvDK: Tipping Stars browser port.")
    ap.add_argument("--src", required=True,
                    help="Path to your original game files (dump root or app folder).")
    ap.add_argument("--out", default=None,
                    help="Output folder for the built port (default: build/chromium-port). "
                         "When left at the default and a previous build is found there, "
                         "the build is incremental automatically (use --clean to force a "
                         "full rebuild).")
    ap.add_argument("--package", nargs="?", const="electron",
                    choices=["electron", "webview"], default=None,
                    help="After building, also package a standalone desktop app "
                         "(an executable + a folder of files) for the current OS. "
                         "'electron' (default) bundles its own Chromium for a fully "
                         "self-contained app; 'webview' makes a lighter app that uses "
                         "the OS webview / browser.")
    ap.add_argument("--app-name", default="MvDK-Tipping-Stars",
                    help="Name for the packaged app/executable (default: MvDK-Tipping-Stars).")
    ap.add_argument("--incremental", action="store_true",
                    help="Force an incremental rebuild: reuse the output folder, copy "
                         "only changed game files, re-apply all patches, and skip "
                         "textures/music already produced by a previous build. This is "
                         "already the default for the default output path; use this flag "
                         "to opt in for a custom --out too.")
    ap.add_argument("--clean", action="store_true",
                    help="Force a full clean rebuild (wipe the output folder first), "
                         "even when a previous build exists at the default path.")
    args = ap.parse_args()

    src = Path(os.path.abspath(os.path.expanduser(args.src)))
    out_is_default = args.out is None
    out = (REPO / "build" / "chromium-port") if out_is_default \
        else Path(os.path.abspath(os.path.expanduser(args.out)))
    if not src.exists():
        fail("--src path does not exist: %s" % src)

    ffmpeg = shutil.which("ffmpeg")
    python = sys.executable or "python"

    app_root = find_app_root(src)
    info("Using game files from: %s" % app_root)
    info("Building -> %s" % out)

    prog = Progress()

    # Incremental by default when the default output path already holds a build;
    # also honoured for a custom --out via --incremental. --clean always forces
    # a full rebuild.
    incr = (not args.clean) and out.exists() and (args.incremental or out_is_default)
    if incr:
        info("Incremental build: reusing %s (copying only changed files; "
             "--clean forces a full rebuild)." % out)

    prog.stage(0); copy_original(app_root, out, prog, incr); prog.done_stage()
    prog.stage(1); apply_overlay(out, prog); prog.done_stage()
    prog.stage(2); apply_patches(out, prog); prog.done_stage()

    prog.stage(3)
    conv_warns, conv_rc = convert_textures(out, python, prog, incr)
    prog.done_stage()
    if conv_rc != 0 or conv_warns:
        for w in conv_warns:
            warn("texture conversion: " + w)
        if conv_rc != 0:
            warn("some GTX surfaces were unsupported; supported assets were "
                 "still written.")

    prog.stage(4)
    music_err = extract_world_music(out, ffmpeg, prog, incr)
    prog.done_stage()
    if music_err:
        warn(music_err)

    prepare_web_icon(src, out, ffmpeg)

    info("")
    info("Build complete in %s: %s" % (_fmt_eta(time.time() - prog.start), out))

    if args.package in ("electron", "webview"):
        info("")
        if args.package == "electron":
            package_electron(out, args.app_name)
        else:
            package_app(out, args.app_name, python)
        # The built game is now copied inside the packaged app, so the
        # intermediate build folder is no longer needed - remove it.
        info("")
        info("Cleaning up the intermediate build folder ...")
        shutil.rmtree(out, ignore_errors=True)
        shutil.rmtree(REPO / "build", ignore_errors=True)
        info("Run the app by launching the executable above.")
    else:
        info("Serve it over HTTP (NOT file://), for example:")
        info('    python -m http.server 8765 --bind 127.0.0.1 --directory "%s"' % out)
        info("Then open http://127.0.0.1:8765/")
        info("Or run `python build.py ... --package` for a self-contained desktop app "
             "(Electron by default; add `--package webview` for a lighter OS-webview build).")


if __name__ == "__main__":
    main()
