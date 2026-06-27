// Electron entry point for the Mario vs. Donkey Kong: Tipping Stars desktop app.
//
// The port must be served over HTTP (its scripts/textures/data load with
// relative fetch/XHR), so we start a tiny localhost static server for the
// bundled game files and load it in a BrowserWindow. Electron ships its own
// Chromium, so the resulting app is fully self-contained.

const { app, BrowserWindow, Menu, session } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_TITLE = "Mario vs. Donkey Kong: Tipping Stars";

// The QR save-transfer feature uses the webcam. On Windows, Chromium's
// MediaFoundation capture backend often fails to start some cameras with
// "NotReadableError: Could not start video source"; forcing the older
// DirectShow backend fixes it. (The WebView2 build uses the same flag.)
app.commandLine.appendSwitch("disable-features", "MediaFoundationVideoCapture");

// The game stores its save in IndexedDB, which is keyed by page origin
// (http://127.0.0.1:<port>). We therefore serve on a FIXED port so the origin
// is stable across launches and the save persists. A single-instance lock keeps
// a second launch from grabbing a different port (which would orphan the save).
const FIXED_PORT = 47821;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".bin": "application/octet-stream",
  ".dsp": "application/octet-stream",
  ".gtx": "application/octet-stream",
};

function findWebRoot() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "web") : null,
    process.resourcesPath ? path.join(process.resourcesPath, "chromium-port") : null,
    path.join(__dirname, "web"),
    path.join(__dirname, "..", "build", "chromium-port"), // dev: run from the repo
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return null;
}

function startServer(root, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
      const filePath = path.normalize(path.join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.once("error", function (err) {
      // Preferred fixed port is busy: fall back to a random one so the app
      // still runs (saves may not carry over for this session only).
      if (err && err.code === "EADDRINUSE" && port !== 0) {
        console.warn("[mvdk] port " + port + " busy; using a random port (save may not persist this session).");
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      } else {
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function createWindow() {
  const root = findWebRoot();
  const opts = {
    width: 960,
    height: 600,
    title: APP_TITLE,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  };
  // Use the real game icon for the window / taskbar when available.
  if (root) {
    const iconPath = path.join(root, "game-icon.png");
    if (fs.existsSync(iconPath)) {
      opts.icon = iconPath;
    }
  }
  const win = new BrowserWindow(opts);
  Menu.setApplicationMenu(null);

  if (!root) {
    win.loadURL(
      "data:text/html," +
        encodeURIComponent(
          "<body style='font:16px sans-serif;padding:2em'>" +
            "<h2>Game files not found</h2><p>The bundled <code>web/</code> folder " +
            "(the built port) is missing from this app.</p></body>"
        )
    );
    return;
  }

  const port = await startServer(root, FIXED_PORT);
  win.loadURL("http://127.0.0.1:" + port + "/");
}

// Single instance: keep one window (and thus one stable origin) at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });

  app.whenReady().then(function () {
    // Trusted local app: grant webcam/mic (used by the QR save transfer) so the
    // camera starts without a denied-permission failure.
    session.defaultSession.setPermissionRequestHandler(function (wc, permission, callback) {
      callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(function () { return true; });
    createWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
