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

    // Posts / comments: empty for now (native shows the "no levels" state).
    mv.getPostList = function () { fire(mv, "downloadPostSuccess", { posts: [] }); };
    mv.getCommentList = function () { fire(mv, "downloadCommentSuccess", { comments: [] }); };

    // ---- DataStore (NEX) service ----
    var ds = nwf.nex.DataStore.getInstance();
    ds.isLoggedIn = true;
    ds.isBound = true;
    if (typeof ds.login === "function") {
        var origLogin = ds.login.bind(ds);
        ds.login = function () { ds.isLoggedIn = true; fire(ds, "loginSuccess"); return 0; };
    }
    // The base stub fails search; make it succeed empty so the community opens.
    ds.search = function () { fire(ds, "searchSuccess", { result: [], data: [] }); };
    ds.searchData = function () { fire(ds, "searchDataSuccess", { result: [], data: [] }); };

    log("native community bridge installed (step 1: communities + empty posts)");
}(window));
