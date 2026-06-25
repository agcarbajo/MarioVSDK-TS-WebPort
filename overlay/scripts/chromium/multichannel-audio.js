/*
 * Mario vs Donkey Kong: Tipping Stars - Chromium port multichannel audio.
 *
 * The level-select music is a single 14-channel (7 stereo pairs, one per world)
 * track. The original Wii U asset is `level_select_full.ogg`, but a 14-channel
 * Vorbis file has an undefined channel layout and Chromium's decodeAudioData
 * rejects it once you go past ~10 channels (this is why it failed in Electron's
 * bundled Chromium, while system Edge happened to accept it).
 *
 * So instead of decoding one 14-channel file, this shim loads the seven stereo
 * per-world files (`level_select_world_1.ogg` .. `level_select_world_7.ogg`,
 * produced at build time) and plays them in sync, one per world. The smooth
 * cross-fade between worlds is reproduced by ramping each world's gain from the
 * game's per-channel volumes (channelVolume[2*i] / [2*i+1] drive world i+1).
 * Stereo Vorbis decodes everywhere, so this works in Electron and in browsers.
 */
(function (global) {
    'use strict';

    var NativeAudio = global.Audio;
    var AudioContextCtor = global.AudioContext || global.webkitAudioContext;

    if (!NativeAudio || !AudioContextCtor || global.__chromiumPortMultiChannelAudioInstalled) {
        return;
    }

    global.__chromiumPortMultiChannelAudioInstalled = true;

    var NUM_WORLDS = 7;          // 7 stereo per-world tracks = 14 logical channels
    var START_LEAD = 0.06;       // schedule all sources to begin together

    function isLevelSelectAudio(src) {
        return typeof src === 'string' && src.toLowerCase().indexOf('level_select_full.ogg') !== -1;
    }

    function worldTrackSrc(src, world) {
        return String(src).replace(/level_select_full\.ogg/i, 'level_select_world_' + world + '.ogg');
    }

    function getAudioContext() {
        if (!global.__chromiumPortMultiChannelAudioContext) {
            global.__chromiumPortMultiChannelAudioContext = new AudioContextCtor();
        }
        return global.__chromiumPortMultiChannelAudioContext;
    }

    function clamp01(value) {
        value = Number(value);
        if (!isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }

    function MultiChannelAudio(src) {
        this.__chromiumPortMultiChannelAudio = true;
        this.src = src || '';
        this.preload = 'auto';
        this.autoplay = false;
        this.controls = false;
        this.loop = false;
        this.volume = 1.0;
        this.baseMusicVolume = 1.0;
        this.tvVolume = 1.0;
        this.gamepadVolume = 1.0;
        this.channelVolume = new Array(16);
        this.currentSrc = this.src;

        this._ctx = null;
        this._buffers = null;        // Array(NUM_WORLDS) of AudioBuffer | null
        this._duration = 0;
        this._sources = [];
        this._gains = [];
        this._masterGain = null;
        this._listeners = {};
        this._loadingPromise = null;
        this._queuedPlay = false;
        this._loadToken = 0;
        this._stopped = false;
        this._playing = false;
        this._pauseTime = 0;
        this._startTime = 0;
        this._ended = false;

        for (var index = 0; index < this.channelVolume.length; ++index) {
            this.channelVolume[index] = index < 2 ? 1.0 : 0.0;
        }
    }

    Object.defineProperty(MultiChannelAudio.prototype, 'paused', {
        get: function () { return !this._playing; }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'ended', {
        get: function () { return this._ended; }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'duration', {
        get: function () { return this._duration > 0 ? this._duration : NaN; }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'readyState', {
        get: function () { return this._buffers ? 4 : 0; }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'currentTime', {
        get: function () {
            if (!this._buffers || !this._playing || !this._ctx) {
                return this._pauseTime || 0;
            }
            var elapsed = this._ctx.currentTime - this._startTime;
            if (elapsed < 0) {
                elapsed = 0;
            }
            if (this.loop && this._duration > 0) {
                return elapsed % this._duration;
            }
            return this._duration > 0 ? Math.min(elapsed, this._duration) : elapsed;
        },
        set: function (value) {
            var wasPlaying = this._playing;
            value = Math.max(0, Number(value) || 0);
            if (this._duration > 0) {
                value = this.loop ? value % this._duration : Math.min(value, this._duration);
            }
            this._pauseTime = value;
            if (wasPlaying) {
                this.pause();
                this.play();
            }
        }
    });

    MultiChannelAudio.prototype.addEventListener = function (type, listener) {
        if (!type || typeof listener !== 'function') {
            return;
        }
        if (!this._listeners[type]) {
            this._listeners[type] = [];
        }
        if (this._listeners[type].indexOf(listener) === -1) {
            this._listeners[type].push(listener);
        }
    };

    MultiChannelAudio.prototype.removeEventListener = function (type, listener) {
        var listeners = this._listeners[type];
        var index;
        if (!listeners) {
            return;
        }
        index = listeners.indexOf(listener);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    };

    MultiChannelAudio.prototype._dispatch = function (type) {
        var listeners = (this._listeners[type] || []).slice();
        var event = { type: type, target: this, currentTarget: this };
        var handler = this['on' + type];
        var index;

        for (index = 0; index < listeners.length; ++index) {
            try {
                listeners[index].call(this, event);
            } catch (err) {
                setTimeout(function () { throw err; }, 0);
            }
        }
        if (typeof handler === 'function') {
            handler.call(this, event);
        }
    };

    MultiChannelAudio.prototype.load = function () {
        var self = this;
        var requestSrc = this.src;
        var loadToken;
        var ctx;
        var world;
        var tasks;

        if (!requestSrc) {
            return;
        }
        if (this._buffers && this.currentSrc === requestSrc) {
            this._dispatch('canplaythrough');
            if (this._queuedPlay || this.autoplay) {
                this.play();
            }
            return;
        }
        if (this._loadingPromise && this.currentSrc === requestSrc) {
            return;
        }

        loadToken = ++this._loadToken;
        this.currentSrc = requestSrc;
        this._ended = false;
        this._stopped = false;
        this._pauseTime = 0;

        ctx = getAudioContext();
        this._ctx = ctx;

        tasks = [];
        for (world = 1; world <= NUM_WORLDS; ++world) {
            tasks.push((function (trackSrc) {
                return fetch(trackSrc)
                    .then(function (response) {
                        if (!response.ok) {
                            throw new Error('HTTP ' + response.status + ' while loading ' + trackSrc);
                        }
                        return response.arrayBuffer();
                    })
                    .then(function (arrayBuffer) {
                        return ctx.decodeAudioData(arrayBuffer.slice(0));
                    })
                    .catch(function (err) {
                        console.warn('[chromium-port] No se pudo cargar pista de mundo:', err);
                        return null;
                    });
            })(worldTrackSrc(requestSrc, world)));
        }

        this._loadingPromise = Promise.all(tasks).then(function (buffers) {
            if (loadToken !== self._loadToken || self._stopped || self.src !== requestSrc) {
                return;
            }
            self._loadingPromise = null;

            var loaded = 0;
            var maxDuration = 0;
            for (var i = 0; i < buffers.length; ++i) {
                if (buffers[i]) {
                    loaded++;
                    if (buffers[i].duration > maxDuration) {
                        maxDuration = buffers[i].duration;
                    }
                }
            }

            if (!loaded) {
                console.error('[chromium-port] No se pudo cargar audio multicanal: ninguna pista de mundo se pudo decodificar.');
                self._dispatch('error');
                return;
            }

            self._buffers = buffers;
            self._duration = maxDuration;
            self._dispatch('canplaythrough');
            if (self._queuedPlay || self.autoplay) {
                self.play();
            }
        });
    };

    MultiChannelAudio.prototype._disconnectSources = function () {
        var i;
        for (i = 0; i < this._sources.length; ++i) {
            if (this._sources[i]) {
                try {
                    this._sources[i].onended = null;
                    this._sources[i].stop(0);
                } catch (err) {
                }
            }
        }
        this._sources = [];
        this._gains = [];
        this._masterGain = null;
    };

    MultiChannelAudio.prototype.play = function () {
        var self = this;
        var ctx;
        var offset;
        var when;
        var i;
        var buffer;
        var source;
        var gain;
        var longest = -1;
        var longestDur = -1;

        if (!this._buffers) {
            this._queuedPlay = true;
            this._stopped = false;
            this.load();
            return Promise.resolve();
        }
        if (this._playing) {
            return Promise.resolve();
        }

        ctx = this._ctx || getAudioContext();
        this._ctx = ctx;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            ctx.resume().catch(function () {});
        }

        this._disconnectSources();

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 1.0;
        this._masterGain.connect(ctx.destination);

        offset = this._pauseTime || 0;
        if (this._duration > 0) {
            offset = this.loop ? offset % this._duration : Math.min(offset, this._duration);
        }
        when = ctx.currentTime + START_LEAD;
        this._startTime = when - offset;

        this._sources = new Array(NUM_WORLDS);
        this._gains = new Array(NUM_WORLDS);

        for (i = 0; i < NUM_WORLDS; ++i) {
            buffer = this._buffers[i];
            if (!buffer) {
                this._sources[i] = null;
                this._gains[i] = null;
                continue;
            }
            source = ctx.createBufferSource();
            gain = ctx.createGain();
            source.buffer = buffer;
            source.loop = !!this.loop;
            source.connect(gain);
            gain.connect(this._masterGain);

            var startOffset = offset;
            if (buffer.duration > 0) {
                startOffset = this.loop ? offset % buffer.duration : Math.min(offset, buffer.duration);
            }
            try {
                source.start(when, startOffset);
            } catch (err) {
                try { source.start(0, startOffset); } catch (err2) {}
            }

            this._sources[i] = source;
            this._gains[i] = gain;

            if (buffer.duration > longestDur) {
                longestDur = buffer.duration;
                longest = i;
            }
        }

        this._playing = true;
        this._ended = false;
        this._queuedPlay = false;
        this._stopped = false;
        this._updateVolumes(true);

        if (longest >= 0 && this._sources[longest]) {
            this._sources[longest].onended = function () {
                if (self._playing && !self.loop) {
                    self._playing = false;
                    self._pauseTime = 0;
                    self._ended = true;
                    self._dispatch('ended');
                }
            };
        }

        return Promise.resolve();
    };

    MultiChannelAudio.prototype.pause = function () {
        this._queuedPlay = false;
        if (!this._playing) {
            return;
        }
        this._pauseTime = this.currentTime;
        this._playing = false;
        this._disconnectSources();
    };

    MultiChannelAudio.prototype.stop = function () {
        this._queuedPlay = false;
        this._stopped = true;
        this._loadToken++;
        this._playing = false;
        this._pauseTime = 0;
        this._ended = false;
        this._loadingPromise = null;
        this._disconnectSources();
    };

    MultiChannelAudio.prototype._updateVolumes = function (instant) {
        var ctx = this._ctx;
        var volume = clamp01(this.volume);
        var i;
        var gain;
        var target;

        if (!ctx || !this._gains || !this._gains.length) {
            return;
        }

        for (i = 0; i < this._gains.length; ++i) {
            gain = this._gains[i];
            if (!gain) {
                continue;
            }
            // world i+1 is driven by channel pair (2*i, 2*i+1)
            target = volume * Math.max(clamp01(this.channelVolume[2 * i]), clamp01(this.channelVolume[2 * i + 1]));
            if (instant || !gain.gain.setTargetAtTime) {
                gain.gain.value = target;
            } else {
                gain.gain.setTargetAtTime(target, ctx.currentTime, 0.025);
            }
        }

        if (this._masterGain) {
            this._masterGain.gain.value = 1.0;
        }
    };

    // Kept as a no-op for backwards compatibility with the SoundPlayer race-fix
    // patch, which calls forceWorld6Fallback() for the world-6 select BGM. World
    // 6 is now just another per-world track, so nothing special is needed.
    MultiChannelAudio.prototype.forceWorld6Fallback = function () {};

    MultiChannelAudio.prototype.setAttribute = function (name, value) {
        if (name === 'src') {
            if (!value) {
                this.src = '';
                this.currentSrc = '';
                this._buffers = null;
                this.stop();
                return;
            }
            if (value !== this.src) {
                this.stop();
                this._buffers = null;
                this.src = value;
                this.currentSrc = value;
                return;
            }
        }
        this[name] = value;
    };

    MultiChannelAudio.prototype.removeAttribute = function (name) {
        if (name === 'src') {
            this.src = '';
            this.currentSrc = '';
            this._buffers = null;
            this.stop();
            return;
        }
        this[name] = undefined;
    };

    function copyAudioState(from, to) {
        var props = [
            'preload',
            'autoplay',
            'controls',
            'loop',
            'volume',
            'baseMusicVolume',
            'tvVolume',
            'gamepadVolume',
            'oncanplaythrough',
            'onerror',
            'onended'
        ];
        var index;

        for (index = 0; index < props.length; ++index) {
            try {
                if (from[props[index]] !== undefined) {
                    to[props[index]] = from[props[index]];
                }
            } catch (err) {
            }
        }

        if (from.channelVolume) {
            to.channelVolume = from.channelVolume;
        }
    }

    function rememberListener(state, type, listener) {
        if (typeof listener !== 'function') {
            return;
        }
        state.listeners.push({ type: type, listener: listener });
    }

    function attachRememberedListeners(state, shim) {
        var index;
        for (index = 0; index < state.listeners.length; ++index) {
            shim.addEventListener(state.listeners[index].type, state.listeners[index].listener);
        }
    }

    function makeShim(state, src) {
        var shim = new MultiChannelAudio(src);
        copyAudioState(state.real, shim);
        attachRememberedListeners(state, shim);
        state.shim = shim;
        global.__chromiumPortActiveMultiChannelAudios.push(shim);
        try {
            state.real.pause();
            state.real.removeAttribute('src');
        } catch (err) {
        }
        return shim;
    }

    function createAudioProxy(src) {
        var real = new NativeAudio(isLevelSelectAudio(src) ? undefined : src);
        var state = {
            real: real,
            shim: null,
            listeners: []
        };
        var proxy;

        if (isLevelSelectAudio(src)) {
            makeShim(state, src);
        }

        proxy = new Proxy(real, {
            get: function (target, prop) {
                var audio = state.shim || target;
                var value;

                if (prop === '__chromiumPortAudioProxy') {
                    return true;
                }
                if (prop === 'addEventListener') {
                    return function (type, listener, options) {
                        rememberListener(state, type, listener);
                        audio.addEventListener(type, listener, options);
                    };
                }
                if (prop === 'removeEventListener') {
                    return function (type, listener, options) {
                        var index;
                        for (index = state.listeners.length - 1; index >= 0; --index) {
                            if (state.listeners[index].type === type && state.listeners[index].listener === listener) {
                                state.listeners.splice(index, 1);
                            }
                        }
                        audio.removeEventListener(type, listener, options);
                    };
                }

                value = audio[prop];
                if (typeof value === 'function') {
                    return value.bind(audio);
                }
                return value;
            },
            set: function (target, prop, value) {
                var shim;

                if (prop === 'src' && isLevelSelectAudio(value)) {
                    shim = makeShim(state, value);
                    shim.src = value;
                    return true;
                }

                if (state.shim) {
                    if (prop === 'src' && !isLevelSelectAudio(value)) {
                        state.shim.stop();
                        state.shim = null;
                        target.src = value || '';
                        return true;
                    }
                    state.shim[prop] = value;
                    return true;
                }

                target[prop] = value;
                return true;
            }
        });

        return proxy;
    }

    function PatchedAudio(src) {
        return createAudioProxy(src);
    }

    global.__chromiumPortActiveMultiChannelAudios = [];
    global.__chromiumPortMultiChannelAudio = MultiChannelAudio;
    PatchedAudio.prototype = NativeAudio.prototype;
    global.Audio = PatchedAudio;

    // Drive the per-world cross-fade: each tick re-applies the game's current
    // channel volumes (which SoundPlayer ramps every frame) to the gain nodes.
    global.setInterval(function () {
        var active = global.__chromiumPortActiveMultiChannelAudios;
        var index;
        for (index = active.length - 1; index >= 0; --index) {
            if (active[index] && active[index]._playing) {
                active[index]._updateVolumes(false);
            }
        }
    }, 33);
}(window));
