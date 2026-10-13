var RTDB = 'https://r3fire.firebaseio.com';
var DB = RTDB; // tên cũ trong code

// ── Người xem phòng xem chung, dùng Artplayer (cùng player với trang chính) ──
// Node room/{code} do host (người tạo từ player artplayer) ghi: {host, url,
// title, pos, playing, updatedAt}. Người xem chỉ ĐỌC, tự ngoại suy vị trí:
// playing ? pos + (now - updatedAt)/1000 : pos. Chat ở room/chat.js.

// Config cho thiết bị yếu (smart TV ít RAM, mạng chậm): buffer nhỏ, cap quality
// theo kích thước player, giải phóng phần đã xem để không phình RAM khi xem tập dài
var TV_HLS_CONFIG = {
    capLevelToPlayerSize: true,
    maxBufferLength: 20,
    maxBufferSize: 20 * 1000 * 1000,
    backBufferLength: 30,
    abrEwmaDefaultEstimate: 1000000,
};

// Loader lọc quảng cáo — y hệt trang artplayer: giữ master playlist cho
// hls.js tự chọn quality (ABR), lọc #EXTINF trên từng playlist
var _adsFilterLoader = null;
function getAdsFilterLoader() {
    if (!_adsFilterLoader) {
        _adsFilterLoader = class extends Hls.DefaultConfig.loader {
            load(context, config, callbacks) {
                if (context.type === 'manifest' || context.type === 'level') {
                    const onSuccess = callbacks.onSuccess;
                    callbacks.onSuccess = function (response, stats, ctx, networkDetails) {
                        if (typeof response.data === 'string' && response.data.indexOf('#EXTINF') !== -1) {
                            response.data = removeAds(response.data, ctx.url);
                        }
                        onSuccess(response, stats, ctx, networkDetails);
                    };
                }
                super.load(context, config, callbacks);
            }
        };
    }
    return _adsFilterLoader;
}

function removeAds(m3u8, url) {
    var baseUrl = url.split("/").slice(0, -1).join("/") + "/"
    m3u8 = m3u8.replace(/#EXT-X-DISCONTINUITY.*?#EXT-X-DISCONTINUITY\n/sg, "#EXT-X-DISCONTINUITY\n");
    m3u8 = m3u8.replace(/(?:#EXT-X-DISCONTINUITY\n)+/g, "#EXT-X-DISCONTINUITY\n");

    m3u8 = m3u8.split('\n').map(line => {
        if (line.startsWith('#') || line.trim() === '') {
            return line;
        }

        if (!line.match(/^https?:\/\//i)) {
            return baseUrl + line;
        }

        return line;
    }).join('\n');

    return m3u8
}

function createBlobUrl(data, mimeType = "application/vnd.apple.mpegurl") {
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
}

async function playM3u8(video, url, art) {
    const hlsMimeType = "application/vnd.apple.mpegurl";

    if (url.includes(".mp4")) {
        video.src = url;
        video.type = 'video/mp4';
    } else if (Hls.isSupported()) {
        if (art.hls) art.hls.destroy();
        const hls = new Hls(Object.assign({ loader: getAdsFilterLoader() }, TV_HLS_CONFIG));
        hls.loadSource(decodeURIComponent(url));
        hls.attachMedia(video);
        art.hls = hls;
        art.on('destroy', () => hls.destroy());
    } else if (video.canPlayType(hlsMimeType)) {
        video.type = hlsMimeType;
        video.src = url;
    }
}

async function playJson(video, url, art) {
    res = await fetch(url)
    if (!res.ok) {
        console.error(res);
        return
    }
    var data = await res.json()
    playM3u8Text(video, data.m3u8, art)
}

function playM3u8Text(video, m3u8, art) {
    const hlsMimeType = "application/vnd.apple.mpegurl";
    if (Hls.isSupported()) {
        if (art.hls) art.hls.destroy();
        const hls = new Hls(TV_HLS_CONFIG);
        hls.loadSource(createBlobUrl(m3u8));
        hls.attachMedia(video);
        art.hls = hls;
        art.on('destroy', () => hls.destroy());
    } else if (video.canPlayType(hlsMimeType)) {
        video.src = `data:${hlsMimeType};base64,${btoa(m3u8)}`;
    }
}

// ── Đồng bộ theo host ──
var state = null;      // nội dung node room/{code} đang biết
var loadedUrl = '';    // url đã gắn vào player (tránh mount lại mỗi update)
var art = null;
var roomCode = '';     // mã phòng từ ?id= (host dùng để PATCH + share link)
var hostSynced = false; // host: đã áp mốc lần đầu chưa (tránh patch pos=0 lúc autoplay)
var lastSeekLogPos = 0; // host: mốc tua đã log chat lần gần nhất (tua nhỏ không log)

// uid của mình (host xác định qua state.host === uid); khách chưa đăng nhập = null
function myUid() {
    try {
        return (firebase.auth().currentUser || {}).uid || null;
    } catch (e) { return null; }
}

function isHost() {
    return !!(state && state.host && myUid() && state.host === myUid());
}

// Host ghi state: play/pause/seek/hết tập — chỉ ghi khi state ĐỔI, người xem
// tự ngoại suy pos + (now - updatedAt)/1000 giữa 2 lần ghi
function patchRoom(patch) {
    if (!isHost() || !hostSynced) return;
    patch.updatedAt = Date.now();
    var u = firebase.auth().currentUser;
    u.getIdToken().then(function (tok) {
        return fetch(RTDB + '/room/' + roomCode + '.json?auth=' + tok, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
    }).catch(function () { });
}

// Vị trí theo host: pos + thời gian trôi từ lần host cập nhật gần nhất
function targetPos(s) {
    if (!s || s.pos == null) return null;
    var pos = Number(s.pos) || 0;
    if (s.playing) pos += (Date.now() - Number(s.updatedAt || 0)) / 1000;
    // Host bỏ chạy hết tập không đổi gì -> quay vòng theo duration (loop)
    var d = art ? art.duration : 0;
    if (d && d > 0 && pos > d) pos = pos % d;
    return pos;
}

// Áp state vừa nhận: đổi nguồn nếu host đổi tập, theo play/pause, seek nếu lệch.
// Host (uid trùng state.host) là nguồn sự thật — KHÔNG tự theo mình: chỉ mount
// url mới (khi đổi tập từ trang create), không play/pause cưỡng bức, không
// followPos.
function syncFromState() {
    if (!state) return;
    if (state.url && state.url !== loadedUrl) {
        loadedUrl = state.url;
        if (state.title) {
            document.title = state.title;
            setMediaSession(state.title);
            var el = document.getElementById('room-label');
            if (el) el.textContent = state.title;
        }
        mountPlayer(state.url);
    }
    if (!isHost() && loadedUrl && art) {
        if (state.playing === false) { if (!art.video.paused) art.pause(); }
        else if (state.playing === true) { if (art.video.paused) art.play(); }
        followPos();
    }
}

// Seek về phía host khi lệch quá 3s (đủ rộng để không dập lệnh tua của host,
// đủ chặt để người xem không trôi quá xa) — host tự là nguồn sự thật nên bỏ qua
function followPos() {
    if (isHost()) return;
    var tp = targetPos(state);
    if (tp == null || !art) return;
    if (art.duration && isFinite(art.duration)
        && Math.abs(art.currentTime - tp) > 3) {
        art.currentTime = tp;
    }
}

// Player sẵn sàng -> đặt mốc theo host ngay lần đầu. Host: mốc pos trong node
// (vị trí lúc bấm 👥 từ artplayer) và KHÔNG cưỡng bức play/pause (autoplay
// sẵn trong config; play/pause sau đó là của host, patch qua listener)
function applySync() {
    if (!state || !loadedUrl || !art) return;
    if (isHost()) {
        art.currentTime = Number(state.pos) || 0;
        lastSeekLogPos = Number(state.pos) || 0; // seek ban đầu không phải "tua"
        hostSynced = true;
        return;
    }
    var tp = targetPos(state);
    if (tp != null && art.duration && isFinite(art.duration)) art.currentTime = tp;
    if (state.playing === false) art.pause();
    else art.play();
}

// Gắn nguồn mới: hủy player cũ tạo player mới (đổi tập chỉ xảy ra khi host
// bấm tập khác — không cần switchUrl khéo léo)
function mountPlayer(url) {
    if (art) {
        try { art.destroy(false); } catch (e) { }
        art = null;
    }
    // Sự kiện autoplay (video:play) của player mới xảy ra trước khi seek tới
    // mốc trong node — cấm patch trong khoảng đó (applySync bật lại cờ)
    hostSynced = false;
    var type = url.endsWith('.json') ? 'json' : 'm3u8';
    art = new Artplayer({
        container: '.artplayer-app',
        url: url,
        poster: '/anime/image/r3_512.png',
        autoplay: true,
        autoMini: false,
        loop: true,
        playsInline: true,
        fullscreen: true,
        pip: true,
        mutex: false,
        backdrop: true,
        theme: '#23ade5',
        customType: {
            m3u8: playM3u8,
            json: playJson,
        },
    });
    // type dựa trên url: json = node Firebase chứa m3u8 text, m3u8 = link trực tiếp
    // (Artplayer tự đoán theo đuôi file, customType m3u8 bắt cả link phim1280)
    void type;
    art.on('ready', applySync);
    // Host phát điều khiển của MÌNH vào room node (người xem chỉ đọc):
    // play/pause/seek/hết tập — không ghi timeupdate liên tục.
    // Mỗi hành động còn ghi 1 TIN HỆ THỐNG vào chatbox (xám nghiêng) để cả
    // phòng thấy ai đang làm gì; tua nhỏ (phím ±5s) không log tránh spam.
    ['video:play', 'video:pause', 'video:seeked', 'video:ended'].forEach(function (ev) {
        art.on(ev, function () {
            patchRoom({ pos: (art.currentTime || 0), playing: !!art.playing });
            if (!isHost() || !hostSynced) return;
            if (typeof RoomChat === 'undefined' || !RoomChat.action) return;
            if (ev === 'video:play') RoomChat.action('đã phát tiếp', '▶');
            else if (ev === 'video:pause') RoomChat.action('đã tạm dừng', '⏸');
            else if (ev === 'video:ended') RoomChat.action('đã xem hết tập', '🎬');
            else {
                var cur = art.currentTime || 0;
                if (Math.abs(cur - lastSeekLogPos) > 30) {
                    RoomChat.action('đã tua tới ' + mmss(cur), '⏩');
                    lastSeekLogPos = cur;
                }
            }
        });
    });
}

// 123 -> "2:03" cho tin hệ thống "đã tua tới"
function mmss(s) {
    s = Math.max(0, Math.round(s || 0));
    var m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + ('0' + ss).slice(-2);
}

// Link share phòng = chính URL của trang (thanh địa chỉ) — host copy từ đó,
// không cần nút/panel share riêng.

function setMediaSession(title) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artwork: [
                {
                    src: '/anime/image/r3_512.png', sizes: '512x512',
                    type: 'image/png'
                },
                {
                    src: '/anime/image/r3_128.png', sizes: '128x128',
                    type: 'image/png'
                },
            ]
        });
    }
}

// ── Nhận state: REST streaming (EventSource) + poll 3s luôn chạy ──
// Loại event nằm ở TÊN event SSE ('put'/'patch'), không có trong payload
// (payload chỉ có {path, data}).
function onStateEvent(type, d) {
    if (!d || typeof d !== 'object') return;
    if (type === 'put') {
        var path = d.path || '/';
        if (path === '/') { state = d.data || null; }
        else {
            if (!state) return;
            // path kiểu sub-update ('/pos') — gán sâu theo từng khúc
            var keys = path.split('/').filter(Boolean);
            var cur = state;
            for (var i = 0; i < keys.length - 1; i++) {
                if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
                cur = cur[keys[i]];
            }
            cur[keys[keys.length - 1]] = d.data;
        }
    } else if (type === 'patch') {
        if (!state) return;
        Object.keys(d.data || {}).forEach(function (k) { state[k] = d.data[k]; });
    } else {
        return;
    }
    syncFromState();
}

function watchRoom(code) {
    // Poll 3s luôn chạy: GET là snapshot chuẩn, không phụ thuộc EventSource
    // (webview cũ/treo nền thường chết stream im lặng). SSE chỉ để phản ứng
    // nhanh play/pause/seek của host.
    if (typeof EventSource !== 'undefined') {
        var es = new EventSource(RTDB + '/room/' + code + '.json');
        ['put', 'patch'].forEach(function (ev) {
            es.addEventListener(ev, function (e) {
                try { onStateEvent(ev, JSON.parse(e.data)); } catch (err) { }
            });
        });
        es.onerror = function () { /* EventSource tự reconnect; poll gánh phía sau */ };
    }
    setInterval(function () {
        fetch(RTDB + '/room/' + code + '.json')
            .then(r => r.json())
            .then(data => {
                if (JSON.stringify(data) === JSON.stringify(state)) return;
                state = data || null;
                syncFromState();
            })
            .catch(() => { });
    }, 3000);
    // Vòng kéo theo host giữa các update (host đang phát thì không ghi liên tục)
    setInterval(followPos, 4000);
}

// ── Phím tắt (người xem vẫn tua/volume riêng; vị trí sẽ bị kéo về theo host
// trong vòng 4s nếu lệch quá 3s) ──
function playPause() {
    art ? (art.video.paused ? art.play() : art.pause()) : 0;
}
function volumeUp() {
    if (art && art.volume <= 0.9) art.volume += 0.1;
}
function volumeDown() {
    if (art && art.volume >= 0.1) art.volume -= 0.1;
}
function seekRight() {
    if (art) art.currentTime += 5;
}
function seekLeft() {
    if (art) art.currentTime -= 5;
}
function vidFullscreen() {
    if (art) art.fullscreen = !art.fullscreen;
}

window.addEventListener('load', function () {
    Mousetrap.bind('up', volumeUp);
    Mousetrap.bind('down', volumeDown);
    Mousetrap.bind('right', seekRight);
    Mousetrap.bind('left', seekLeft);
    Mousetrap.bind('f', vidFullscreen);

    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    if (!id) {
        // Sảnh chờ: nhập mã phòng hoặc sang trang tạo phòng
        var join = document.getElementById('room-join');
        if (join) {
            join.style.display = 'flex';
            var label = document.getElementById('room-label');
            if (label) label.textContent = '';
            var codeInput = document.getElementById('join-code');
            var go = function () {
                var c = (codeInput.value || '').trim().toLowerCase();
                if (!/^[a-z2-9]{6}$/.test(c)) return;
                window.location.href = '/anime/room/?id=' + c;
            };
            document.getElementById('join-btn').addEventListener('click', go);
            codeInput.addEventListener('keydown', function (e) {
                if (e.isComposing === true || e.keyCode === 229) return; // IME ghép vần
                if (e.key === 'Enter') { e.preventDefault(); go(); }
            });
            codeInput.focus();
        }
        return;
    }
    var codeLabel = document.getElementById('room-code');
    if (codeLabel) codeLabel.textContent = id;
    roomCode = id;
    watchRoom(id);
    // Chat: dùng chung room/chat.js, panel nằm trong sidebar #chat-side
    if (typeof RoomChat !== 'undefined') {
        RoomChat.mount(document.getElementById('chat-panel'), function () { return id; });
        bindChatToggle();
    }
});

// Nút 💬 góc phải trên: bật/tắt sidebar chat (bên cạnh video trên màn rộng,
// khối dưới video trên mobile — không đè phim). Màn rộng >=900px mở sẵn.
function bindChatToggle() {
    var btn = document.getElementById('chat-toggle');
    var layout = document.getElementById('room-layout');
    if (!btn || !layout) return;
    btn.addEventListener('click', function () {
        var on = layout.classList.toggle('chat-open');
        btn.classList.toggle('active', on);
    });
    if (window.innerWidth >= 900) {
        layout.classList.add('chat-open');
        btn.classList.add('active');
    }
}
