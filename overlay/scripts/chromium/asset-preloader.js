(function (global) {
    "use strict";

    var groups = {};
    var cutsceneDefPromise = null;
    var manifestPromise = null;
    var rawAssetCache = {};
    var mediaAssetCache = {};
    var currentTitleToken = 0;

    function log(message) {
        console.info('[asset-preloader] ' + message);
    }

    function idle(callback) {
        if (global.requestIdleCallback) {
            return global.requestIdleCallback(function () {
                callback();
            }, { timeout: 1500 });
        }
        return global.setTimeout(callback, 120);
    }

    function cancelGroup(name) {
        var group = groups[name];
        if (!group) {
            return;
        }
        group.token++;
        group.queue.length = 0;
        if (group.abort) {
            group.abort.abort();
            group.abort = null;
        }
        if (group.media) {
            group.media.forEach(function (el) {
                try {
                    el.pause();
                    el.removeAttribute('src');
                    el.load();
                } catch (ex) {}
            });
            group.media.length = 0;
        }
        group.running = false;
    }

    function resetGroup(name) {
        cancelGroup(name);
        getGroup(name);
    }

    function getGroup(name) {
        if (!groups[name]) {
            groups[name] = { token: 0, queue: [], running: false, abort: null, media: [] };
        }
        return groups[name];
    }

    function schedule(groupName, task, front) {
        var group = getGroup(groupName);
        if (front) {
            group.queue.unshift(task);
        } else {
            group.queue.push(task);
        }
        pump(groupName);
    }

    function pump(groupName) {
        var group = getGroup(groupName);
        if (group.running || group.queue.length === 0) {
            return;
        }
        group.running = true;
        var task = group.queue.shift();
        var token = group.token;
        idle(function () {
            if (token !== group.token) {
                group.running = false;
                pump(groupName);
                return;
            }
            var result;
            try {
                result = task(group, token);
            } catch (ex) {
                console.warn('[asset-preloader] background task failed', ex);
            }
            Promise.resolve(result).catch(function (ex) {
                if (!ex || ex.name !== 'AbortError') {
                    console.warn('[asset-preloader] background task failed', ex);
                }
            }).then(function () {
                if (token === group.token) {
                    group.running = false;
                    pump(groupName);
                }
            });
        });
    }

    function versioned(url) {
        var version = global.__chromiumPortVersion || '';
        return url + (version ? (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(version) : '');
    }

    function fetchAsset(groupName, url, front) {
        if (!url || rawAssetCache[url]) {
            return;
        }
        rawAssetCache[url] = true;
        schedule(groupName, function (group) {
            group.abort = new AbortController();
            return fetch(versioned(url), {
                cache: 'force-cache',
                signal: group.abort.signal
            }).then(function () {
                group.abort = null;
            }).catch(function (ex) {
                if (ex && ex.name === 'AbortError') {
                    rawAssetCache[url] = false;
                }
                throw ex;
            });
        }, front);
    }

    function preloadMedia(groupName, url, front) {
        if (!url || mediaAssetCache[url]) {
            return;
        }
        mediaAssetCache[url] = true;
        schedule(groupName, function (group, token) {
            var video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            video.style.display = 'none';
            group.media.push(video);
            document.body.appendChild(video);
            return new Promise(function (resolve) {
                var done = false;
                function finish() {
                    if (done) {
                        return;
                    }
                    done = true;
                    video.removeEventListener('canplaythrough', finish);
                    video.removeEventListener('loadeddata', finish);
                    video.removeEventListener('error', finish);
                    resolve();
                }
                video.addEventListener('canplaythrough', finish);
                video.addEventListener('loadeddata', finish);
                video.addEventListener('error', finish);
                video.src = versioned(url);
                video.load();
                global.setTimeout(finish, 3000);
            }).then(function () {
                if (token !== group.token) {
                    return;
                }
            });
        }, front);
    }

    function manifest() {
        if (!manifestPromise) {
            manifestPromise = fetch(versioned('converted/gtx-manifest.json'), { cache: 'force-cache' }).then(function (res) {
                return res.ok ? res.json() : {};
            }).catch(function () {
                return {};
            });
        }
        return manifestPromise;
    }

    function cutsceneDefs() {
        if (!cutsceneDefPromise) {
            cutsceneDefPromise = fetch(versioned('json/video/cutscenedef.json'), { cache: 'force-cache' }).then(function (res) {
                return res.json();
            });
        }
        return cutsceneDefPromise;
    }

    function localizedImageUrl(spec) {
        if (!spec || spec.indexOf('img!') !== 0) {
            return null;
        }
        var locale = '';
        try {
            locale = lib.locale.LocaleManager.getSystemLocale();
        } catch (ex) {
            locale = 'en_US';
        }
        return spec.substr(4).replace('[[LOCALE]]', locale);
    }

    function cutsceneForLevel(world, level) {
        if (level !== 0) {
            return null;
        }
        if (world === 0) return 'intro_1-1';
        if (world === 1) return 'intro_2-1';
        if (world === 2) return 'intro_3-1';
        if (world === 3) return 'intro_4-1';
        if (world === 4) return 'intro_5-1';
        if (world === 5) return 'intro_6-1';
        if (world === 6) return 'intro_x-1';
        return null;
    }

    function hasCutscenePlayed(sceneKey) {
        var cutScenesPlayed = null;
        try {
            cutScenesPlayed = pt.storage && pt.storage.get ? pt.storage.get('solo.cutscenes') : null;
        } catch (ex) {
        }
        return !!(cutScenesPlayed && cutScenesPlayed[sceneKey]);
    }

    function preloadCutscene(sceneKey, groupName, front) {
        groupName = groupName || 'cutscene';
        resetGroup(groupName);
        schedule(groupName, function (group, token) {
            return cutsceneDefs().then(function (defs) {
                if (token !== group.token || !defs.cutscenes || !defs.cutscenes[sceneKey]) {
                    return;
                }
                var script = defs.cutscenes[sceneKey];
                if (script.video && script.video.url) {
                    log('preload cutscene video: ' + sceneKey + ' -> ' + script.video.url);
                    preloadMedia(groupName, script.video.url, front);
                }
                if (script.images) {
                    script.images.forEach(function (imgSpec) {
                        var url = localizedImageUrl(imgSpec);
                        if (url) {
                            fetchAsset(groupName, url, front);
                        }
                    });
                }
                if (script.music && global.lib && lib.sound && lib.sound.SoundPlayer && lib.sound.SoundPlayer.instance) {
                    schedule(groupName, function () {
                        lib.sound.SoundPlayer.instance.loadMusic(script.music, false, function () {});
                    });
                }
            });
        });
    }

    function preloadLayout(layoutName, directory) {
        schedule('layout', function () {
            if (global.lib && lib.layout && lib.layout.layoutDataSetCache) {
                var layoutDirectory = Array.isArray(directory) ? directory[0] : directory;
                lib.layout.layoutDataSetCache.preloadData(layoutName, layoutName, layoutDirectory, null, function () {});
            }
        });
    }

    function preloadStamps() {
        schedule('ugc', function () {
            if (global.pt && pt.asset && pt.asset.preloadStampData) {
                pt.asset.preloadStampData('stamps');
            }
        });
    }

    function preloadWorkshopAssets() {
        preloadStamps();
        schedule('ugc', function () {
            if (global.pt && pt.asset && pt.asset.preloadAllThemeData && pt.asset.assetDefLoader && pt.asset.assetDefLoader.areAssetDefFilesLoaded()) {
                pt.asset.preloadAllThemeData();
            }
        });
    }

    function ensureMap(world, level, urgent) {
        if (!global.pt || !pt.asset || !pt.asset.assetDefLoader || !pt.asset.assetDefLoader.ensureMapDef) {
            return;
        }
        if (urgent) {
            cancelGroup('maps');
        }
        schedule(urgent ? 'maps-urgent' : 'maps', function () {
            return new Promise(function (resolve) {
                var existing = pt.asset.assetDefLoader.ensureMapDef(world, level, resolve, !!urgent);
                if (existing) {
                    resolve(existing);
                }
            });
        });
    }

    function preloadMusic(musicName, groupName) {
        if (!musicName || !global.lib || !lib.sound || !lib.sound.SoundPlayer || !lib.sound.SoundPlayer.instance) {
            return;
        }
        schedule(groupName || 'audio', function () {
            lib.sound.SoundPlayer.instance.loadMusic(musicName, false, function () {});
        });
    }

    function preloadThemeForMap(mapDef) {
        if (!mapDef || !global.pt || !pt.asset || !pt.asset.assetDefLoader) {
            return;
        }
        schedule('theme', function () {
            var mapAssets = pt.asset.assetDefLoader.getMapAssets();
            var themeDef = mapAssets && mapAssets.getThemeTypeDef ? mapAssets.getThemeTypeDef(mapDef.settings.theme) : null;
            if (themeDef) {
                pt.asset.preloadThemeData(themeDef);
            }
            if (mapDef.settings && mapDef.settings.background && global.lib && lib.layout && lib.layout.layoutDataSetCache) {
                lib.layout.layoutDataSetCache.preloadData(mapDef.settings.background, mapDef.settings.background, 'backgroundData/', null, function () {});
            }
            if (mapDef.musicDef) {
                preloadMusic(mapDef.musicDef.intro, 'audio');
                preloadMusic(mapDef.musicDef.level, 'audio');
            }
        });
    }

    function preloadLevel(world, level, urgent) {
        if (!global.pt || !pt.asset || !pt.asset.assetDefLoader) {
            return;
        }
        if (urgent) {
            cancelGroup('maps');
        }
        var loader = pt.asset.assetDefLoader;
        var mapDef = loader.getMapDef && loader.getMapDef(world, level);
        if (mapDef) {
            preloadThemeForMap(mapDef);
            return;
        }
        schedule(urgent ? 'maps-urgent' : 'maps', function () {
            return new Promise(function (resolve) {
                var existing = loader.ensureMapDef(world, level, function (loadedMapDef) {
                    preloadThemeForMap(loadedMapDef);
                    resolve(loadedMapDef);
                }, !!urgent);
                if (existing) {
                    preloadThemeForMap(existing);
                    resolve(existing);
                }
            });
        });
    }

    function lastUnlockedSoloLevel() {
        var progress = pt.storage && pt.storage.get ? pt.storage.get('solo.progress') : null;
        var best = { world: 0, level: 0 };
        if (!progress) {
            return best;
        }
        for (var w = 0; w < progress.length && w < 8; w++) {
            for (var l = 0; progress[w] && l < progress[w].length; l++) {
                if (!progress[w][l].locked) {
                    best.world = w;
                    best.level = l;
                }
            }
        }
        return best;
    }

    function nextSoloLevel(world, level) {
        if (!pt.asset || !pt.asset.assetDefLoader) {
            return null;
        }
        var w = world;
        var l = level + 1;
        if (l >= pt.asset.assetDefLoader.getLevelCount(w)) {
            w++;
            l = 0;
        }
        if (w >= Math.min(8, pt.asset.assetDefLoader.getWorldCount())) {
            return null;
        }
        return { world: w, level: l };
    }

    function preloadLevelNeighborhood(world, level, includeNeighbors) {
        preloadLevel(world, level, false);
        var next = nextSoloLevel(world, level);
        if (next) {
            preloadLevel(next.world, next.level, false);
        }
        if (includeNeighbors) {
            if (level > 0) {
                preloadLevel(world, level - 1, false);
            }
            if (level + 1 < 8) {
                preloadLevel(world, level + 1, false);
            }
            if (world > 0) {
                preloadLevel(world - 1, 0, false);
            }
            if (world < 6) {
                preloadLevel(world + 1, 0, false);
            }
        }
    }

    function preloadGtxBundleImages(bundlePath, groupName, maxImages, preferredIndexes) {
        schedule(groupName, function (group, token) {
            return manifest().then(function (data) {
                var item = data[bundlePath];
                if (!item || !item.images) {
                    return;
                }
                var queued = {};
                var count = 0;
                function queueIndex(index, front) {
                    if (token !== group.token || index < 0 || index >= item.images.length || queued[index]) {
                        return;
                    }
                    queued[index] = true;
                    count++;
                    fetchAsset(groupName, item.images[index], front);
                }
                if (preferredIndexes) {
                    for (var i = 0; i < preferredIndexes.length; i++) {
                        queueIndex(preferredIndexes[i], true);
                    }
                }
                for (var j = 0; j < item.images.length && (!maxImages || count < maxImages); j++) {
                    queueIndex(j, false);
                }
            });
        });
    }

    function soloSnapIndex(world, level, big) {
        var base = world * 8 + level;
        return big ? (base + 64) : base;
    }

    function preloadSoloSnaps(world, level, mode) {
        var groupName = mode === 'bonus' ? 'bonusselect-assets' : 'levelselect-assets';
        var indexes = [];
        var offset = mode === 'bonus' ? 8 : 0;
        var w = Math.max(0, world || 0) + offset;
        var l = Math.max(0, level || 0);
        indexes.push(soloSnapIndex(w, l, false));
        indexes.push(soloSnapIndex(w, l, true));
        if (l + 1 < 8) {
            indexes.push(soloSnapIndex(w, l + 1, false));
            indexes.push(soloSnapIndex(w, l + 1, true));
        }
        preloadGtxBundleImages('layoutData/soloSnapsGP.gtx.gz', groupName, mode === 'bonus' ? 24 : 40, indexes);
    }

    function onStartupMapsReady() {
        log('startup map preloads deferred until title/menu intent');
    }

    function onTitleIdle() {
        var token = ++currentTitleToken;
        var level = lastUnlockedSoloLevel();

        log('title idle: preloading intro movie in background');
        preloadCutscene('intro_movie', 'title-cutscene', false);

        global.setTimeout(function () {
            if (token !== currentTitleToken) {
                return;
            }
            log('title idle: warming likely play/bonus selector assets');
            preloadLayout('main_levelselect', 'layoutData/');
            preloadLayout('bonus_levelselect', 'layoutData/');
            preloadLevelNeighborhood(level.world, level.level, false);
            preloadSoloSnaps(level.world, level.level, 'solo');
            preloadSoloSnaps(0, 0, 'bonus');
        }, 1100);
    }

    function onTitleChoice(viewName) {
        currentTitleToken++;
        cancelGroup('cutscene');
        if (viewName === 'level_select') {
            var level = lastUnlockedSoloLevel();
            cancelGroup('bonusselect-assets');
            log('title choice: prioritizing level select assets');
            preloadCutscene('intro_movie', 'cutscene', true);
            preloadLevelNeighborhood(level.world, level.level, true);
            preloadSoloSnaps(level.world, level.level, 'solo');
            preloadLayout('main_levelselect', 'layoutData/');
        } else if (viewName === 'bonus_select') {
            cancelGroup('levelselect-assets');
            cancelGroup('maps');
            log('title choice: prioritizing bonus select assets');
            preloadSoloSnaps(0, 0, 'bonus');
            preloadLayout('bonus_levelselect', 'layoutData/');
        } else {
            log('title choice: canceling play/bonus preloads for ' + viewName);
            cancelGroup('title-cutscene');
            cancelGroup('levelselect-assets');
            cancelGroup('bonusselect-assets');
            cancelGroup('maps');
        }
    }

    function onLevelSelectIdle(world, level) {
        preloadLevelNeighborhood(world, level, true);
        preloadSoloSnaps(world, level, 'solo');
        var sceneKey = cutsceneForLevel(world, level);
        if (sceneKey && !hasCutscenePlayed(sceneKey)) {
            preloadCutscene(sceneKey, 'cutscene', true);
        } else {
            cancelGroup('cutscene');
        }
    }

    function onGameplayIdle(world, level) {
        cancelGroup('cutscene');
        var next = nextSoloLevel(world, level);
        if (next) {
            preloadLevel(next.world, next.level, false);
        }
        if (world >= 0 && level >= 0) {
            preloadSoloSnaps(world, level, 'solo');
        }
    }

    global.ChromiumPortAssetPreloader = {
        cancelGroup: cancelGroup,
        ensureMap: ensureMap,
        onStartupMapsReady: onStartupMapsReady,
        preloadCutscene: preloadCutscene,
        preloadLayout: preloadLayout,
        preloadLevel: preloadLevel,
        preloadLevelNeighborhood: preloadLevelNeighborhood,
        preloadSoloSnaps: preloadSoloSnaps,
        preloadStamps: preloadStamps,
        preloadWorkshopAssets: preloadWorkshopAssets,
        onTitleChoice: onTitleChoice,
        onTitleIdle: onTitleIdle,
        onLevelSelectIdle: onLevelSelectIdle,
        onGameplayIdle: onGameplayIdle
    };
})(window);
