(function (global) {
    "use strict";

    var STORAGE_KEY = "chromiumPortUnlockAllLevels";
    var applied = false;
    var autoApplyStarted = false;

    function isEnabled() {
        try {
            return global.localStorage && global.localStorage.getItem(STORAGE_KEY) === "1";
        } catch (err) {
            return false;
        }
    }

    function setEnabled(enabled) {
        try {
            if (!global.localStorage) return;
            if (enabled) {
                global.localStorage.setItem(STORAGE_KEY, "1");
            } else {
                global.localStorage.removeItem(STORAGE_KEY);
            }
        } catch (err) {}
    }

    function isFullyUnlocked() {
        if (!storageReady()) return false;

        var progress = pt.storage.get("solo.progress");
        var goldMedal = (pt.Medals && typeof pt.Medals.Gold === "number") ? pt.Medals.Gold : 2;
        var worldCount = Math.min(pt.MAX_WORLD_COUNT_PLUS_BONUS || 11, progress ? progress.length : 0);
        var levelCount = pt.MAX_LEVEL_PER_WORLD_COUNT || 8;
        var world;
        var level;

        if (!progress || !worldCount) return false;

        for (world = 0; world < worldCount; ++world) {
            if (!progress[world]) continue;
            for (level = 0; level < Math.min(levelCount, progress[world].length); ++level) {
                if (!progress[world][level]) continue;
                if (progress[world][level].locked || progress[world][level].trophy !== goldMedal) {
                    return false;
                }
            }
        }
        return true;
    }

    function resetProgress() {
        setEnabled(false);
        applied = false;
        if (global.ChromiumPortSaveFS && ChromiumPortSaveFS.clearProfile) {
            return ChromiumPortSaveFS.clearProfile();
        }
        return Promise.resolve();
    }

    function storageReady() {
        return global.pt && pt.storage && pt.storage.isReady && pt.storage.get && pt.storage.saveAllProgress;
    }

    function mapDefsReady() {
        return global.pt &&
            pt.asset &&
            pt.asset.assetDefLoader &&
            pt.asset.assetDefLoader.areAssetDefFilesLoaded &&
            pt.asset.assetDefLoader.areAssetDefFilesLoaded();
    }

    function unlockProgress() {
        if (!storageReady() || !mapDefsReady()) return false;

        var mapWorldCount = pt.asset.assetDefLoader.getWorldCount ? pt.asset.assetDefLoader.getWorldCount() : 0;
        var worldCount = Math.min(pt.MAX_WORLD_COUNT_PLUS_BONUS || 11, mapWorldCount || 11);
        var levelCount = pt.MAX_LEVEL_PER_WORLD_COUNT || 8;
        var goldMedal = (pt.Medals && typeof pt.Medals.Gold === "number") ? pt.Medals.Gold : 2;
        var fullClearScore = 99999;
        var progress = pt.storage.get("solo.progress");
        var unlocks = pt.storage.getSoloUnlocks ? pt.storage.getSoloUnlocks() : pt.storage.get("solo.unlocks");
        var current = pt.storage.getSoloCurrent ? pt.storage.getSoloCurrent() : pt.storage.get("solo.currentLevel");
        var bonusCurrent = pt.storage.getBonusCurrent ? pt.storage.getBonusCurrent() : pt.storage.get("solo.bonusCurrent");
        var cutscenes = pt.storage.get("solo.cutscenes");
        var totalLevels = 0;
        var world;
        var level;

        if (!progress) return false;

        for (world = 0; world < worldCount; ++world) {
            if (!progress[world]) continue;
            var mapLevelCount = pt.asset.assetDefLoader.getLevelCount ? pt.asset.assetDefLoader.getLevelCount(world) : levelCount;
            for (level = 0; level < Math.min(levelCount, mapLevelCount); ++level) {
                if (progress[world][level]) {
                    progress[world][level].locked = false;
                    progress[world][level].trophy = goldMedal;
                    progress[world][level].highscore = Math.max(progress[world][level].highscore || 0, fullClearScore);
                    totalLevels += 1;
                }
            }
        }

        if (unlocks) {
            unlocks.totalGoldTrophies = Math.max(unlocks.totalGoldTrophies || 0, totalLevels);
            unlocks.totalLevelsPlayed = Math.max(unlocks.totalLevelsPlayed || 0, totalLevels);
            unlocks.unlockBonusLevelsDialogShow = false;
            unlocks.mainGameCompleteDialogShow = true;
            unlocks.expertLevelsCompleteDialogShow = true;
            unlocks.allGoldTrophiesDialogShow = true;
        }

        if (cutscenes) {
            cutscenes.intro = true;
            cutscenes.ending = true;
            cutscenes.mainGameComplete = true;
            cutscenes.expertLevelsComplete = true;
        }

        if (current) {
            current.world = 0;
            current.level = 0;
        }
        if (bonusCurrent) {
            bonusCurrent.world = 0;
            bonusCurrent.level = 0;
        }

        unlockStampsAndStars();

        pt.storage.saveAllProgress();
        applied = true;
        return true;
    }

    function unlockStampsAndStars() {
        if (!global.pt || !pt.storage) return;

        // Unlock every collectible stamp (the stamp gallery counter goes to N/N).
        try {
            if (pt.storage.getStampUnlockedStatus) {
                var stamps = pt.storage.getStampUnlockedStatus();
                var stampCount = (global.pt.stamp && pt.stamp.UNLOCKABLE_STAMP_COUNT) || 72;
                if (stamps) {
                    var limit = Math.min(stampCount, stamps.length);
                    for (var s = 0; s < limit; ++s) {
                        stamps[s] = true;
                    }
                }
            }
        } catch (err) {}

        // Fill the star counter to the maximum value it can hold.
        try {
            if (pt.storage.setStarbucks) {
                var maxStars = (typeof pt.storage.MAX_STARBUCKS === "number") ? pt.storage.MAX_STARBUCKS : 99999;
                pt.storage.setStarbucks(maxStars);
            }
        } catch (err) {}
    }

    function installBonusLockGuard() {
        if (!global.pt || !pt.storage || !pt.storage.lockBonusLevel || pt.storage.__chromiumPortUnlockGuard) return;

        var originalLockBonusLevel = pt.storage.lockBonusLevel;
        pt.storage.lockBonusLevel = function (world, level, lock) {
            if (isEnabled() && lock) {
                lock = false;
            }
            return originalLockBonusLevel.call(this, world, level, lock);
        };
        pt.storage.__chromiumPortUnlockGuard = true;
    }

    function startAutoApply() {
        if (autoApplyStarted) return;
        autoApplyStarted = true;
        global.setInterval(function () {
            installBonusLockGuard();
            if (isEnabled() && !applied && storageReady()) {
                unlockProgress();
            }
        }, 250);
    }

    global.ChromiumPortDebugUnlock = {
        isEnabled: isEnabled,
        isFullyUnlocked: isFullyUnlocked,
        unlockProgress: unlockProgress,
        resetProgress: resetProgress,
        setEnabled: setEnabled,
        storageReady: storageReady,
        mapDefsReady: mapDefsReady,
        installBonusLockGuard: installBonusLockGuard
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startAutoApply);
    } else {
        startAutoApply();
    }
})(window);
