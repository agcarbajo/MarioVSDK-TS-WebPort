(function (global) {
    'use strict';

    var NativeAudio = global.Audio;
    var AudioContextCtor = global.AudioContext || global.webkitAudioContext;

    if (!NativeAudio || !AudioContextCtor || global.__chromiumPortMultiChannelAudioInstalled) {
        return;
    }

    global.__chromiumPortMultiChannelAudioInstalled = true;

    function isLevelSelectAudio(src) {
        return typeof src === 'string' && src.toLowerCase().indexOf('level_select_full.ogg') !== -1;
    }

    function levelSelectWorld6FallbackSrc(src) {
        if (!isLevelSelectAudio(src)) {
            return '';
        }
        return String(src).replace(/level_select_full\.ogg/i, 'level_select_world_6.ogg');
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
        this._buffer = null;
        this._source = null;
        this._splitter = null;
        this._merger = null;
        this._masterGain = null;
        this._world6FallbackBuffer = null;
        this._world6FallbackSource = null;
        this._world6FallbackGain = null;
        this._world6FallbackLoadingPromise = null;
        this._channelGains = [];
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
        get: function () {
            return !this._playing;
        }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'ended', {
        get: function () {
            return this._ended;
        }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'duration', {
        get: function () {
            return this._buffer ? this._buffer.duration : NaN;
        }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'readyState', {
        get: function () {
            return this._buffer ? 4 : 0;
        }
    });

    Object.defineProperty(MultiChannelAudio.prototype, 'currentTime', {
        get: function () {
            if (!this._buffer) {
                return this._pauseTime || 0;
            }
            if (!this._playing || !this._ctx) {
                return this._pauseTime || 0;
            }

            var elapsed = this._ctx.currentTime - this._startTime;
            if (this.loop && this._buffer.duration > 0) {
                return elapsed % this._buffer.duration;
            }
            return Math.min(elapsed, this._buffer.duration);
        },
        set: function (value) {
            var wasPlaying = this._playing;
            var duration = this._buffer ? this._buffer.duration : 0;
            value = Math.max(0, Number(value) || 0);
            if (duration > 0) {
                value = this.loop ? value % duration : Math.min(value, duration);
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

        if (!requestSrc) {
            return;
        }
        if (this._buffer && this.currentSrc === requestSrc) {
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

        this._loadingPromise = fetch(requestSrc)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ' while loading ' + requestSrc);
                }
                return response.arrayBuffer();
            })
            .then(function (arrayBuffer) {
                var ctx = getAudioContext();
                self._ctx = ctx;
                return ctx.decodeAudioData(arrayBuffer.slice(0));
            })
            .then(function (buffer) {
                if (loadToken !== self._loadToken || self._stopped || self.src !== requestSrc) {
                    return;
                }
                self._buffer = buffer;
                self._loadingPromise = null;
                self._loadWorld6Fallback();
                self._dispatch('canplaythrough');
                if (self._queuedPlay || self.autoplay) {
                    self.play();
                }
            })
            .catch(function (err) {
                if (loadToken !== self._loadToken || self._stopped || self.src !== requestSrc) {
                    return;
                }
                self._loadingPromise = null;
                console.error('[chromium-port] No se pudo cargar audio multicanal:', err);
                self._dispatch('error');
            });
    };

    MultiChannelAudio.prototype._disconnectSource = function () {
        if (this._source) {
            try {
                this._source.onended = null;
                this._source.stop(0);
            } catch (err) {
            }
        }

        this._channelGains = [];
        this._source = null;
        this._splitter = null;
        this._merger = null;
        this._disconnectWorld6Fallback();
        this._masterGain = null;
    };

    MultiChannelAudio.prototype._loadWorld6Fallback = function () {
        var self = this;
        var fallbackSrc = levelSelectWorld6FallbackSrc(this.src);

        if (!fallbackSrc || this._world6FallbackBuffer || this._world6FallbackLoadingPromise) {
            return;
        }

        this._world6FallbackLoadingPromise = fetch(fallbackSrc)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ' while loading ' + fallbackSrc);
                }
                return response.arrayBuffer();
            })
            .then(function (arrayBuffer) {
                var ctx = self._ctx || getAudioContext();
                self._ctx = ctx;
                return ctx.decodeAudioData(arrayBuffer.slice(0));
            })
            .then(function (buffer) {
                self._world6FallbackBuffer = buffer;
                self._world6FallbackLoadingPromise = null;
                if (self._playing && self._wantsWorld6Fallback()) {
                    self._connectWorld6Fallback(self.currentTime);
                    self._updateVolumes(true);
                }
            })
            .catch(function (err) {
                self._world6FallbackLoadingPromise = null;
                console.warn('[chromium-port] No se pudo cargar fallback de musica mundo 6:', err);
            });
    };

    MultiChannelAudio.prototype._wantsWorld6Fallback = function () {
        return Math.max(clamp01(this.channelVolume[10]), clamp01(this.channelVolume[11])) > 0.001;
    };

    MultiChannelAudio.prototype.forceWorld6Fallback = function () {
        if (!isLevelSelectAudio(this.src)) {
            return;
        }

        if (!this._world6FallbackBuffer) {
            this._loadWorld6Fallback();
        }

        if (this._playing && this._world6FallbackBuffer && !this._world6FallbackSource) {
            this._connectWorld6Fallback(this.currentTime);
        }

        this._updateVolumes(true);
    };

    MultiChannelAudio.prototype._disconnectWorld6Fallback = function () {
        if (this._world6FallbackSource) {
            try {
                this._world6FallbackSource.onended = null;
                this._world6FallbackSource.stop(0);
            } catch (err) {
            }
        }
        this._world6FallbackSource = null;
        this._world6FallbackGain = null;
    };

    MultiChannelAudio.prototype._connectWorld6Fallback = function (offset) {
        var ctx;
        var source;
        var gain;

        if (!this._world6FallbackBuffer || !this._playing) {
            return;
        }

        ctx = this._ctx || getAudioContext();
        this._disconnectWorld6Fallback();

        source = ctx.createBufferSource();
        gain = ctx.createGain();
        source.buffer = this._world6FallbackBuffer;
        source.loop = !!this.loop;
        source.connect(gain);
        gain.connect(ctx.destination);

        this._world6FallbackSource = source;
        this._world6FallbackGain = gain;

        offset = Math.max(0, Number(offset) || 0);
        if (this._world6FallbackBuffer.duration > 0) {
            offset = this.loop ? offset % this._world6FallbackBuffer.duration : Math.min(offset, this._world6FallbackBuffer.duration);
        }

        try {
            source.start(0, offset);
        } catch (err) {
            this._disconnectWorld6Fallback();
        }
    };

    MultiChannelAudio.prototype.play = function () {
        var self = this;
        var ctx;
        var source;
        var splitter;
        var merger;
        var masterGain;
        var channelCount;
        var channelIndex;
        var gain;
        var offset;

        if (!this._buffer) {
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

        this._disconnectSource();

        source = ctx.createBufferSource();
        splitter = ctx.createChannelSplitter(this._buffer.numberOfChannels);
        merger = ctx.createChannelMerger(2);
        masterGain = ctx.createGain();
        channelCount = this._buffer.numberOfChannels;

        source.buffer = this._buffer;
        source.loop = !!this.loop;

        source.connect(splitter);
        for (channelIndex = 0; channelIndex < channelCount; ++channelIndex) {
            gain = ctx.createGain();
            splitter.connect(gain, channelIndex);
            gain.connect(merger, 0, channelIndex % 2);
            this._channelGains[channelIndex] = gain;
        }
        merger.connect(masterGain);
        masterGain.connect(ctx.destination);

        this._source = source;
        this._splitter = splitter;
        this._merger = merger;
        this._masterGain = masterGain;
        this._playing = true;
        this._ended = false;
        this._queuedPlay = false;
        this._stopped = false;

        offset = this._pauseTime || 0;
        if (this._buffer.duration > 0) {
            offset = this.loop ? offset % this._buffer.duration : Math.min(offset, this._buffer.duration);
        }
        this._startTime = ctx.currentTime - offset;
        this._updateVolumes(true);
        this._loadWorld6Fallback();
        this._connectWorld6Fallback(offset);
        this._updateVolumes(true);

        source.onended = function () {
            if (self._playing && !self.loop) {
                self._playing = false;
                self._pauseTime = 0;
                self._ended = true;
                self._dispatch('ended');
            }
        };

        try {
            source.start(0, offset);
        } catch (err) {
            this._playing = false;
            return Promise.reject(err);
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
        this._disconnectSource();
    };

    MultiChannelAudio.prototype.stop = function () {
        this._queuedPlay = false;
        this._stopped = true;
        this._loadToken++;
        this._playing = false;
        this._pauseTime = 0;
        this._ended = false;
        this._loadingPromise = null;
        this._disconnectSource();
    };

    MultiChannelAudio.prototype._updateVolumes = function (instant) {
        var ctx = this._ctx;
        var channelIndex;
        var gain;
        var target;
        var volume = clamp01(this.volume);
        var wantsWorld6 = this._wantsWorld6Fallback();

        if (!ctx || !this._channelGains.length) {
            return;
        }

        if (isLevelSelectAudio(this.src) && wantsWorld6) {
            if (!this._world6FallbackBuffer) {
                this._loadWorld6Fallback();
            } else if (this._playing && !this._world6FallbackSource) {
                this._connectWorld6Fallback(this.currentTime);
            }
        }

        for (channelIndex = 0; channelIndex < this._channelGains.length; ++channelIndex) {
            gain = this._channelGains[channelIndex];
            target = volume * clamp01(this.channelVolume[channelIndex]);
            if (isLevelSelectAudio(this.src) && (channelIndex === 10 || channelIndex === 11)) {
                target = 0;
            }
            if (instant || !gain.gain.setTargetAtTime) {
                gain.gain.value = target;
            } else {
                gain.gain.setTargetAtTime(target, ctx.currentTime, 0.025);
            }
        }

        if (this._masterGain) {
            this._masterGain.gain.value = 1.0;
        }
        if (this._world6FallbackGain) {
            target = volume * Math.max(clamp01(this.channelVolume[10]), clamp01(this.channelVolume[11]));
            if (instant || !this._world6FallbackGain.gain.setTargetAtTime) {
                this._world6FallbackGain.gain.value = target;
            } else {
                this._world6FallbackGain.gain.setTargetAtTime(target, ctx.currentTime, 0.025);
            }
        }
    };

    MultiChannelAudio.prototype.setAttribute = function (name, value) {
        if (name === 'src') {
            if (!value) {
                this.src = '';
                this.currentSrc = '';
                this._buffer = null;
                this.stop();
                return;
            }
            if (value !== this.src) {
                this.stop();
                this._buffer = null;
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
            this._buffer = null;
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

    global.setInterval(function () {
        var active = global.__chromiumPortActiveMultiChannelAudios;
        var index;
        for (index = active.length - 1; index >= 0; --index) {
            if (active[index] && active[index]._playing) {
                active[index]._updateVolumes(false);
            }
        }
    }, 33);
})(window);
