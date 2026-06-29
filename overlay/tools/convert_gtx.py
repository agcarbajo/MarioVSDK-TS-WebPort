import gzip
import json
import multiprocessing
import os
import pathlib
import struct
import sys
import time
import zlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "converted"

# PNG zlib level for the converted textures. These are small UI/sprite atlases
# rebuilt locally, so favour speed over a few extra KB. Level 6 is a good
# speed/size balance and noticeably faster than the previous level 9.
PNG_COMPRESS_LEVEL = 6


def be32(data, offset):
    return struct.unpack_from(">I", data, offset)[0]


M_BANKS = 4
M_PIPES = 2
M_PIPE_INTERLEAVE_BYTES = 256
MICRO_TILE_WIDTH = 8
MICRO_TILE_HEIGHT = 8
MICRO_TILE_PIXELS = MICRO_TILE_WIDTH * MICRO_TILE_HEIGHT


def bits_to_bytes(value):
    return (value + 7) // 8


def bit(value, index):
    return (value >> index) & 1


def pipe_bank_swizzle(swizzle):
    return (swizzle >> 8) & 1, (swizzle >> 9) & 3


def pixel_index_micro(x, y, z, bpp_bits, tile_mode):
    x0, x1, x2 = bit(x, 0), bit(x, 1), bit(x, 2)
    y0, y1, y2 = bit(y, 0), bit(y, 1), bit(y, 2)
    if bpp_bits == 8:
        bits = (x0, x1, x2, y1, y0, y2)
    elif bpp_bits == 16:
        bits = (x0, x1, x2, y0, y1, y2)
    elif bpp_bits == 64:
        bits = (x0, y0, x1, x2, y1, y2)
    elif bpp_bits == 128:
        bits = (y0, x0, x1, x2, y1, y2)
    else:
        bits = (x0, x1, y0, x2, y1, y2)
    return sum(bits[i] << i for i in range(6))


def pipe_from_coord(x, y):
    return bit(y, 3) ^ bit(x, 3)


def bank_from_coord(x, y):
    tx = x // M_BANKS
    ty = y // M_PIPES
    bank0 = bit(ty, 4) ^ bit(x, 3)
    bank1 = bit(ty, 3) ^ bit(x, 4)
    return bank0 | (bank1 << 1)


def addr_micro_tiled(x, y, z, bpp_bits, pitch, height, tile_mode):
    bpp_bytes = bpp_bits // 8
    micro_tile_bytes = bits_to_bytes(MICRO_TILE_PIXELS * bpp_bits)
    micro_tiles_per_row = pitch // MICRO_TILE_WIDTH
    micro_tile_offset = micro_tile_bytes * ((x // 8) + (y // 8) * micro_tiles_per_row)
    pixel_offset = (bpp_bits * pixel_index_micro(x, y, z, bpp_bits, tile_mode)) // 8
    return micro_tile_offset + pixel_offset


def addr_macro_tiled(x, y, z, bpp_bits, pitch, height, tile_mode, swizzle):
    micro_tile_bits = MICRO_TILE_PIXELS * bpp_bits
    micro_tile_bytes = micro_tile_bits // 8
    pixel_offset = bpp_bits * pixel_index_micro(x, y, z, bpp_bits, tile_mode)
    elem_offset = pixel_offset // 8
    pipe = pipe_from_coord(x, y)
    bank = bank_from_coord(x, y)
    pipe_swizzle, bank_swizzle = pipe_bank_swizzle(swizzle)
    bank_pipe = pipe + M_PIPES * bank
    rotation = M_PIPES * ((M_BANKS >> 1) - 1)
    bank_pipe ^= pipe_swizzle + M_PIPES * bank_swizzle + z * rotation
    bank_pipe %= M_PIPES * M_BANKS
    pipe = bank_pipe % M_PIPES
    bank = bank_pipe // M_PIPES

    macro_tile_pitch = 8 * M_BANKS
    macro_tile_height = 8 * M_PIPES
    macro_tiles_per_row = pitch // macro_tile_pitch
    macro_tile_bytes = bits_to_bytes(bpp_bits * macro_tile_height * macro_tile_pitch)
    macro_tile_offset = macro_tile_bytes * ((x // macro_tile_pitch) + macro_tiles_per_row * (y // macro_tile_height))

    group_bits = M_PIPE_INTERLEAVE_BYTES.bit_length() - 1
    pipe_bits_count = M_PIPES.bit_length() - 1
    bank_bits_count = M_BANKS.bit_length() - 1
    group_mask = (1 << group_bits) - 1
    total_offset = elem_offset + (macro_tile_offset >> (bank_bits_count + pipe_bits_count))
    offset_high = (total_offset & ~group_mask) << (bank_bits_count + pipe_bits_count)
    offset_low = total_offset & group_mask
    bank_bits = bank << (pipe_bits_count + group_bits)
    pipe_bits = pipe << group_bits
    return bank_bits | pipe_bits | offset_low | offset_high


def deswizzle(raw, offset, size, surface, width_units, height_units, bytes_per_unit):
    tile_mode = surface.get("tileMode", 0)
    pitch = surface.get("pitch") or width_units
    swizzle = surface.get("swizzle", 0)
    bpp_bits = bytes_per_unit * 8
    out = bytearray(width_units * height_units * bytes_per_unit)
    for y in range(height_units):
        for x in range(width_units):
            if tile_mode in (0, 1):
                src = offset + (y * pitch + x) * bytes_per_unit
            elif tile_mode == 2:
                src = offset + addr_micro_tiled(x, y, 0, bpp_bits, pitch, height_units, tile_mode)
            else:
                src = offset + addr_macro_tiled(x, y, 0, bpp_bits, pitch, height_units, tile_mode, swizzle)
            dst = (y * width_units + x) * bytes_per_unit
            if src + bytes_per_unit <= offset + size:
                out[dst:dst + bytes_per_unit] = raw[src:src + bytes_per_unit]
    return out


def chunks(tag, data):
    yield len(data).to_bytes(4, "big") + tag + data + zlib.crc32(tag + data).to_bytes(4, "big")


def png_rgba(width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    payload = b"".join(chunks(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    payload += b"".join(chunks(b"IDAT", zlib.compress(bytes(raw), PNG_COMPRESS_LEVEL)))
    payload += b"".join(chunks(b"IEND", b""))
    return b"\x89PNG\r\n\x1a\n" + payload


def rgb565(v):
    return (
        ((v >> 11) & 31) * 255 // 31,
        ((v >> 5) & 63) * 255 // 63,
        (v & 31) * 255 // 31,
    )


def alpha_palette(a0, a1):
    out = [a0, a1]
    if a0 > a1:
        out.extend(((7 - i) * a0 + i * a1) // 7 for i in range(1, 7))
    else:
        out.extend(((5 - i) * a0 + i * a1) // 5 for i in range(1, 5))
        out.extend([0, 255])
    return out


def color_palette(c0, c1, punch_alpha):
    p0 = rgb565(c0)
    p1 = rgb565(c1)
    out = [
        (*p0, 255),
        (*p1, 255),
    ]
    if c0 > c1 or not punch_alpha:
        out.append(tuple(((2 * p0[i] + p1[i]) // 3) for i in range(3)) + (255,))
        out.append(tuple(((p0[i] + 2 * p1[i]) // 3) for i in range(3)) + (255,))
    else:
        out.append(tuple(((p0[i] + p1[i]) // 2) for i in range(3)) + (255,))
        out.append((0, 0, 0, 0))
    return out


def decode_bc(raw, offset, size, surface, mode):
    width = surface["width"]
    height = surface["height"]
    block_bytes = 8 if mode in ("bc1", "bc4") else 16
    blocks_x = (width + 3) // 4
    blocks_y = (height + 3) // 4
    linear = deswizzle(raw, offset, size, surface, blocks_x, blocks_y, block_bytes)
    out = bytearray(width * height * 4)
    for by in range(blocks_y):
        for bx in range(blocks_x):
            bo = (by * blocks_x + bx) * block_bytes
            if bo + block_bytes > len(linear):
                continue
            alphas = None
            color_offset = bo
            if mode == "bc2":
                alphas = [((linear[bo + (i >> 1)] >> ((i & 1) * 4)) & 0x0F) * 17 for i in range(16)]
                color_offset = bo + 8
            elif mode in ("bc3", "bc4"):
                pal = alpha_palette(linear[bo], linear[bo + 1])
                bits = int.from_bytes(linear[bo + 2:bo + 8], "little")
                alphas = [pal[(bits >> (3 * i)) & 7] for i in range(16)]
                color_offset = bo + 8
                if mode == "bc4":
                    for y in range(4):
                        for x in range(4):
                            dx, dy = bx * 4 + x, by * 4 + y
                            if dx >= width or dy >= height:
                                continue
                            di = (dy * width + dx) * 4
                            out[di:di + 4] = bytes((255, 255, 255, alphas[y * 4 + x]))
                    continue
            c0 = linear[color_offset] | (linear[color_offset + 1] << 8)
            c1 = linear[color_offset + 2] | (linear[color_offset + 3] << 8)
            colors = color_palette(c0, c1, mode == "bc1")
            code = int.from_bytes(linear[color_offset + 4:color_offset + 8], "little")
            for y in range(4):
                for x in range(4):
                    dx, dy = bx * 4 + x, by * 4 + y
                    if dx >= width or dy >= height:
                        continue
                    ci = (code >> (2 * (y * 4 + x))) & 3
                    r, g, b, a = colors[ci]
                    if alphas is not None:
                        a = alphas[y * 4 + x]
                    di = (dy * width + dx) * 4
                    out[di:di + 4] = bytes((r, g, b, a))
    return out


def decode_a8(raw, offset, size, surface):
    width = surface["width"]
    height = surface["height"]
    linear = deswizzle(raw, offset, size, surface, width, height, 1)
    out = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            a = linear[y * width + x]
            di = (y * width + x) * 4
            out[di:di + 4] = bytes((255, 255, 255, a))
    return out


def decode_la8(raw, offset, size, surface):
    # GX2 format 0x07 (R8_G8) as used by the anti-aliased stamp atlases:
    # two bytes per pixel, R = luminance, G = alpha. Previously this was
    # mistakenly decoded as A8 (one byte per pixel), which read the wrong
    # stride and produced garbled/blank stamps.
    width = surface["width"]
    height = surface["height"]
    linear = deswizzle(raw, offset, size, surface, width, height, 2)
    out = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            si = (y * width + x) * 2
            lum = linear[si]
            alpha = linear[si + 1]
            di = (y * width + x) * 4
            out[di:di + 4] = bytes((lum, lum, lum, alpha))
    return out


def parse_blocks(data):
    offset = 32
    while offset + 32 <= len(data) and data[offset:offset + 4] == b"BLK{":
        header_size = be32(data, offset + 4)
        block_type = be32(data, offset + 16)
        size = be32(data, offset + 20)
        data_offset = offset + header_size
        yield block_type, data_offset, size
        offset = data_offset + size


def convert_one(path):
    raw = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    if raw[:4] != b"Gfx2":
        raise ValueError("not a Gfx2 GTX")
    surfaces = []
    images = []
    current = None
    for block_type, offset, size in parse_blocks(raw):
        if block_type == 0x0B:
            current = {
                "width": be32(raw, offset + 4),
                "height": be32(raw, offset + 8),
                "format": be32(raw, offset + 20),
                "imageSize": be32(raw, offset + 32),
                "mipSize": be32(raw, offset + 40),
                "tileMode": be32(raw, offset + 48),
                "swizzle": be32(raw, offset + 52),
                "alignment": be32(raw, offset + 56),
                "pitch": be32(raw, offset + 60),
            }
        elif block_type == 0x0C and current:
            surface = dict(current)
            surfaces.append(surface)
            fmt = surface["format"]
            width = surface["width"]
            height = surface["height"]
            image = None
            if fmt == 0x1A:
                image = deswizzle(raw, offset, size, surface, width, height, 4)
            elif fmt == 0x31:
                image = decode_bc(raw, offset, size, surface, "bc1")
            elif fmt == 0x32:
                image = decode_bc(raw, offset, size, surface, "bc2")
            elif fmt == 0x33:
                image = decode_bc(raw, offset, size, surface, "bc3")
            elif fmt == 0x34:
                image = decode_bc(raw, offset, size, surface, "bc4")
            elif fmt == 0x07:
                image = decode_la8(raw, offset, size, surface)

            if image is not None:
                rel = path.relative_to(ROOT).as_posix()
                out_path = OUT / rel.replace(".gtx.gz", "").replace(".gtx", "")
                suffix = "" if len(images) == 0 else f"_{len(images)}"
                out_path = out_path.with_name(out_path.name + suffix + ".png")
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(png_rgba(width, height, image))
                images.append(out_path.relative_to(ROOT).as_posix())
            current = None
    return {
        "source": path.relative_to(ROOT).as_posix(),
        "images": images,
        "surfaces": surfaces,
        "supported": len(images) == len(surfaces),
    }


def _fmt_eta(seconds):
    if seconds is None or seconds < 0:
        return "--:--"
    seconds = int(seconds)
    return "%d:%02d" % (seconds // 60, seconds % 60)


def main():
    args = sys.argv[1:]
    porcelain = False
    jobs = None
    incremental = False
    explicit = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--porcelain":
            porcelain = True
        elif a == "--incremental":
            incremental = True
        elif a == "--jobs":
            i += 1
            jobs = int(args[i])
        elif a.startswith("--jobs="):
            jobs = int(a.split("=", 1)[1])
        else:
            explicit.append(a)
        i += 1

    OUT.mkdir(parents=True, exist_ok=True)
    paths = [ROOT / x for x in explicit] if explicit else sorted(ROOT.rglob("*.gtx.gz"))

    manifest_path = OUT / "gtx-manifest.json"
    manifest = {}
    # Incremental: a GTX bundle never changes between builds (it comes from the
    # fixed game files), so any bundle already converted-and-supported in a prior
    # build can be skipped. Keep its manifest entry and only reconvert the rest.
    if incremental and manifest_path.exists():
        try:
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
        kept = {}
        todo = []
        for p in paths:
            key = p.relative_to(ROOT).as_posix()
            entry = prev.get(key)
            if entry and entry.get("supported") and all(
                    (ROOT / img).exists() for img in entry.get("images", [])):
                kept[key] = entry
            else:
                todo.append(p)
        manifest.update(kept)
        skipped = len(kept)
        paths = todo
    else:
        skipped = 0

    total = len(paths) + skipped

    if jobs is None:
        jobs = os.cpu_count() or 1
    jobs = max(1, min(jobs, len(paths) or 1))

    unsupported = []
    done = skipped
    start = time.time()

    def report():
        if porcelain:
            sys.stdout.write("PROGRESS %d %d\n" % (done, total))
            sys.stdout.flush()
        else:
            frac = done / total if total else 1.0
            elapsed = time.time() - start
            eta = (elapsed * (1 - frac) / frac) if frac > 0 else None
            sys.stdout.write("\r[convert] %3d%% (%d/%d)  ETA %s   "
                             % (round(frac * 100), done, total, _fmt_eta(eta)))
            sys.stdout.flush()

    def handle(item):
        nonlocal done
        manifest[item["source"]] = item
        if not item["supported"]:
            unsupported.append(item)
        done += 1
        report()

    if jobs > 1 and len(paths) > 1:
        # Convert bundles across CPU cores; each worker decodes one bundle and
        # writes its own PNGs, so there are no write conflicts.
        pool = multiprocessing.Pool(processes=jobs)
        try:
            for item in pool.imap_unordered(convert_one, paths):
                handle(item)
            pool.close()
        finally:
            pool.join()
    else:
        for path in paths:
            handle(convert_one(path))

    if not porcelain and total:
        sys.stdout.write("\n")

    if explicit and not incremental and manifest_path.exists():
        merged = json.loads(manifest_path.read_text(encoding="utf-8"))
        merged.update(manifest)
        manifest = merged
    # sort_keys so the manifest is deterministic regardless of parallel
    # completion order -> reproducible builds (clean and incremental match).
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    if unsupported:
        for item in unsupported:
            formats = sorted({hex(s["format"]) for s in item["surfaces"] if s["format"] != 0x1A})
            msg = "%s: %s" % (item["source"], ", ".join(formats))
            if porcelain:
                sys.stdout.write("WARN unsupported GTX surfaces: " + msg + "\n")
            else:
                print("Unsupported GTX surfaces: " + msg, file=sys.stderr)
        if porcelain:
            sys.stdout.flush()
        return 1
    return 0


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
