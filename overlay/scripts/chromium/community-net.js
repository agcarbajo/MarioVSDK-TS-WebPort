/*
 * Mario vs Donkey Kong: Tipping Stars - native community <-> backend bridge.
 *
 * The game's native online layer (the FishBowl community + level publishing) was
 * built on Wii U Miiverse (nwf.mv) + NEX DataStore (nwf.nex). The nwf shim stubs
 * those with empty data, which is why the native community said "Community not
 * found on Miiverse".
 *
 * This bridge re-implements those nwf services on top of the custom community
 * backend (see the mvdk-community-server repo), so the REAL native UI works:
 *   - it provides the two communities the game expects (User / Nintendo levels),
 *   - it serves posts (levels), comments, stars (empathy) from the server,
 *   - and it sends uploads/comments/stars back to the server.
 *
 * Level payloads are kept as opaque binary blobs: whatever the game serializes
 * on upload is stored verbatim and handed back on download, so we don't need to
 * reproduce the game's binary map format here.
 *
 * Step 1 (this commit): make the native community OPEN — real communities and an
 * (initially empty) post list, plus DataStore login/search succeeding — so the
 * native FishBowl loads its "no levels yet" state instead of erroring. Posts,
 * upload, comments and stars are layered on next.
 */
(function (global) {
    "use strict";

    if (global.__chromiumPortCommunityNetInstalled) return;
    var nwf = global.nwf;
    if (!nwf || !nwf.mv || !nwf.nex) return;
    global.__chromiumPortCommunityNetInstalled = true;

    var USER_LEVELS_TYPE = 1;       // ugc.MIIVERSE_USER_LEVELS_COMMUNITY_TYPE
    var NINTENDO_LEVELS_TYPE = 2;   // ugc.MIIVERSE_NINTENDO_LEVELS_COMMUNITY_TYPE
    var COMMUNITY_TYPE_CODE = "MVMI";

    function log(m) { try { console.log("[community-net] " + m); } catch (e) {} }

    function communityAppData(typeByte) {
        var bytes = new Uint8Array(5);
        for (var i = 0; i < 4; ++i) bytes[i] = COMMUNITY_TYPE_CODE.charCodeAt(i);
        bytes[4] = typeByte;
        return new Blob([bytes]);
    }

    function fire(service, type, extra) {
        global.setTimeout(function () {
            try {
                service.dispatchEvent(type, Object.assign({ errorCode: 0, result: [], data: [], posts: [], comments: [], communities: [], users: [] }, extra || {}));
            } catch (e) { log("dispatch failed: " + e.message); }
        }, 0);
    }

    // ---- Miiverse service ----
    var mv = nwf.mv.Miiverse.getInstance();

    mv.getCommunityList = function () {
        log("getCommunityList -> providing User/Nintendo communities");
        fire(mv, "downloadCommunitySuccess", {
            communities: [
                { appData: communityAppData(USER_LEVELS_TYPE), communityID: "user-levels", title: "User Levels" },
                { appData: communityAppData(NINTENDO_LEVELS_TYPE), communityID: "nintendo-levels", title: "Nintendo Levels" }
            ]
        });
    };

    mv.downloadUserData = function () { fire(mv, "downloadUserDataListSuccess", { users: [] }); };

    // Posts: served from the backend so they appear in the native FishBowl.
    mv.getPostList = function () {
        if (!ready()) { fire(mv, "downloadPostSuccess", { posts: [] }); return; }
        rest().nativeListPosts(0).then(function (r) {
            var posts = (r.levels || []).map(buildRawPost);
            log("getPostList -> " + posts.length + " post(s) from server");
            fire(mv, "downloadPostSuccess", { posts: posts });
        }).catch(function (e) {
            log("getPostList failed: " + e.message);
            fire(mv, "downloadPostSuccess", { posts: [] });
        });
    };
    // Comments: served from the backend keyed by the post (level) id.
    mv.getCommentList = function (commentSearchParam) {
        var postID = commentSearchParam && commentSearchParam.postID;
        if (!postID || !ready()) { fire(mv, "downloadCommentSuccess", { comments: [] }); return; }
        rest().getComments(postID).then(function (r) {
            var comments = (r.comments || []).map(buildRawComment);
            log("getCommentList -> " + comments.length + " comment(s)");
            fire(mv, "downloadCommentSuccess", { comments: comments });
        }).catch(function (e) {
            log("getCommentList failed: " + e.message);
            fire(mv, "downloadCommentSuccess", { comments: [] });
        });
    };

    // Posting a comment: the body text is what we persist; the appData is kept
    // opaque (we don't need it server-side for plain comments).
    mv.sendComment = function (uploadComment) {
        var postID = uploadComment && uploadComment.postID;
        var body = (uploadComment && uploadComment.body) || "";
        var stamp = (uploadComment && uploadComment.stamp) || "";
        var memo = (uploadComment && uploadComment.memo) || "";
        var done = function () { fire(mv, "uploadCommentSuccess", { uploadResult: {} }); };
        if (postID && (body || stamp || memo) && ready()) {
            rest().addComment(postID, body, stamp, memo).then(function () { log("comment posted to " + postID); done(); },
                                                              function (e) { log("comment post failed: " + e.message); done(); });
        } else { done(); }
    };
    mv.uploadComment = mv.sendComment;

    // Empathy (the in-game "stars"/likes) maps to the backend star toggle.
    mv.addEmpathy = function (postID) {
        if (postID && ready()) {
            rest().starLevel(postID).then(function () { log("empathy added: " + postID); }, function (e) { log("addEmpathy failed: " + e.message); });
        }
        fire(mv, "addEmpathySuccess", { postID: postID });
    };
    mv.removeEmpathy = function (postID) {
        if (postID && ready()) {
            rest().starLevel(postID).then(function () { log("empathy removed: " + postID); }, function (e) { log("removeEmpathy failed: " + e.message); });
        }
        fire(mv, "removeEmpathySuccess", { postID: postID });
    };

    function b64ToBlob(b64) {
        if (!b64) return new Blob([]);
        var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
        for (var i = 0; i < len; ++i) arr[i] = bin.charCodeAt(i);
        return new Blob([arr]);
    }
    function numHash(s) {
        var h = 0; s = String(s || "");
        for (var i = 0; i < s.length; ++i) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h || 1;
    }
    function getMii() { try { return nwf.act.Mii.getMyMii(); } catch (e) { return null; } }

    function serverBase() {
        try { return (global.ChromiumPortCommunity.getProfile().server || "").replace(/\/+$/, ""); } catch (e) { return ""; }
    }
    function avatarFullUrl(rel) {
        if (!rel) return "";
        if (/^(https?:|data:)/.test(rel)) return rel;
        return serverBase() + rel;
    }
    function drawCover(ctx, img, w, h) {
        var ir = img.width / img.height, cr = w / h, sw, sh, sx, sy;
        if (ir > cr) { sh = img.height; sw = sh * cr; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / cr; sx = 0; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    }
    // A Mii stand-in that paints the account's custom profile photo into the
    // slot the Wii U would have rendered the Mii face. Falls back to drawing
    // nothing (transparent) when no avatar was chosen.
    function makeAvatarMii(name, avatarUrl) {
        return {
            name: name || "Player",
            renderIcon: function (canvas, cb, options) {
                var done = function () { try { if (cb) cb(); } catch (e) {} };
                try {
                    var ctx = canvas && canvas.getContext && canvas.getContext("2d");
                    if (!ctx) { done(); return; }
                    var drawDefault = function () {
                        try { ctx.clearRect(0, 0, canvas.width, canvas.height); if (global.__chromiumDrawDefaultAvatar) global.__chromiumDrawDefaultAvatar(ctx, canvas.width, canvas.height); } catch (e) {}
                    };
                    if (!avatarUrl) { drawDefault(); done(); return; }
                    var img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = function () {
                        try { ctx.clearRect(0, 0, canvas.width, canvas.height); drawCover(ctx, img, canvas.width, canvas.height); } catch (e) {}
                        done();
                    };
                    img.onerror = function () { drawDefault(); done(); };
                    img.src = avatarUrl;
                } catch (e) { done(); }
            },
            setExpression: function () {},
            serialize: function () { return new ArrayBuffer(96); },
            getImage: function () { return null; }
        };
    }
    function stampImageUrl(stamp) {
        // Stamp ids ("d<i>"/"u<i>") resolve to the game's real stamp images via
        // the shared stamp resolver (decoded from the stamp GTX atlas).
        if (!stamp) return "";
        if (/^(https?:|data:)/.test(stamp)) return stamp;
        try { return global.ChromiumPortStamps.getImageUrl(stamp) || ""; } catch (e) { return ""; }
    }
    function buildRawPost(l) {
        return {
            id: l.id,
            appData: b64ToBlob(l.appData),
            miiName: l.authorName || "Player",
            mii: makeAvatarMii(l.authorName, avatarFullUrl(l.authorAvatar)),
            miiExpression: 0,
            posterID: numHash(l.authorId),
            regionID: 0,
            dateCreated: new Date(l.createdAt || Date.now()),
            replyCount: 0,
            empathyCount: l.stars || 0,
            empathyAdded: !!l.starred,
            // 3 = official (Nintendo) so the game treats it accordingly; 1 = user.
            platformType: l.official ? 3 : 1,
            hasBodyText: !!l.body,
            body: l.body || "",
            hasMemo: false,
            renderMemo: function () {},
            thumbnailSnapshot: l.screenshot ? b64ToBlob(l.screenshot) : null,
            tested: true,
            shared: true
        };
    }
    function buildRawComment(c) {
        // Preferred: a hand-drawn memo (320x120) that already composes freehand
        // strokes + freely-placed stamps -> draw it filling the memo canvas.
        // Legacy: a single stamp -> draw it small and centred (never full-bleed).
        var memoUrl = c.memo ? avatarFullUrl(c.memo) : "";
        var stampUrl = (!memoUrl && c.stamp) ? stampImageUrl(c.stamp) : "";
        var hasMemo = !!(memoUrl || stampUrl);
        return {
            id: c.id,
            appData: null,
            miiName: c.userName || "Player",
            mii: makeAvatarMii(c.userName, avatarFullUrl(c.userAvatar)),
            miiExpression: 0,
            posterID: numHash(c.userId),
            regionID: 0,
            dateCreated: new Date(c.createdAt || Date.now()),
            hasBodyText: !!c.text,
            body: c.text || "",
            hasMemo: hasMemo,
            renderMemo: function (target) {
                if (!hasMemo) return;
                try {
                    var ctx = (target && target.getContext) ? target.getContext("2d") : (target && target.drawImage ? target : null);
                    if (!ctx) return;
                    var cw = (ctx.canvas && ctx.canvas.width) || 320, ch = (ctx.canvas && ctx.canvas.height) || 120;
                    var img = new Image(); img.crossOrigin = "anonymous";
                    img.onload = function () {
                        try {
                            ctx.clearRect(0, 0, cw, ch);
                            if (memoUrl) { ctx.drawImage(img, 0, 0, cw, ch); }
                            else { var s = Math.min(ch, cw) * 0.7; ctx.drawImage(img, (cw - s) / 2, (ch - s) / 2, s, s); }
                        } catch (e) {}
                    };
                    img.src = memoUrl || stampUrl;
                } catch (e) {}
            },
            isSpoiler: false,
            platformType: 0
        };
    }
    function fetchDataStore(dataID) {
        return rest().nativeGetDatastore(dataID).then(function (r) {
            return { dataID: dataID, metaBinary: b64ToBlob(r.metaBinary) };
        }).catch(function () { return null; });
    }

    // Parse the level's map params from a metaBinary blob (DataStoreLevelInfo
    // header + map binary) so the server/admin can show level details. Returns a
    // Promise resolving to params or null (never rejects).
    function parseLevelParams(metaBinary) {
        return new Promise(function (resolve) {
            if (!metaBinary || !metaBinary.arrayBuffer) { resolve(null); return; }
            metaBinary.arrayBuffer().then(function (ab) {
                try {
                    var reader = new lib.util.DataReader(ab);
                    reader.moveOffset(pt.ugc.DATASTORE_LEVEL_INFO_SIZE);
                    var conv = new pt.map.MapBinaryConverter();
                    // toMapDef reads the leading checksum itself; do NOT call
                    // validateChecksum first or the reader is left misaligned and
                    // toMapDef returns null (no params/name captured).
                    var mapDef = conv.toMapDef(reader);
                    if (!mapDef || !mapDef.header) { resolve(null); return; }
                    var doors = (mapDef.entities || []).filter(function (e) { return e && e.type === "Door"; }).length;
                    var multi = false;
                    try { multi = !!pt.map.checkIsMultiDoorLevel(mapDef); } catch (e) {}
                    resolve({
                        name: mapDef.header.name || "",
                        width: mapDef.header.width || 0,
                        height: mapDef.header.height || 0,
                        theme: (mapDef.settings && mapDef.settings.theme) || "",
                        goalScore: (mapDef.settings && mapDef.settings.goalScore) || 0,
                        doors: doors,
                        multiDoor: multi
                    });
                } catch (e) { resolve(null); }
            }, function () { resolve(null); });
        });
    }

    function communityIdToType(communityID) {
        // MiiverseCommunityType enum: UserLevels=0, NintendoLevels=1
        return communityID === "nintendo-levels" ? 1 : 0;
    }

    function blobToB64(blob) {
        return new Promise(function (resolve) {
            if (!blob) { resolve(""); return; }
            if (blob instanceof ArrayBuffer) blob = new Blob([blob]);
            try {
                var fr = new FileReader();
                fr.onload = function () { var s = String(fr.result || ""); var i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : ""); };
                fr.onerror = function () { resolve(""); };
                fr.readAsDataURL(blob);
            } catch (e) { resolve(""); }
        });
    }

    function ready() { return global.ChromiumPortCommunity && global.ChromiumPortCommunity.isReady(); }
    function rest() { return global.ChromiumPortCommunity.rest; }

    // ---- Native level publishing: capture the game's upload and store it ----
    var pendingDataIDs = [];
    var dsSeq = 0, postSeq = 0;

    // Miiverse "send post": carries the post appData (encodes the DataStore IDs),
    // body, screenshot and community. Store the post; the level binary follows
    // via DataStore updateData below.
    mv.sendPost = function (uploadPost) {
        var postID = "post-" + (++postSeq) + "-" + Date.now();
        var dataIDs = pendingDataIDs.slice();
        pendingDataIDs = [];
        Promise.all([
            blobToB64(uploadPost && uploadPost.appData),
            blobToB64(uploadPost && uploadPost.screenshot)
        ]).then(function (r) {
            var done = function () { fire(mv, "uploadPostSuccess", { postID: postID, uploadResult: {} }); };
            if (ready()) {
                rest().nativeCreatePost({
                    postID: postID,
                    title: (uploadPost && uploadPost.body) || "Nivel",
                    body: (uploadPost && uploadPost.body) || "",
                    communityType: communityIdToType(uploadPost && uploadPost.communityID),
                    appData: r[0], screenshot: r[1],
                    primaryID: dataIDs[0] || "", secondaryID: dataIDs[1] || ""
                }).then(function () { log("level uploaded to server: " + postID); done(); },
                         function (e) { log("native post upload failed: " + e.message); done(); });
            } else { done(); }
        });
        return 0;
    };
    mv.uploadPost = mv.sendPost;

    // Withdraw a published level. The backend DELETE removes the post, its
    // appData/thumbnail and the DataStore object(s) in one call, so deletePost
    // does the work and the DataStore deleteData calls just succeed.
    mv.deletePost = function (postID) {
        var done = function () { fire(mv, "deletePostSuccess", { postID: postID }); };
        if (postID && ready()) {
            rest().nativeDeletePost(postID).then(function () { log("post withdrawn: " + postID); done(); },
                                                 function (e) { log("withdraw failed: " + e.message); done(); });
        } else { done(); }
    };

    // ---- DataStore (NEX) service ----
    var ds = nwf.nex.DataStore.getInstance();
    ds.isLoggedIn = true;
    ds.isBound = true;
    ds.login = function () { ds.isLoggedIn = true; fire(ds, "loginSuccess"); return 0; };
    ds.bind = function () { ds.isBound = true; return true; };

    ds.uploadData = function () {
        // DataStore IDs are encoded as U64 hex strings inside the post appData,
        // so use an uppercase hex id (<= 8 digits, no leading zeros) that
        // round-trips exactly through writeU64/readU64.
        var dataID = (1 + Math.floor(Math.random() * 0xFFFFFFFE)).toString(16).toUpperCase();
        pendingDataIDs.push(dataID);
        fire(ds, "uploadDataSuccess", { dataID: dataID });
        return 0;
    };
    ds.completeSuspendedData = function () { fire(ds, "completeSuspendedObjectSuccess"); return 0; };
    // The level's DataStore object is removed by the backend post-delete, so
    // this just reports success to satisfy the native withdraw flow.
    ds.deleteData = function (dataID) { fire(ds, "deleteDataSuccess", { dataID: dataID }); return 0; };
    ds.updateData = function (dataID, updateObject) {
        var metaBinary = updateObject && updateObject.metaBinary;
        Promise.all([blobToB64(metaBinary), parseLevelParams(metaBinary)]).then(function (r) {
            var b64 = r[0], params = r[1];
            var done = function () { fire(ds, "updateDataSuccess", { dataID: dataID }); };
            if (b64 && ready()) {
                rest().nativePutDatastore(dataID, b64, params).then(done, function (e) { log("datastore put failed: " + e.message); done(); });
            } else { done(); }
        });
        return 0;
    };
    // Level data is fetched from the backend by data id (extracted by the game
    // from each post's appData).
    ds.dataSearch = function () { fire(ds, "searchSuccess", { results: [], data: [] }); return 0; };
    ds.search = function () { fire(ds, "searchSuccess", { results: [], data: [] }); return 0; };
    ds.downloadData = function (dataID) {
        fetchDataStore(dataID).then(function (obj) { fire(ds, "downloadDataSuccess", { data: obj }); });
        return 0;
    };
    ds.downloadBatchData = function (dataIDs) {
        var ids = [].concat(dataIDs || []);
        Promise.all(ids.map(fetchDataStore)).then(function (objs) {
            fire(ds, "downloadBatchDataSuccess", { batchResults: objs.filter(Boolean) });
        });
        return 0;
    };

    // Exposed so the native UI (e.g. FishBowlGlobal own-profile setup) can build
    // the same avatar-backed Mii stand-in for the local player.
    global.ChromiumPortCommunityNet = {
        makeAvatarMii: makeAvatarMii,
        avatarFullUrl: avatarFullUrl
    };

    log("native community bridge installed (communities + native upload -> server)");
}(window));
