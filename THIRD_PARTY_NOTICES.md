# Third-party notices

This project bundles the following third-party components in `overlay/`. They
remain under their original licenses; the copyright stays with their authors.
None of these are Nintendo code or assets.

---

## jsQR
- File: `overlay/scripts/chromium/jsqr.js`
- Author: Cosmo Wolfe
- Project: https://github.com/cozmo/jsQR
- License: Apache License 2.0

```
Copyright (c) 2018 Cosmo Wolfe

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The bundled file is the library's webpack build; only the AMD branch was removed
so it registers a global without clashing with the game's curl/AMD loader.

---

## qrcode-generator
- File: `overlay/scripts/chromium/qrcode-generator.js`
- Author: Kazuhiko Arase
- Project: https://github.com/kazuhikoarase/qrcode-generator
- License: MIT

```
The MIT License (MIT)

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## Wii U GX2 texture de-swizzling (AddrLib port)
- Files: `overlay/tools/wiiu_swizzle_addrlib.rs`, `overlay/tools/wiiu_swizzle_lib.rs`
- These are a community reverse-engineering of the GX2/AddrLib tiled-texture
  address math, ported from the open-source emulators **Cemu**
  (https://github.com/cemu-project/Cemu, MPL-2.0) and **decaf-emu / addrlib**
  (https://github.com/decaf-emu/addrlib). Source references and the upstream
  license links are kept in comments at the top of the files. This is not
  Nintendo proprietary code.
