/*
 * Mario vs Donkey Kong: Tipping Stars - Chromium port SoundPlayer fix v3
 *
 * Load this from index.html as a Chromium-port script, before scripts/bootstrap.js.
 * It waits until lib.sound.SoundPlayer exists, then patches SoundPlayer.prototype
 * at runtime. The original game files stay untouched.
 *
 * Fixes Chromium/browser audio races:
 *  1) async <audio> load/error events can arrive after unloadMusic() has
 *     cancelled or nulled the corresponding musicObjects[musicName];
 *  2) audio.src = null is converted by Chromium into a real "/null" request;
 *  3) SFX may be triggered while a decoded AudioBuffer is still missing, which
 *     makes the original code crash at audioNode.buffer.duration.
 */
(function () {
    'use strict';

    var PATCH_NAME = '[chromium-port] SoundPlayer audio race/null-src/SFX-buffer fix v3';
    var attempts = 0;
    var maxAttempts = 20000;
    var pollMs = 1;

    function safeCallback(callback) {
        if (typeof callback === 'function') {
            callback();
        }
    }

    function detachAudio(audio, onLoad, onError) {
        if (!audio) {
            return;
        }

        try {
            audio.removeEventListener('canplaythrough', onLoad);
            audio.removeEventListener('error', onError);
        } catch (err) {
        }
    }

    function stopAndClearAudio(audio) {
        if (!audio) {
            return;
        }

        try {
            if (typeof audio.pause === 'function') {
                audio.pause();
            }
        } catch (err) {
        }

        try {
            if (typeof audio.removeAttribute === 'function') {
                audio.removeAttribute('src');
            }
            audio.src = '';
        } catch (err2) {
            try {
                audio.src = '';
            } catch (err3) {
            }
        }

        try {
            if (typeof audio.load === 'function') {
                audio.load();
            }
        } catch (err4) {
        }
    }

    function buildMusicUrl(player, info) {
        var filename = info.filename;
        var url;

        if (typeof player.resolveMusicFilename === 'function') {
            filename = player.resolveMusicFilename(filename);
        }

        url = player.wavFolderPath + filename;

        if (typeof player._withAudioVersion === 'function') {
            url = player._withAudioVersion(url);
        }

        return url;
    }

    function isUsableAudioBuffer(buffer) {
        return buffer !== null && buffer !== undefined &&
            typeof buffer.duration === 'number' && isFinite(buffer.duration) &&
            buffer.duration >= 0;
    }

    function makeSilentSfxBuffer(player) {
        var ctx = player && player.audContext;
        var sampleRate;
        var frames;

        if (!ctx || typeof ctx.createBuffer !== 'function') {
            return null;
        }

        sampleRate = ctx.sampleRate || 44100;
        frames = Math.max(1, Math.floor(sampleRate / 30));

        try {
            return ctx.createBuffer(1, frames, sampleRate);
        } catch (err) {
            return null;
        }
    }

    function getSilentSfxBuffer(player) {
        if (!player.__chromiumAudioRaceFixSilentSfxBuffer ||
                !isUsableAudioBuffer(player.__chromiumAudioRaceFixSilentSfxBuffer)) {
            player.__chromiumAudioRaceFixSilentSfxBuffer = makeSilentSfxBuffer(player);
        }
        return player.__chromiumAudioRaceFixSilentSfxBuffer;
    }

    function ensureSfxInfoHasBuffer(player, wavName) {
        var infoList = player && player.infoListFileObject;
        var info = infoList && infoList[wavName];
        var fallback;

        if (info === null || info === undefined) {
            return null;
        }

        if (!isUsableAudioBuffer(info.buffer)) {
            fallback = getSilentSfxBuffer(player);
            if (fallback) {
                info.buffer = fallback;
                if (!player.__chromiumAudioRaceFixWarnedMissingSfxBuffer) {
                    player.__chromiumAudioRaceFixWarnedMissingSfxBuffer = true;
                    console.warn('[chromium-port] SFX triggered before its decoded buffer was available; using a silent fallback instead of crashing.');
                }
            }
        }

        return info;
    }

    function applyPatch() {
        var sound = window.lib && window.lib.sound;
        var proto;
        var originalLoadMusic;
        var originalUnloadMusic;
        var originalPlaySfxWav;
        var originalUpdateSfxData;

        attempts++;

        if (!sound || !sound.SoundPlayer || !sound.SoundPlayer.prototype ||
                !sound.MusicData || !sound.MusicLoadState || !sound.MusicState) {
            if (attempts < maxAttempts) {
                window.setTimeout(applyPatch, pollMs);
            }
            return;
        }

        proto = sound.SoundPlayer.prototype;

        if (proto.__chromiumAudioRaceFixV3Applied) {
            return;
        }

        originalLoadMusic = proto.__chromiumAudioRaceFixOriginalLoadMusic || proto.loadMusic;
        originalUnloadMusic = proto.__chromiumAudioRaceFixOriginalUnloadMusic || proto.unloadMusic;
        originalPlaySfxWav = proto.__chromiumAudioRaceFixOriginalPlaySfxWav || proto.playSfxWav;
        originalUpdateSfxData = proto.__chromiumAudioRaceFixOriginalUpdateSfxData || proto.updateSfxData;

        proto.__chromiumAudioRaceFixV2Applied = true;
        proto.__chromiumAudioRaceFixV3Applied = true;
        proto.__chromiumAudioRaceFixOriginalLoadMusic = originalLoadMusic;
        proto.__chromiumAudioRaceFixOriginalUnloadMusic = originalUnloadMusic;
        proto.__chromiumAudioRaceFixOriginalPlaySfxWav = originalPlaySfxWav;
        proto.__chromiumAudioRaceFixOriginalUpdateSfxData = originalUpdateSfxData;

        proto.loadMusic = function (musicName, manualLoaded, loadEndedCallback) {
            var audio;
            var that = this;
            var info = this.streamFileObject && this.streamFileObject[musicName];
            var url;
            var musicObject;

            if (info === null || info === undefined) {
                console.log('ERROR!!  Music info was not found for ' + musicName + '.  Please check your casing!');
                return;
            }

            if (this.musicObjects[musicName] === null || this.musicObjects[musicName] === undefined) {
                this.musicObjects[musicName] = new sound.MusicData();
            }

            musicObject = this.musicObjects[musicName];

            if (musicObject.loadState === sound.MusicLoadState.LOAD_STARTED ||
                    musicObject.loadState === sound.MusicLoadState.LOAD_FINISHED) {
                return;
            }

            if (sound.CREATE_ALL_AUDIO_TAGS === true) {
                if (musicObject.audioElement === null || musicObject.audioElement === undefined) {
                    musicObject.audioElement = new Audio();
                }
                audio = musicObject.audioElement;
            } else {
                audio = new Audio();
            }

            url = buildMusicUrl(this, info);

            function onLoad() {
                var currentMusicObject = that.musicObjects[musicName];

                detachAudio(audio, onLoad, onError);

                if (currentMusicObject !== null && currentMusicObject !== undefined &&
                        currentMusicObject.loadState !== sound.MusicLoadState.LOAD_CANCELLED &&
                        currentMusicObject.audioElement === audio) {
                    currentMusicObject.loadState = sound.MusicLoadState.LOAD_FINISHED;
                    safeCallback(loadEndedCallback);
                }
            }

            function onError(err) {
                var currentMusicObject = that.musicObjects[musicName];

                console.log('ERROR!  COULD NOT LOAD MUSIC FILE: ' + musicName);

                detachAudio(audio, onLoad, onError);
                stopAndClearAudio(audio);

                if (currentMusicObject !== null && currentMusicObject !== undefined &&
                        currentMusicObject.audioElement === audio &&
                        currentMusicObject.loadState !== sound.MusicLoadState.LOAD_CANCELLED) {
                    if (sound.CREATE_ALL_AUDIO_TAGS === false) {
                        currentMusicObject.audioElement = null;
                    }
                    currentMusicObject.loadState = sound.MusicLoadState.LOAD_ERROR;
                    safeCallback(loadEndedCallback);
                }
            }

            musicObject.loadState = sound.MusicLoadState.LOAD_STARTED;
            musicObject.manualLoaded = manualLoaded;
            musicObject.audioElement = audio;

            audio.preload = 'auto';
            audio.autoplay = false;
            audio.controls = false;

            audio.addEventListener('canplaythrough', onLoad);
            audio.addEventListener('error', onError);

            console.log('Loading ' + url);

            audio.src = url;
            audio.load();
        };

        proto.unloadMusic = function (musicName, force) {
            var musicObject;
            var audio;

            force = (force == null) ? false : force;
            musicObject = this.musicObjects[musicName];

            if (musicObject === null || musicObject === undefined) {
                return;
            }

            if (force === false &&
                    musicObject.musicState === sound.MusicState.PLAYING &&
                    musicObject.loadState === sound.MusicLoadState.LOAD_FINISHED) {
                musicObject.loadState = sound.MusicLoadState.UNLOAD;
                return;
            }

            if (musicObject.loadState === sound.MusicLoadState.LOAD_STARTED) {
                console.log('Unload Before Load Finished!');
                musicObject.loadState = sound.MusicLoadState.LOAD_CANCELLED;
            } else {
                musicObject.loadState = sound.MusicLoadState.NOT_LOADED;
            }

            audio = musicObject.audioElement;

            if (audio !== null && audio !== undefined) {
                console.log('Unloading ' + musicName);
                musicObject.musicState = sound.MusicState.NOT_STARTED;
                stopAndClearAudio(audio);

                if (sound.CREATE_ALL_AUDIO_TAGS === false) {
                    musicObject.audioElement = null;
                    this.musicObjects[musicName] = null;
                }
            }
        };

        proto.playSfxWav = function (wavName, pitch, loop) {
            var info;
            var nodes;
            var fallback;

            info = ensureSfxInfoHasBuffer(this, wavName);
            nodes = originalPlaySfxWav.apply(this, arguments);

            if (nodes && nodes.data && nodes.data.sourceNode &&
                    !isUsableAudioBuffer(nodes.data.sourceNode.buffer)) {
                fallback = (info && isUsableAudioBuffer(info.buffer)) ? info.buffer : getSilentSfxBuffer(this);
                if (fallback) {
                    nodes.data.sourceNode.buffer = fallback;
                }
            }

            return nodes;
        };

        if (typeof originalUpdateSfxData === 'function') {
            proto.updateSfxData = function () {
                try {
                    return originalUpdateSfxData.apply(this, arguments);
                } catch (err) {
                    var message = err && err.message ? String(err.message) : '';
                    if (message.indexOf("reading 'duration'") !== -1 ||
                            message.indexOf('reading "duration"') !== -1 ||
                            message.indexOf('buffer.duration') !== -1) {
                        if (!this.__chromiumAudioRaceFixWarnedDurationCrash) {
                            this.__chromiumAudioRaceFixWarnedDurationCrash = true;
                            console.warn('[chromium-port] Suppressed a transient SFX buffer duration race in SoundPlayer.updateSfxData.', err);
                        }
                        return;
                    }
                    throw err;
                }
            };
        }

        if (window.console && typeof window.console.log === 'function') {
            window.console.log(PATCH_NAME + ' applied');
        }
    }

    // Last-resort guard for an old callback or SFX tick that may already have
    // been queued before the prototype patch was installed.
    window.addEventListener('error', function (evt) {
        var message = evt && evt.message ? String(evt.message) : '';
        var file = evt && evt.filename ? String(evt.filename) : '';

        if (file.indexOf('scripts/lib/sound/SoundPlayer.js') !== -1 &&
                (message.indexOf("Cannot read properties of null (reading 'audioElement')") !== -1 ||
                 message.indexOf("Cannot read properties of null (reading 'duration')") !== -1 ||
                 message.indexOf("Cannot read properties of undefined (reading 'duration')") !== -1)) {
            if (typeof evt.preventDefault === 'function') {
                evt.preventDefault();
            }
            return true;
        }

        return false;
    }, true);

    applyPatch();
}());
