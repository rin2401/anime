(function () { function r(e, n, t) { function o(i, f) { if (!n[i]) { if (!e[i]) { var c = "function" == typeof require && require; if (!f && c) return c(i, !0); if (u) return u(i, !0); var a = new Error("Cannot find module '" + i + "'"); throw a.code = "MODULE_NOT_FOUND", a } var p = n[i] = { exports: {} }; e[i][0].call(p.exports, function (r) { var n = e[i][1][r]; return o(n || r) }, p, p.exports, r, e, n, t) } return n[i].exports } for (var u = "function" == typeof require && require, i = 0; i < t.length; i++)o(t[i]); return o } return r })()({
    1: [function (require, module, exports) {
        "use strict";

        Object.defineProperty(exports, "__esModule", {
            value: true
        });
        exports.artplayerPlaylist = void 0;
        function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }
        function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; })), keys.push.apply(keys, symbols); } return keys; }
        function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, source[key]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } return target; }
        function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
        function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? key : String(key); }
        function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
        var artplayerPlaylist = function artplayerPlaylist(options) {
            return function (art) {
                var addedI18n = {
                    en: {
                        playlist: 'Playlist'
                    }
                };
                art.i18n.update(addedI18n);


                var currentEp = options.playlist.findIndex(function (videoInfo) {
                    return videoInfo.url === art.option.url;
                });
                var changeVideo = function changeVideo(art, index) {
                    if (!options.playlist[index]) {
                        return;
                    }

                    var artOptions = art.option;
                    var newArtplayer = art;
                    if (options.rebuildPlayer) {
                        var _options$autoNext;
                        art.destroy();

                        newArtplayer = new Artplayer(_objectSpread(_objectSpread(_objectSpread({}, artOptions), options.playlist[index]), {}, {
                            autoplay: (_options$autoNext = options.autoNext) !== null && _options$autoNext !== void 0 ? _options$autoNext : artOptions.autoplay,
                            i18n: addedI18n,
                            id: "".concat(artOptions.id, "-").concat(index === 0 ? '' : index)
                        }));
                    } else {
                        var _options$autoNext2;
                        art.switchUrl(options.playlist[index].url, options.playlist[index].title);
                        if ((_options$autoNext2 = options.autoNext) !== null && _options$autoNext2 !== void 0 ? _options$autoNext2 : artOptions.autoplay) {
                            art.play();
                        }
                    }

                    if (typeof options.onchanged === 'function') {
                        options.onchanged(newArtplayer, index);
                    }

                    currentEp = index;
                };

                if (options.autoNext && currentEp < options.playlist.length) {
                    art.on('video:ended', function () {
                        changeVideo(art, currentEp + 1);
                    });
                }
                var icon = '<i class="art-icon"><svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M810.666667 384H85.333333v85.333333h725.333334V384z m0-170.666667H85.333333v85.333334h725.333334v-85.333334zM85.333333 640h554.666667v-85.333333H85.333333v85.333333z m640-85.333333v256l213.333334-128-213.333334-128z" fill="#ffffff"></path></svg></i>';

                art.controls.add({
                    name: 'playlist',
                    position: 'right',
                    html: options.showText ? art.i18n.get('playlist') : icon,
                    style: {
                        padding: '0 10px'
                    },
                    selector: options.playlist.map(function (videoInfo, index) {
                        return {
                            html: "".concat(index + 1, ". ").concat(videoInfo.title || "Ep.".concat(index + 1)),
                            style: {
                                textAlign: 'left'
                            },
                            index: index,
                            "default": currentEp === index
                        };
                    }),
                    onSelect: function onSelect(item) {
                        changeVideo(art, item.index);
                        return options.showText ? art.i18n.get('playlist') : icon;
                    }
                });

                function prev() {
                    changeVideo(art, currentEp - 1);
                }

                function next() {
                    changeVideo(art, currentEp + 1);
                }

                art.controls.add({
                    position: 'left',
                    index: 19,
                    html: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>',
                    tooltip: 'Previous',
                    click: prev,
                });
                art.controls.add({
                    position: 'left',
                    index: 20,
                    html: '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>',
                    tooltip: 'Next',
                    click: next,
                });
                return {
                    name: 'artplayerPlaylist'
                };
            };
        };
        exports.artplayerPlaylist = artplayerPlaylist;
        if (typeof window !== 'undefined') {
            window.artplayerPlaylist = artplayerPlaylist;
        }

    }, {}]
}, {}, [1]);
