(function (global) {
    "use strict";

    var DB_NAME = "mvsdk-ts-savefs";
    var DB_VERSION = 1;
    var STORE_NAME = "files";
    var DEFAULT_PROFILE = "default";
    var BACKEND_MARKER_KEY = "chromiumPortSaveBackend";
    var BACKEND_MARKER_VALUE = "indexeddb-v1";

    var db = null;
    var ready = false;
    var memoryOnly = false;
    var cache = {};
    var dbQueue = Promise.resolve();
    var readyPromise = init();

    function normalizePath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
    }

    function cacheKey(path) {
        return "profiles/" + DEFAULT_PROFILE + "/" + normalizePath(path);
    }

    function publicPath(key) {
        var prefix = "profiles/" + DEFAULT_PROFILE + "/";
        return key.indexOf(prefix) === 0 ? key.substr(prefix.length) : key;
    }

    function cloneRecord(record) {
        return {
            key: record.key,
            path: record.path,
            blob: record.blob,
            size: record.size || (record.blob ? record.blob.size : 0),
            updatedAt: record.updatedAt || Date.now()
        };
    }

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error("IndexedDB unavailable"));
                return;
            }

            var request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function (evt) {
                var nextDB = evt.target.result;
                if (!nextDB.objectStoreNames.contains(STORE_NAME)) {
                    nextDB.createObjectStore(STORE_NAME, { keyPath: "key" });
                }
            };
            request.onsuccess = function (evt) {
                resolve(evt.target.result);
            };
            request.onerror = function () {
                reject(request.error || new Error("IndexedDB open failed"));
            };
        });
    }

    function loadAllRecords() {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE_NAME, "readonly");
            var store = tx.objectStore(STORE_NAME);
            var request = store.getAll();

            request.onsuccess = function () {
                var records = request.result || [];
                cache = {};
                records.forEach(function (record) {
                    if (!record || !record.key) return;
                    cache[publicPath(record.key)] = cloneRecord(record);
                });
                resolve();
            };
            request.onerror = function () {
                reject(request.error || new Error("IndexedDB read failed"));
            };
        });
    }

    function init() {
        return openDB().then(function (openedDB) {
            db = openedDB;
            return loadAllRecords();
        }).then(function () {
            ready = true;
            try {
                global.localStorage && global.localStorage.setItem(BACKEND_MARKER_KEY, BACKEND_MARKER_VALUE);
            } catch (err) {}
        }).catch(function (err) {
            console.warn("[chromium-port] IndexedDB save backend unavailable; using non-persistent memory storage.", err);
            db = null;
            memoryOnly = true;
            cache = {};
            ready = true;
        });
    }

    function writeFile(path, data) {
        path = normalizePath(path);
        var blob = data instanceof Blob ? data : new Blob([String(data || "")]);
        var record = {
            key: cacheKey(path),
            path: path,
            blob: blob,
            size: blob.size,
            updatedAt: Date.now()
        };

        cache[path] = cloneRecord(record);

        return enqueueWrite(function () {
            var tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(record);
            return txPromise(tx, "IndexedDB write failed", "IndexedDB write aborted");
        });
    }

    function readFile(path) {
        path = normalizePath(path);
        var record = cache[path];
        return Promise.resolve(record ? record.blob : null);
    }

    function removeFile(path) {
        path = normalizePath(path);
        delete cache[path];

        return enqueueWrite(function () {
            var tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).delete(cacheKey(path));
            return txPromise(tx, "IndexedDB delete failed", "IndexedDB delete aborted");
        });
    }

    function enqueueWrite(operation) {
        if (memoryOnly || !db) {
            return Promise.resolve();
        }
        dbQueue = dbQueue.catch(function () {}).then(operation);
        return dbQueue;
    }

    function txPromise(tx, errorMessage, abortMessage) {
        return new Promise(function (resolve, reject) {
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error || new Error(errorMessage)); };
            tx.onabort = function () { reject(tx.error || new Error(abortMessage)); };
        });
    }

    function exists(path) {
        return !!cache[normalizePath(path)];
    }

    function size(path) {
        var record = cache[normalizePath(path)];
        return record ? record.size : 0;
    }

    function listFiles(path) {
        path = normalizePath(path);
        if (path && path.charAt(path.length - 1) !== "/") {
            path += "/";
        }

        var seen = {};
        var files = [];
        Object.keys(cache).forEach(function (filePath) {
            if (filePath.indexOf(path) !== 0) return;
            var rel = filePath.substr(path.length);
            if (!rel || rel.indexOf("/") !== -1 || seen[rel]) return;
            seen[rel] = true;
            files.push(rel);
        });
        return files;
    }

    function listAllFiles() {
        return Object.keys(cache).sort();
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var result = String(reader.result || "");
                resolve(result.substr(result.indexOf(",") + 1));
            };
            reader.onerror = function () {
                reject(reader.error || new Error("Blob read failed"));
            };
            reader.readAsDataURL(blob);
        });
    }

    function base64ToBlob(base64, type) {
        var binary = atob(String(base64 || ""));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; ++i) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: type || "application/octet-stream" });
    }

    function exportProfile() {
        var paths = listAllFiles();
        var files = [];
        return Promise.all(paths.map(function (path) {
            var record = cache[path];
            return blobToBase64(record.blob).then(function (base64) {
                files.push({
                    path: path,
                    type: record.blob.type || "application/octet-stream",
                    size: record.size || record.blob.size || 0,
                    updatedAt: record.updatedAt || 0,
                    data: base64
                });
            });
        })).then(function () {
            files.sort(function (a, b) {
                return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
            });
            return {
                format: "mvsdk-ts-chromium-save",
                formatVersion: 1,
                backend: BACKEND_MARKER_VALUE,
                profile: DEFAULT_PROFILE,
                exportedAt: new Date().toISOString(),
                files: files
            };
        });
    }

    function clearProfile() {
        var paths = listAllFiles();
        cache = {};
        return Promise.all(paths.map(function (path) {
            if (!db || memoryOnly) return Promise.resolve();
            return enqueueWrite(function () {
                var tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).delete(cacheKey(path));
                return txPromise(tx, "IndexedDB profile clear failed", "IndexedDB profile clear aborted");
            });
        }));
    }

    function importProfile(payload) {
        if (!payload || payload.format !== "mvsdk-ts-chromium-save" || !Array.isArray(payload.files)) {
            return Promise.reject(new Error("Invalid save file"));
        }

        try {
            payload.files.forEach(function (file) {
                if (!file || !file.path || !file.data) {
                    throw new Error("Invalid save entry");
                }
                file.path = normalizePath(file.path);
                if (file.path.indexOf("../") !== -1 || file.path.indexOf("save/") !== 0) {
                    throw new Error("Invalid save path");
                }
            });
        } catch (err) {
            return Promise.reject(err);
        }

        return clearProfile().then(function () {
            var chain = Promise.resolve();
            payload.files.forEach(function (file) {
                chain = chain.then(function () {
                    return writeFile(file.path, base64ToBlob(file.data, file.type));
                });
            });
            return chain;
        });
    }

    global.ChromiumPortSaveFS = {
        backend: BACKEND_MARKER_VALUE,
        profile: DEFAULT_PROFILE,
        readyPromise: readyPromise,
        isReady: function () { return ready; },
        isMemoryOnly: function () { return memoryOnly; },
        init: function () { return readyPromise; },
        listFiles: listFiles,
        listAllFiles: listAllFiles,
        readFile: readFile,
        writeFile: writeFile,
        removeFile: removeFile,
        exists: exists,
        size: size,
        exportProfile: exportProfile,
        importProfile: importProfile,
        clearProfile: clearProfile
    };
})(window);
