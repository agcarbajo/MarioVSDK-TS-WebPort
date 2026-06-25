(function (global) {
    "use strict";

    var cache = {};
    var manifestPromise = null;
    var assetVersion = global.__chromiumPortVersion || new URLSearchParams(global.location.search).get("v") || "chromium-port";

    function normalizeAssetPath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
    }

    function withAssetVersion(path) {
        if (!assetVersion) return path;
        return path + (path.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(assetVersion);
    }

    function be32(bytes, offset) {
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    }

    function makePlaceholder(width, height, label) {
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width || 64);
        canvas.height = Math.max(1, height || 64);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#242424";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#d43";
        var step = 16;
        for (var y = 0; y < canvas.height; y += step) {
            for (var x = 0; x < canvas.width; x += step) {
                if (((x + y) / step) % 2 === 0) ctx.fillRect(x, y, step, step);
            }
        }
        ctx.fillStyle = "white";
        ctx.font = "12px sans-serif";
        ctx.fillText(label || "GTX", 6, 18);
        canvas._gtxUnsupported = true;
        return canvas;
    }

    function parseBlocks(bytes) {
        var blocks = [];
        var offset = 32;
        while (offset + 32 <= bytes.length) {
            if (String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]) !== "BLK{") break;
            var headerSize = be32(bytes, offset + 4);
            var type = be32(bytes, offset + 16);
            var size = be32(bytes, offset + 20);
            var dataOffset = offset + headerSize;
            blocks.push({ type: type, size: size, dataOffset: dataOffset });
            offset = dataOffset + size;
        }
        return blocks;
    }

    function surfaceFromBlock(bytes, block) {
        var o = block.dataOffset;
        return {
            width: be32(bytes, o + 4),
            height: be32(bytes, o + 8),
            depth: be32(bytes, o + 12),
            mipLevels: be32(bytes, o + 16),
            format: be32(bytes, o + 20),
            aa: be32(bytes, o + 24),
            use: be32(bytes, o + 28),
            imageSize: be32(bytes, o + 32),
            tileMode: be32(bytes, o + 48),
            pitch: be32(bytes, o + 60)
        };
    }

    function decodeRgba8(bytes, block, surface) {
        var width = surface.width;
        var height = surface.height;
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        var out = ctx.createImageData(width, height);
        var src = block.dataOffset;
        var pitch = Math.max(width, Math.floor(block.size / Math.max(1, height) / 4));
        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                var si = src + ((y * pitch + x) * 4);
                var di = (y * width + x) * 4;
                out.data[di] = bytes[si];
                out.data[di + 1] = bytes[si + 1];
                out.data[di + 2] = bytes[si + 2];
                out.data[di + 3] = bytes[si + 3];
            }
        }
        ctx.putImageData(out, 0, 0);
        return canvas;
    }

    function rgb565(v) {
        return [
            ((v >> 11) & 31) * 255 / 31,
            ((v >> 5) & 63) * 255 / 63,
            (v & 31) * 255 / 31
        ];
    }

    function colorPalette(c0, c1, punchAlpha) {
        var p0 = rgb565(c0);
        var p1 = rgb565(c1);
        var out = [
            [p0[0], p0[1], p0[2], 255],
            [p1[0], p1[1], p1[2], 255]
        ];
        if (c0 > c1 || !punchAlpha) {
            out.push([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3, 255]);
            out.push([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3, 255]);
        } else {
            out.push([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 255]);
            out.push([0, 0, 0, 0]);
        }
        return out;
    }

    function alphaPalette(a0, a1) {
        var p = [a0, a1];
        if (a0 > a1) {
            for (var i = 1; i <= 6; ++i) p.push(((7 - i) * a0 + i * a1) / 7);
        } else {
            for (var j = 1; j <= 4; ++j) p.push(((5 - j) * a0 + j * a1) / 5);
            p.push(0, 255);
        }
        return p;
    }

    function makeImageDataCanvas(width, height, data) {
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        var imageData = ctx.createImageData(width, height);
        imageData.data.set(data);
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    function decodeBc(bytes, block, surface, mode) {
        var width = surface.width;
        var height = surface.height;
        var blockBytes = mode === "bc1" || mode === "bc4" ? 8 : 16;
        var blocksX = Math.ceil(width / 4);
        var blocksY = Math.ceil(height / 4);
        var pitchBlocks = Math.max(blocksX, Math.ceil((surface.pitch || width) / 4));
        var out = new Uint8ClampedArray(width * height * 4);
        var base = block.dataOffset;
        for (var by = 0; by < blocksY; ++by) {
            for (var bx = 0; bx < blocksX; ++bx) {
                var bo = base + (by * pitchBlocks + bx) * blockBytes;
                if (bo + blockBytes > bytes.length) continue;
                var alphas = null;
                var colorOffset = bo;
                if (mode === "bc2") {
                    alphas = [];
                    for (var ap = 0; ap < 16; ++ap) {
                        var nibble = (bytes[bo + (ap >> 1)] >> ((ap & 1) * 4)) & 0x0f;
                        alphas[ap] = nibble * 17;
                    }
                    colorOffset = bo + 8;
                } else if (mode === "bc3" || mode === "bc4") {
                    var palette = alphaPalette(bytes[bo], bytes[bo + 1]);
                    var bits = 0;
                    var mul = 1;
                    for (var ai = 0; ai < 6; ++ai) {
                        bits += bytes[bo + 2 + ai] * mul;
                        mul *= 256;
                    }
                    alphas = [];
                    for (var ax = 0; ax < 16; ++ax) {
                        alphas[ax] = palette[(bits >> (3 * ax)) & 7];
                    }
                    colorOffset = bo + 8;
                    if (mode === "bc4") {
                        for (var py = 0; py < 4; ++py) {
                            for (var px = 0; px < 4; ++px) {
                                var xx = bx * 4 + px, yy = by * 4 + py;
                                if (xx >= width || yy >= height) continue;
                                var di = (yy * width + xx) * 4;
                                var v = alphas[py * 4 + px];
                                out[di] = out[di + 1] = out[di + 2] = 255;
                                out[di + 3] = v;
                            }
                        }
                        continue;
                    }
                }
                var c0 = bytes[colorOffset] | (bytes[colorOffset + 1] << 8);
                var c1 = bytes[colorOffset + 2] | (bytes[colorOffset + 3] << 8);
                var colors = colorPalette(c0, c1, mode === "bc1");
                var code = (bytes[colorOffset + 4] | (bytes[colorOffset + 5] << 8) | (bytes[colorOffset + 6] << 16) | (bytes[colorOffset + 7] << 24)) >>> 0;
                for (var y = 0; y < 4; ++y) {
                    for (var x = 0; x < 4; ++x) {
                        var ix = y * 4 + x;
                        var dx = bx * 4 + x;
                        var dy = by * 4 + y;
                        if (dx >= width || dy >= height) continue;
                        var col = colors[(code >> (2 * ix)) & 3];
                        var oi = (dy * width + dx) * 4;
                        out[oi] = col[0];
                        out[oi + 1] = col[1];
                        out[oi + 2] = col[2];
                        out[oi + 3] = alphas ? alphas[ix] : col[3];
                    }
                }
            }
        }
        return makeImageDataCanvas(width, height, out);
    }

    function decodeA8(bytes, block, surface) {
        var width = surface.width;
        var height = surface.height;
        var pitch = Math.max(width, surface.pitch || width);
        var out = new Uint8ClampedArray(width * height * 4);
        var src = block.dataOffset;
        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                var a = bytes[src + y * pitch + x];
                var di = (y * width + x) * 4;
                out[di] = out[di + 1] = out[di + 2] = 255;
                out[di + 3] = a;
            }
        }
        return makeImageDataCanvas(width, height, out);
    }

    function decodeLa8(bytes, block, surface) {
        // GX2 format 0x07 (R8_G8): two bytes per pixel, R = luminance,
        // G = alpha. Used by the anti-aliased stamp atlases.
        var width = surface.width;
        var height = surface.height;
        var pitch = Math.max(width, surface.pitch || width);
        var out = new Uint8ClampedArray(width * height * 4);
        var src = block.dataOffset;
        for (var y = 0; y < height; ++y) {
            for (var x = 0; x < width; ++x) {
                var si = src + (y * pitch + x) * 2;
                var lum = bytes[si];
                var di = (y * width + x) * 4;
                out[di] = out[di + 1] = out[di + 2] = lum;
                out[di + 3] = bytes[si + 1];
            }
        }
        return makeImageDataCanvas(width, height, out);
    }

    function parseGtx(bytes, path) {
        if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "Gfx2") {
            throw new Error("Not a Gfx2 GTX: " + path);
        }
        var blocks = parseBlocks(bytes);
        var images = [];
        var surface = null;
        for (var i = 0; i < blocks.length; ++i) {
            if (blocks[i].type === 0x0b) {
                surface = surfaceFromBlock(bytes, blocks[i]);
            } else if (blocks[i].type === 0x0c && surface) {
                if (surface.format === 0x1a) {
                    images.push(decodeRgba8(bytes, blocks[i], surface));
                } else if (surface.format === 0x31) {
                    images.push(decodeBc(bytes, blocks[i], surface, "bc1"));
                } else if (surface.format === 0x32) {
                    images.push(decodeBc(bytes, blocks[i], surface, "bc2"));
                } else if (surface.format === 0x33) {
                    images.push(decodeBc(bytes, blocks[i], surface, "bc3"));
                } else if (surface.format === 0x34) {
                    images.push(decodeBc(bytes, blocks[i], surface, "bc4"));
                } else if (surface.format === 0x07) {
                    images.push(decodeLa8(bytes, blocks[i], surface));
                } else {
                    console.warn("[chromium-port] Unsupported GTX format 0x" + surface.format.toString(16) + " in " + path);
                    images.push(makePlaceholder(surface.width, surface.height, "GTX 0x" + surface.format.toString(16)));
                }
                surface = null;
            }
        }
        return images.length ? images : [makePlaceholder(64, 64, "empty GTX")];
    }

    async function inflateIfNeeded(response) {
        if ("DecompressionStream" in global) {
            var stream = response.body.pipeThrough(new DecompressionStream("gzip"));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error("This Chromium build lacks DecompressionStream; run tools/convert_gtx.py or use a newer Chromium.");
    }

    async function loadGtxBundle(path) {
        path = normalizeAssetPath(path);
        if (cache[path]) return cache[path];
        var promise = loadConverted(path).then(function (converted) {
            if (converted) {
                return converted;
            }
            console.warn("[chromium-port] No converted GTX entry for " + path + "; using runtime decoder fallback.");
            return fetch(path).then(async function (response) {
            if (!response.ok) throw new Error("GTX fetch failed: " + path + " (" + response.status + ")");
            var bytes = path.toLowerCase().endsWith(".gz") ? await inflateIfNeeded(response) : new Uint8Array(await response.arrayBuffer());
            return parseGtx(bytes, path);
            });
        });
        cache[path] = promise;
        return promise;
    }

    function loadManifest() {
        if (!manifestPromise) {
            manifestPromise = fetch(withAssetVersion("converted/gtx-manifest.json"), { cache: "no-store" }).then(function (response) {
                return response.ok ? response.json() : {};
            }).catch(function () { return {}; });
        }
        return manifestPromise;
    }

    function imageToCanvas(img) {
        var canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas;
    }

    function loadImageElement(url) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                resolve(img);
            };
            img.onerror = function () {
                reject(new Error("image failed: " + url));
            };
            img.src = url;
        });
    }

    function loadImage(path, surface) {
        var versionedPath = withAssetVersion(path);

        return fetch(versionedPath, { cache: "force-cache" }).then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.blob();
        }).then(function (blob) {
            var objectUrl = URL.createObjectURL(blob);
            return loadImageElement(objectUrl).then(function (img) {
                URL.revokeObjectURL(objectUrl);
                return imageToCanvas(img);
            }, function (err) {
                URL.revokeObjectURL(objectUrl);
                throw err;
            });
        }).catch(function () {
            return loadImageElement(versionedPath).then(imageToCanvas).catch(function () {
                return loadImageElement(path).then(imageToCanvas).catch(function () {
                    console.warn("[chromium-port] Converted image failed to load: " + path + "; using placeholder.");
                    return makePlaceholder(surface && surface.width, surface && surface.height, path.split("/").pop());
                });
            });
        });
    }

    function loadImagesLimited(images, surfaces, limit) {
        var out = new Array(images.length);
        var next = 0;
        var active = 0;

        return new Promise(function (resolve) {
            function pump() {
                if (next >= images.length && active === 0) {
                    resolve(out);
                    return;
                }
                while (active < limit && next < images.length) {
                    (function (index) {
                        active++;
                        loadImage(images[index], surfaces && surfaces[index]).then(function (img) {
                            out[index] = img;
                        }).then(function () {
                            active--;
                            pump();
                        });
                    })(next++);
                }
            }
            pump();
        });
    }

    async function loadConverted(path) {
        path = normalizeAssetPath(path);
        var manifest = await loadManifest();
        var item = manifest[path];
        if (!item) {
            var lowerPath = path.toLowerCase();
            var keys = Object.keys(manifest);
            for (var k = 0; k < keys.length; ++k) {
                if (keys[k].toLowerCase() === lowerPath) {
                    item = manifest[keys[k]];
                    break;
                }
            }
        }
        if (!item || !item.images || item.images.length === 0) return null;
        var images = await loadImagesLimited(item.images, item.surfaces, 6);
        if (item.images.length !== item.surfaces.length) {
            console.warn("[chromium-port] Converted GTX surface count mismatch for " + path + ": " + item.images.length + "/" + item.surfaces.length);
        }
        return images;
    }

    global.ChromiumPort = global.ChromiumPort || {};
    global.ChromiumPort.loadGtxBundle = loadGtxBundle;
    global.ChromiumPort.parseGtx = parseGtx;
    global.ChromiumPort.inspectGtx = async function (path) {
        var manifest = await loadManifest();
        path = normalizeAssetPath(path);
        return {
            path: path,
            item: manifest[path],
            cached: !!cache[path],
            version: assetVersion
        };
    };
})(window);
