// https://github.com/HCLonely/artplayer-plugin-playlist
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
                    art.on('video:ended', next);
                }
                var icon = '<i class="art-icon"><svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M810.666667 384H85.333333v85.333333h725.333334V384z m0-170.666667H85.333333v85.333334h725.333334v-85.333334zM85.333333 640h554.666667v-85.333333H85.333333v85.333333z m640-85.333333v256l213.333334-128-213.333334-128z" fill="#ffffff"></path></svg></i>';

                function getPlaylistControl() {
                    return {
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
                    }

                }
                art.controls.add(getPlaylistControl());
                const current = art.controls.playlist.querySelector('.art-current')
                current.scrollIntoView({ behavior: 'smooth' })


                function prev() {
                    const current = art.controls.playlist.querySelector('.art-current')
                    current.previousSibling?.click()
                    current.previousSibling?.scrollIntoView({ behavior: 'smooth' })

                }

                function next() {
                    const current = art.controls.playlist.querySelector('.art-current')
                    current.nextSibling?.click()
                    current.nextSibling?.scrollIntoView({ behavior: 'smooth' })
                }

                art.controls.add({
                    name: 'prev',
                    position: 'left',
                    index: 19,
                    html: '<svg fill="#000000" height="18px" viewBox="0 0 32 32" enable-background="new 0 0 32 32" version="1.1" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g id="play"></g> <g id="stop"></g> <g id="pause"></g> <g id="replay"></g> <g id="next"></g> <g id="Layer_8"> <g> <g> <path d="M27.136,3.736C27.508,3.332,28,3.45,28,4v24c0,0.55-0.492,0.668-0.864,0.264L16.449,16.736 c-0.372-0.405-0.325-1.068,0.047-1.473L27.136,3.736z"></path> <path d="M27.602,29.504c-0.441,0-0.868-0.2-1.202-0.563L15.715,17.416c-0.718-0.781-0.697-2.022,0.044-2.829L26.401,3.058 c0.333-0.362,0.76-0.562,1.201-0.562C28.399,2.496,29,3.143,29,4v24C29,28.857,28.399,29.504,27.602,29.504z M27,5.358 l-9.77,10.584c-0.036,0.04-0.044,0.109-0.036,0.132L27,26.646V5.358z"></path> </g> <g> <path d="M14.297,3.736C14.669,3.332,15,3.45,15,4v24c0,0.55-0.331,0.668-0.703,0.264L3.69,16.736 c-0.372-0.405-0.365-1.068,0.007-1.473L14.297,3.736z"></path> <path d="M14.706,29.504c-0.286,0-0.717-0.098-1.146-0.563L2.954,17.414c-0.727-0.791-0.724-2.032,0.006-2.827l10.6-11.527 c0.428-0.466,0.859-0.563,1.146-0.563C15.329,2.496,16,2.967,16,4v24C16,29.033,15.329,29.504,14.706,29.504z M14,5.538 L4.433,15.94c-0.025,0.027-0.023,0.102-0.006,0.119L14,26.463V5.538z"></path> </g> </g> </g> <g id="search"></g> <g id="list"></g> <g id="love"></g> <g id="menu"></g> <g id="add"></g> <g id="headset"></g> <g id="random"></g> <g id="music"></g> <g id="setting"></g> <g id="Layer_17"></g> <g id="Layer_18"></g> <g id="Layer_19"></g> <g id="Layer_20"></g> <g id="Layer_21"></g> <g id="Layer_22"></g> <g id="Layer_23"></g> <g id="Layer_24"></g> <g id="Layer_25"></g> <g id="Layer_26"></g> </g></svg>',
                    tooltip: 'Previous',
                    click: prev,
                });
                art.controls.add({
                    name: 'next',
                    position: 'left',
                    index: 20,
                    html: '<svg fill="#000000" height="18px" viewBox="0 0 32 32" enable-background="new 0 0 32 32" version="1.1" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g id="play"></g> <g id="stop"></g> <g id="pause"></g> <g id="replay"></g> <g id="next"> <g> <g> <path d="M4.561,3.728C4.184,3.328,4,3.45,4,4v24c0,0.55,0.184,0.672,0.561,0.272l10.816-11.544 c0.377-0.4,0.408-1.056,0.031-1.456L4.561,3.728z"></path> <path d="M4.202,29.507L4.202,29.507C4.079,29.507,3,29.465,3,28V4c0-1.465,1.079-1.507,1.202-1.507 c0.568,0,0.958,0.414,1.087,0.55l10.848,11.545c0.725,0.77,0.711,2.038-0.031,2.826L5.29,28.956 C5.16,29.094,4.771,29.507,4.202,29.507z M5.004,5.66L5,26.337l9.674-10.389L5.004,5.66z"></path> </g> <g> <path d="M17.561,3.728C17.184,3.328,17,3.45,17,4v24c0,0.55,0.184,0.672,0.561,0.272l10.816-11.544 c0.377-0.4,0.408-1.056,0.031-1.456L17.561,3.728z"></path> <path d="M17.202,29.507L17.202,29.507C17.079,29.507,16,29.465,16,28V4c0-1.465,1.079-1.507,1.202-1.507 c0.568,0,0.958,0.414,1.087,0.55l10.848,11.545c0.725,0.77,0.711,2.038-0.031,2.826L18.29,28.956 C18.16,29.094,17.771,29.507,17.202,29.507z M18.004,5.66L18,26.337l9.674-10.389L18.004,5.66z"></path> </g> </g> </g> <g id="Layer_8"></g> <g id="search"></g> <g id="list"></g> <g id="love"></g> <g id="menu"></g> <g id="add"></g> <g id="headset"></g> <g id="random"></g> <g id="music"></g> <g id="setting"></g> <g id="Layer_17"></g> <g id="Layer_18"></g> <g id="Layer_19"></g> <g id="Layer_20"></g> <g id="Layer_21"></g> <g id="Layer_22"></g> <g id="Layer_23"></g> <g id="Layer_24"></g> <g id="Layer_25"></g> <g id="Layer_26"></g> </g></svg>',
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
