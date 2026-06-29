#!/usr/bin/env node
/*
 * MvDK: Tipping Stars - Community backend.
 *
 * A small, dependency-free (Node built-ins only) HTTP server that provides the
 * online community features for the web port: user profiles (a stand-in for the
 * old Miiverse profile), level sharing (upload / download), stars and comments,
 * plus a web admin panel for moderation.
 *
 * Run:  node server.js           (port 8080 by default, or PORT env)
 * Data is stored under ./data (JSON db + uploaded level files + avatars).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const SERVER_NAME = process.env.SERVER_NAME || "MvDK Community Server";
const VERSION = "0.3.0";

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(DATA_DIR, "levels");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const COMMENT_DIR = path.join(DATA_DIR, "comments");
const ADMIN_TOKEN_FILE = path.join(DATA_DIR, "admin-token.txt");
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_BODY = 8 * 1024 * 1024; // 8 MB (levels + base64 avatars)

// ---------------------------------------------------------------- storage ----

for (const d of [DATA_DIR, UPLOAD_DIR, AVATAR_DIR, COMMENT_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

let db = { users: {}, levels: {}, comments: {}, seq: { level: 0, comment: 0 } };
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
    catch (e) { console.error("Could not read db.json, starting fresh:", e.message); }
}
let saveTimer = null;
function saveDb() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const tmp = DB_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, DB_FILE);
    }, 50);
}

let ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
if (!ADMIN_TOKEN) {
    if (fs.existsSync(ADMIN_TOKEN_FILE)) {
        ADMIN_TOKEN = fs.readFileSync(ADMIN_TOKEN_FILE, "utf8").trim();
    } else {
        ADMIN_TOKEN = crypto.randomBytes(12).toString("hex");
        fs.writeFileSync(ADMIN_TOKEN_FILE, ADMIN_TOKEN);
    }
}

function id() { return crypto.randomBytes(8).toString("hex"); }
function now() { return Date.now(); }

// ------------------------------------------------------------- http utils ----

function send(res, status, body, headers) {
    const h = Object.assign({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Token",
    }, headers || {});
    if (body !== null && body !== undefined && typeof body === "object" && !Buffer.isBuffer(body)) {
        body = JSON.stringify(body);
        h["Content-Type"] = h["Content-Type"] || "application/json; charset=utf-8";
    }
    res.writeHead(status, h);
    res.end(body);
}
function ok(res, body) { send(res, 200, body); }
function bad(res, msg, code) { send(res, code || 400, { error: msg || "bad request" }); }

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error("payload too large")); req.destroy(); return; }
            chunks.push(c);
        });
        req.on("end", () => {
            if (!chunks.length) return resolve({});
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch (e) { reject(new Error("invalid JSON body")); }
        });
        req.on("error", reject);
    });
}

function userByToken(req) {
    const auth = req.headers["authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    return Object.values(db.users).find((u) => u.token === token) || null;
}
function isAdmin(req) {
    const t = (req.headers["x-admin-token"] || "").trim() ||
        (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
    return t && t === ADMIN_TOKEN;
}

function publicUser(u) {
    return u && { id: u.id, name: u.name, avatar: u.avatar ? "/avatars/" + u.id + ".png" : null,
                  createdAt: u.createdAt, banned: !!u.banned };
}
function publicLevel(l, includeData) {
    const out = {
        id: l.id, title: l.title, authorId: l.authorId, authorName: l.authorName,
        createdAt: l.createdAt, stars: (l.starredBy || []).length, downloads: l.downloads || 0,
        tips: l.tips || 0,
        comments: Object.values(db.comments).filter((c) => c.levelId === l.id && !c.hidden).length,
        thumbnail: l.thumbnail ? "/levels/" + l.id + ".thumb.png" : null,
        hidden: !!l.hidden, official: !!l.official, native: !!l.native, communityType: l.communityType,
        params: l.params || null,
    };
    if (includeData) {
        try { out.data = JSON.parse(fs.readFileSync(path.join(UPLOAD_DIR, l.id + ".json"), "utf8")); }
        catch (e) { out.data = null; }
    }
    return out;
}

function saveDataUrlImage(dataUrl, file) {
    // accepts "data:image/png;base64,...." -> writes png file, returns true
    const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/.exec(dataUrl || "");
    if (!m) return false;
    fs.writeFileSync(file, Buffer.from(m[1], "base64"));
    return true;
}

// -------------------------------------------------------------- handlers ----

const routes = [];
function route(method, pattern, handler) {
    // pattern like /api/levels/:id
    const keys = [];
    const rx = new RegExp("^" + pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1)); return "([^/]+)";
    }) + "$");
    routes.push({ method, rx, keys, handler });
}

// --- info / connectivity ---
route("GET", "/api/info", async (req, res) => {
    ok(res, { name: SERVER_NAME, version: VERSION, time: now(),
              users: Object.keys(db.users).length, levels: Object.keys(db.levels).length });
});

// --- users ---
route("POST", "/api/users", async (req, res) => {
    const body = await readBody(req);
    const name = (body.name || "").toString().trim().slice(0, 32);
    if (!name) return bad(res, "name required");
    const uid = id();
    const u = { id: uid, token: crypto.randomBytes(16).toString("hex"),
                name, avatar: false, createdAt: now(), banned: false };
    if (body.avatar && saveDataUrlImage(body.avatar, path.join(AVATAR_DIR, uid + ".png"))) {
        u.avatar = true;
    }
    db.users[uid] = u;
    saveDb();
    ok(res, { id: u.id, token: u.token, name: u.name, avatar: publicUser(u).avatar });
});

route("GET", "/api/users/:id", async (req, res, params) => {
    const u = db.users[params.id];
    if (!u) return bad(res, "not found", 404);
    ok(res, publicUser(u));
});

// update own profile (name / avatar)
route("PUT", "/api/users/me", async (req, res) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    const body = await readBody(req);
    if (body.name) u.name = body.name.toString().trim().slice(0, 32);
    if (body.avatar && saveDataUrlImage(body.avatar, path.join(AVATAR_DIR, u.id + ".png"))) u.avatar = true;
    saveDb();
    ok(res, publicUser(u));
});

// --- levels ---
route("POST", "/api/levels", async (req, res) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    if (u.banned) return bad(res, "account banned", 403);
    const body = await readBody(req);
    const title = (body.title || "").toString().trim().slice(0, 64) || "Untitled";
    if (!body.data) return bad(res, "level data required");
    const lid = id();
    fs.writeFileSync(path.join(UPLOAD_DIR, lid + ".json"), JSON.stringify(body.data));
    const l = { id: lid, title, authorId: u.id, authorName: u.name, createdAt: now(),
                starredBy: [], downloads: 0, hidden: false, thumbnail: false };
    if (body.thumbnail && saveDataUrlImage(body.thumbnail, path.join(UPLOAD_DIR, lid + ".thumb.png"))) {
        l.thumbnail = true;
    }
    db.levels[lid] = l;
    saveDb();
    ok(res, publicLevel(l, false));
});

route("GET", "/api/levels", async (req, res, params, query) => {
    let list = Object.values(db.levels).filter((l) => !l.hidden);
    if (query.author) list = list.filter((l) => l.authorId === query.author);
    const sort = query.sort || "new";
    if (sort === "stars") list.sort((a, b) => (b.starredBy || []).length - (a.starredBy || []).length);
    else if (sort === "downloads") list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    else list.sort((a, b) => b.createdAt - a.createdAt);
    const offset = parseInt(query.offset || "0", 10);
    const limit = Math.min(parseInt(query.limit || "50", 10), 100);
    ok(res, { total: list.length, levels: list.slice(offset, offset + limit).map((l) => publicLevel(l, false)) });
});

route("GET", "/api/levels/:id", async (req, res, params) => {
    const l = db.levels[params.id];
    if (!l || l.hidden) return bad(res, "not found", 404);
    l.downloads = (l.downloads || 0) + 1;
    saveDb();
    ok(res, publicLevel(l, true));
});

route("POST", "/api/levels/:id/star", async (req, res, params) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    const l = db.levels[params.id];
    if (!l || l.hidden) return bad(res, "not found", 404);
    l.starredBy = l.starredBy || [];
    const i = l.starredBy.indexOf(u.id);
    let starred;
    if (i === -1) { l.starredBy.push(u.id); starred = true; }
    else { l.starredBy.splice(i, 1); starred = false; }
    saveDb();
    ok(res, { stars: l.starredBy.length, starred });
});

route("GET", "/api/levels/:id/comments", async (req, res, params) => {
    const list = Object.values(db.comments)
        .filter((c) => c.levelId === params.id && !c.hidden)
        .sort((a, b) => a.createdAt - b.createdAt);
    ok(res, { comments: list.map((c) => ({ id: c.id, userId: c.userId, userName: c.userName,
                                            text: c.text, createdAt: c.createdAt,
                                            stamp: c.stamp || null,
                                            memo: c.memo ? "/comments/" + c.id + ".png" : null,
                                            userAvatar: (db.users[c.userId] && db.users[c.userId].avatar) ? "/avatars/" + c.userId + ".png" : null })) });
});

route("POST", "/api/levels/:id/comments", async (req, res, params) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    if (u.banned) return bad(res, "account banned", 403);
    const l = db.levels[params.id];
    if (!l || l.hidden) return bad(res, "not found", 404);
    const body = await readBody(req);
    const text = (body.text || "").toString().trim().slice(0, 280);
    // A comment may be plain text, a stamp (sello), a hand-drawn memo, or a
    // combination - but not empty. The memo is a small PNG (320x120) the player
    // draws with freehand strokes + freely-placed stamps.
    const stamp = (body.stamp || "").toString().slice(0, 64) || null;
    const cid = id();
    let memo = false;
    if (body.memo && saveDataUrlImage(body.memo, path.join(COMMENT_DIR, cid + ".png"))) memo = true;
    if (!text && !stamp && !memo) return bad(res, "text, stamp or memo required");
    db.comments[cid] = { id: cid, levelId: l.id, userId: u.id, userName: u.name,
                         text, stamp, memo, createdAt: now(), hidden: false };
    saveDb();
    ok(res, { id: cid });
});

// --- native (FishBowl / Miiverse-DataStore bridge) ---
// These back the game's NATIVE community UI. Level data is kept as opaque
// binary blobs (base64): the Miiverse post appData and the DataStore metaBinary
// are stored verbatim and served back, so the game does its own encode/decode.

function writeB64(file, b64) {
    fs.writeFileSync(file, Buffer.from(b64 || "", "base64"));
}
function readB64(file) {
    try { return fs.readFileSync(file).toString("base64"); } catch (e) { return null; }
}

route("POST", "/api/native/levels", async (req, res) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    if (u.banned) return bad(res, "account banned", 403);
    const b = await readBody(req);
    if (!b.postID || !b.appData) return bad(res, "postID and appData required");
    const lid = b.postID;
    if (b.appData) writeB64(path.join(UPLOAD_DIR, lid + ".appdata"), b.appData);
    if (b.screenshot) writeB64(path.join(UPLOAD_DIR, lid + ".thumb.png"), b.screenshot);
    // The initial-comment drawing (a small PNG) shown when the level has no body text.
    let hasMemo = false;
    if (b.memo && saveDataUrlImage(b.memo, path.join(UPLOAD_DIR, lid + ".memo.png"))) hasMemo = true;
    db.levels[lid] = {
        id: lid, native: true, memo: hasMemo,
        title: (b.title || b.body || "Nivel").toString().slice(0, 64),
        body: (b.body || "").toString().slice(0, 280),
        authorId: u.id, authorName: u.name,
        communityType: b.communityType || 0,
        primaryID: b.primaryID || "", secondaryID: b.secondaryID || "",
        createdAt: now(), starredBy: [], downloads: 0, hidden: false,
        thumbnail: !!b.screenshot,
    };
    saveDb();
    ok(res, { id: lid });
});

route("PUT", "/api/native/datastore/:dataID", async (req, res, params) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    const b = await readBody(req);
    if (!b.metaBinary) return bad(res, "metaBinary required");
    writeB64(path.join(UPLOAD_DIR, "ds-" + params.dataID + ".bin"), b.metaBinary);
    // Attach parsed map params to the owning level (matched by primary data id).
    if (b.params) {
        const lvl = Object.values(db.levels).find((l) => l.primaryID === params.dataID);
        if (lvl) {
            lvl.params = b.params;
            // The real level name lives in the map (params.name); the post body
            // is the comment. Use the level name as the level's display title.
            if (b.params.name) lvl.title = String(b.params.name).slice(0, 64);
            saveDb();
        }
    }
    ok(res, { ok: true });
});

route("GET", "/api/native/datastore/:dataID", async (req, res, params) => {
    const b64 = readB64(path.join(UPLOAD_DIR, "ds-" + params.dataID + ".bin"));
    if (b64 == null) return bad(res, "not found", 404);
    ok(res, { dataID: params.dataID, metaBinary: b64 });
});

route("GET", "/api/native/levels", async (req, res, params, query) => {
    const u = userByToken(req);
    let list = Object.values(db.levels).filter((l) => l.native && !l.hidden);
    if (query.community !== undefined) list = list.filter((l) => String(l.communityType) === String(query.community));
    list.sort((a, b) => b.createdAt - a.createdAt);
    const out = list.slice(0, 100).map((l) => ({
        id: l.id, title: l.title, body: l.body, authorId: l.authorId, authorName: l.authorName,
        communityType: l.communityType, primaryID: l.primaryID, secondaryID: l.secondaryID,
        createdAt: l.createdAt, stars: (l.starredBy || []).length, downloads: l.downloads || 0,
        starred: !!(u && (l.starredBy || []).indexOf(u.id) !== -1),
        authorAvatar: (db.users[l.authorId] && db.users[l.authorId].avatar) ? "/avatars/" + l.authorId + ".png" : null,
        tips: l.tips || 0, tipped: !!(u && (l.tippedBy || []).indexOf(u.id) !== -1),
        mine: !!(u && l.authorId === u.id), official: !!l.official, params: l.params || null,
        memo: l.memo ? "/levels/" + l.id + ".memo.png" : null,
        appData: readB64(path.join(UPLOAD_DIR, l.id + ".appdata")),
        screenshot: l.thumbnail ? readB64(path.join(UPLOAD_DIR, l.id + ".thumb.png")) : null,
    }));
    ok(res, { total: out.length, levels: out });
});

// Current counts for a single native level (used to refresh the self/workshop
// view so creators see the mola/stars other players gave them).
route("GET", "/api/native/levels/:id", async (req, res, params) => {
    const l = db.levels[params.id];
    if (!l || l.hidden) return bad(res, "not found", 404);
    ok(res, { id: l.id, stars: (l.starredBy || []).length, tips: l.tips || 0,
              downloads: l.downloads || 0,
              comments: Object.values(db.comments).filter((c) => c.levelId === l.id && !c.hidden).length });
});

// Gift stars (tips) to a level's creator. One tip per user per level.
route("POST", "/api/native/levels/:id/tip", async (req, res, params) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    const l = db.levels[params.id];
    if (!l || l.hidden) return bad(res, "not found", 404);
    const body = await readBody(req);
    const amount = Math.max(1, Math.min(99, parseInt(body.amount, 10) || 1));
    l.tippedBy = l.tippedBy || [];
    if (l.tippedBy.indexOf(u.id) === -1) { l.tippedBy.push(u.id); l.tips = (l.tips || 0) + amount; }
    saveDb();
    ok(res, { tips: l.tips, tipped: true });
});

// Withdraw (delete) your own native post + its level data.
route("DELETE", "/api/native/levels/:id", async (req, res, params) => {
    const u = userByToken(req);
    if (!u) return bad(res, "auth required", 401);
    const l = db.levels[params.id];
    if (!l) return bad(res, "not found", 404);
    if (l.authorId !== u.id) return bad(res, "not your level", 403);
    for (const dsid of [l.primaryID, l.secondaryID]) {
        if (dsid) { try { fs.unlinkSync(path.join(UPLOAD_DIR, "ds-" + dsid + ".bin")); } catch (e) {} }
    }
    for (const ext of [".appdata", ".thumb.png", ".memo.png"]) { try { fs.unlinkSync(path.join(UPLOAD_DIR, l.id + ext)); } catch (e) {} }
    for (const cid of Object.keys(db.comments)) if (db.comments[cid].levelId === l.id) delete db.comments[cid];
    delete db.levels[params.id];
    saveDb();
    ok(res, { ok: true });
});

// --- admin ---
function requireAdmin(req, res) {
    if (!isAdmin(req)) { bad(res, "admin auth required", 401); return false; }
    return true;
}

// --- cascade-delete helpers (do not saveDb; caller saves once) ---
function removeCommentFiles(c) {
    try { fs.unlinkSync(path.join(COMMENT_DIR, c.id + ".png")); } catch (e) {}
}
function deleteCommentCascade(id) {
    const c = db.comments[id]; if (!c) return false;
    removeCommentFiles(c);
    delete db.comments[id];
    return true;
}
function removeLevelFiles(l) {
    for (const dsid of [l.primaryID, l.secondaryID]) {
        if (dsid) { try { fs.unlinkSync(path.join(UPLOAD_DIR, "ds-" + dsid + ".bin")); } catch (e) {} }
    }
    for (const ext of [".appdata", ".thumb.png", ".memo.png", ".json"]) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, l.id + ext)); } catch (e) {}
    }
}
function deleteLevelCascade(id) {
    const l = db.levels[id]; if (!l) return false;
    removeLevelFiles(l);
    for (const cid of Object.keys(db.comments)) {
        if (db.comments[cid].levelId === id) deleteCommentCascade(cid);
    }
    delete db.levels[id];
    return true;
}
function deleteUserCascade(id) {
    if (!db.users[id]) return false;
    // their levels (and the comments on those levels)
    for (const lid of Object.keys(db.levels)) {
        if (db.levels[lid].authorId === id) deleteLevelCascade(lid);
    }
    // their own comments anywhere
    for (const cid of Object.keys(db.comments)) {
        if (db.comments[cid].userId === id) deleteCommentCascade(cid);
    }
    delete db.users[id];
    return true;
}
route("GET", "/api/admin/overview", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    ok(res, {
        users: Object.values(db.users).map(publicUser),
        levels: Object.values(db.levels).sort((a, b) => b.createdAt - a.createdAt).map((l) => publicLevel(l, false)),
        comments: Object.values(db.comments).sort((a, b) => b.createdAt - a.createdAt)
            .map((c) => ({ id: c.id, levelId: c.levelId, userId: c.userId, userName: c.userName,
                           text: c.text, createdAt: c.createdAt, hidden: !!c.hidden,
                           stamp: c.stamp || null, memo: c.memo ? "/comments/" + c.id + ".png" : null,
                           userAvatar: (db.users[c.userId] && db.users[c.userId].avatar) ? "/avatars/" + c.userId + ".png" : null,
                           levelTitle: (db.levels[c.levelId] && db.levels[c.levelId].title) || c.levelId })),
    });
});
route("POST", "/api/admin/levels/:id/hide", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const l = db.levels[params.id]; if (!l) return bad(res, "not found", 404);
    const body = await readBody(req); l.hidden = body.hidden !== false; saveDb(); ok(res, publicLevel(l, false));
});
route("DELETE", "/api/admin/levels/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    if (!deleteLevelCascade(params.id)) return bad(res, "not found", 404);
    saveDb(); ok(res, { ok: true });
});
// Batch delete levels (each cascades to its comments).
route("POST", "/api/admin/levels/delete", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    let n = 0; for (const id of ids) if (deleteLevelCascade(id)) n++;
    saveDb(); ok(res, { ok: true, deleted: n });
});
// Mark a level official (Nintendo) or not. Official levels move to the Nintendo
// community and read as the official platform type in-game.
route("POST", "/api/admin/levels/:id/official", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const l = db.levels[params.id]; if (!l) return bad(res, "not found", 404);
    const body = await readBody(req);
    l.official = body.official !== false;
    l.communityType = l.official ? 1 : 0;
    saveDb(); ok(res, { id: l.id, official: l.official, communityType: l.communityType });
});
// Full level detail for the admin panel: metadata + captured map params +
// comments (including stamp/drawing memos).
route("GET", "/api/admin/levels/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const l = db.levels[params.id]; if (!l) return bad(res, "not found", 404);
    const comments = Object.values(db.comments).filter((c) => c.levelId === l.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((c) => ({ id: c.id, userName: c.userName, text: c.text, createdAt: c.createdAt, hidden: !!c.hidden,
                       stamp: c.stamp || null, memo: c.memo ? "/comments/" + c.id + ".png" : null }));
    ok(res, {
        id: l.id, title: l.title, body: l.body, authorId: l.authorId, authorName: l.authorName,
        communityType: l.communityType, official: !!l.official, native: !!l.native,
        createdAt: l.createdAt, hidden: !!l.hidden,
        stars: (l.starredBy || []).length, tips: l.tips || 0, downloads: l.downloads || 0,
        primaryID: l.primaryID, secondaryID: l.secondaryID,
        params: l.params || null,
        thumbnail: l.thumbnail ? "/levels/" + l.id + ".thumb.png" : null,
        comments
    });
});
// Manual level download: a self-contained JSON bundle (base64 payloads).
route("GET", "/api/admin/levels/:id/download", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const l = db.levels[params.id]; if (!l) return bad(res, "not found", 404);
    const bundle = {
        format: "mvdk-level/1", id: l.id, title: l.title, authorName: l.authorName,
        communityType: l.communityType, official: !!l.official, params: l.params || null,
        primaryID: l.primaryID, secondaryID: l.secondaryID,
        appData: readB64(path.join(UPLOAD_DIR, l.id + ".appdata")),
        thumbnail: l.thumbnail ? readB64(path.join(UPLOAD_DIR, l.id + ".thumb.png")) : null,
        metaBinaryPrimary: l.primaryID ? readB64(path.join(UPLOAD_DIR, "ds-" + l.primaryID + ".bin")) : null,
        metaBinarySecondary: l.secondaryID ? readB64(path.join(UPLOAD_DIR, "ds-" + l.secondaryID + ".bin")) : null,
    };
    res.writeHead(200, { "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="' + l.id + '.mvdklevel.json"',
        "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(bundle, null, 2));
});
route("POST", "/api/admin/comments/:id/hide", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const c = db.comments[params.id]; if (!c) return bad(res, "not found", 404);
    const body = await readBody(req); c.hidden = body.hidden !== false; saveDb(); ok(res, { ok: true });
});
route("DELETE", "/api/admin/comments/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    if (!deleteCommentCascade(params.id)) return bad(res, "not found", 404);
    saveDb(); ok(res, { ok: true });
});
route("POST", "/api/admin/comments/delete", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    let n = 0; for (const id of ids) if (deleteCommentCascade(id)) n++;
    saveDb(); ok(res, { ok: true, deleted: n });
});
route("POST", "/api/admin/users/:id/ban", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    const u = db.users[params.id]; if (!u) return bad(res, "not found", 404);
    const body = await readBody(req); u.banned = body.banned !== false; saveDb(); ok(res, publicUser(u));
});
route("DELETE", "/api/admin/users/:id", async (req, res, params) => {
    if (!requireAdmin(req, res)) return;
    if (!deleteUserCascade(params.id)) return bad(res, "not found", 404);
    saveDb(); ok(res, { ok: true });
});
route("POST", "/api/admin/users/delete", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    let n = 0; for (const id of ids) if (deleteUserCascade(id)) n++;
    saveDb(); ok(res, { ok: true, deleted: n });
});

// ------------------------------------------------------------ static files ---

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json",
    ".svg": "image/svg+xml", ".jpg": "image/jpeg" };

function serveFile(res, file) {
    fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
        send(res, 200, data, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    });
}

// ----------------------------------------------------------------- server ----

const server = http.createServer(async (req, res) => {
    try {
        const u = new URL(req.url, "http://localhost");
        const pathname = u.pathname;

        if (req.method === "OPTIONS") return send(res, 204, "");

        // API routes
        for (const r of routes) {
            if (r.method !== req.method) continue;
            const m = r.rx.exec(pathname);
            if (!m) continue;
            const params = {};
            r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
            const query = Object.fromEntries(u.searchParams.entries());
            return await r.handler(req, res, params, query);
        }

        // uploaded avatars / level thumbnails
        if (pathname.startsWith("/avatars/")) return serveFile(res, path.join(AVATAR_DIR, path.basename(pathname)));
        if (pathname.startsWith("/levels/")) return serveFile(res, path.join(UPLOAD_DIR, path.basename(pathname)));
        if (pathname.startsWith("/comments/")) return serveFile(res, path.join(COMMENT_DIR, path.basename(pathname)));

        // admin panel + static
        if (pathname === "/" || pathname === "/admin") return serveFile(res, path.join(PUBLIC_DIR, "admin", "index.html"));
        if (pathname.startsWith("/admin/")) return serveFile(res, path.join(PUBLIC_DIR, "admin", path.basename(pathname)));

        send(res, 404, { error: "not found" });
    } catch (e) {
        send(res, e.message === "payload too large" ? 413 : 500, { error: e.message });
    }
});

server.listen(PORT, HOST, () => {
    console.log("=================================================");
    console.log(" " + SERVER_NAME + "  v" + VERSION);
    console.log(" Listening on http://" + (HOST === "0.0.0.0" ? "localhost" : HOST) + ":" + PORT);
    console.log(" Admin panel:  http://localhost:" + PORT + "/admin");
    console.log(" Admin token:  " + ADMIN_TOKEN);
    console.log("=================================================");
});
