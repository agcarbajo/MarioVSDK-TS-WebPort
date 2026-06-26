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
    mv.getCommentList = function () { fire(mv, "downloadCommentSuccess", { comments: [] }); };

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
    function buildRawPost(l) {
        return {
            id: l.id,
            appData: b64ToBlob(l.appData),
            miiName: l.authorName || "Player",
            mii: getMii(),
            miiExpression: 0,
            posterID: numHash(l.authorId),
            regionID: 0,
            dateCreated: new Date(l.createdAt || Date.now()),
            replyCount: 0,
            empathyCount: l.stars || 0,
            empathyAdded: false,
            hasBodyText: !!l.body,
            body: l.body || "",
            hasMemo: false,
            renderMemo: function () {},
            thumbnailSnapshot: l.screenshot ? b64ToBlob(l.screenshot) : null,
            platformType: 0,
            tested: true,
            shared: true
        };
    }
    function fetchDataStore(dataID) {
        return rest().nativeGetDatastore(dataID).then(function (r) {
            return { dataID: dataID, metaBinary: b64ToBlob(r.metaBinary) };
        }).catch(function () { return null; });
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
    ds.updateData = function (dataID, updateObject) {
        blobToB64(updateObject && updateObject.metaBinary).then(function (b64) {
            var done = function () { fire(ds, "updateDataSuccess", { dataID: dataID }); };
            if (b64 && ready()) {
                rest().nativePutDatastore(dataID, b64).then(done, function (e) { log("datastore put failed: " + e.message); done(); });
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

    log("native community bridge installed (communities + native upload -> server)");
}(window));
