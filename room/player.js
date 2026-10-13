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

// ── Danh sách tập của phòng (copy mapEpisodes/kkphimEpisodes từ artplayer) ──
// Room node mang pid (key node Firebase anime/) hoặc k (slug kkphim) do trang
// create ghi lúc tạo — dùng để tải danh sách tập cho nút playlist trong
// control bar (host bấm đổi tập cho cả phòng).

// Số tập để sắp xếp: '7.5' -> 7.5, '07_5' -> 7.5 (key Firebase thay '.' bằng '_')
function epNum(id) {
    return parseFloat(String(id).replace(/_/g, '.')) || 0;
}

// Nhãn tập: key Firebase thay '.' bằng '_', hậu tố END mọi biến thể hiện trần số
function displayEp(id) {
    return String(id).replace(/_/g, '.').replace(/[\s._-]+end\s*$/i, '').trim();
}

// Map node Firebase anime/{pid} thành danh sách tập có url phát được: chỉ tập
// có file/m3u8; tập lưu THẲNG nội dung m3u8 (không có file) trỏ về chính node
// đó qua customType `json`.
function mapEpisodes(data, animeId) {
    var episodeList = [];
    data = data || {}
    Object.entries(data).forEach(([id, episode]) => {
        if (!episode) return
        if (!episode.file && !episode.m3u8) return
        var file = episode.file ||
            `https://r3fire.firebaseio.com/anime/${animeId}/${id}.json`
        id = episode.id || id
        episodeList.push({ id: id, title: episode.title, url: file });
    });
    episodeList.sort(function (a, b) { return epNum(a.id) - epNum(b.id) });
    return episodeList;
}

// kkphim: lấy số tập từ TÊN ('Tập 1004.5') — slug bỏ dấu chấm nên parse slug
// sai các tập .5 (copy kkphimEpisodes của artplayer)
function kkphimEpisodes(data) {
    var lastNum = 0, extra = 0;
    return (data.episodes[0].server_data || []).map((item) => {
        var slug = item.slug || ''
        var id = 1
        var nm = (item.name || '').match(/(\d+(?:\.\d+)?)/)
        if (nm) {
            id = parseFloat(nm[1]); lastNum = id; extra = 0
        } else if (slug.indexOf("tap-") === 0) {
            let rest = slug.slice(4);
            let num = Number(rest);
            if (Number.isInteger(num)) {
                id = num; lastNum = num; extra = 0
            } else {
                id = lastNum + 0.5 + extra / 100; extra++
            }
        }
        return { id: id, title: (data.movie && data.movie.origin_name) + " - " + id, url: item.link_m3u8 };
    });
}

// ── Đồng bộ theo host ──
var state = null;      // nội dung node room/{code} đang biết
var loadedUrl = '';    // url đã gắn vào player (tránh mount lại mỗi update)
var art = null;
var roomCode = '';     // mã phòng từ ?id= (host dùng để PATCH + share link)
var hostSynced = false; // host: đã áp mốc lần đầu chưa (tránh patch pos=0 lúc autoplay)
var lastSeekLogPos = 0; // host: mốc tua đã log chat lần gần nhất (tua nhỏ không log)
var chatAutoOpened = false; // đã tự mở sidebar chat cho màn rộng chưa (1 lần/trang)
var authResolved = false; // firebase.auth đã xác định xong uid (tránh khoá nhầm host khi auth chưa về)
var episodeList = [];   // danh sách tập của bộ đang phát (nút playlist control bar)
var epsLoadedFor = ''; // pid/k đã tải tập rồi (tránh refetch mỗi lần đổi tập)
var switchArmed = false; // đang chờ tập mới phát thật sau khi host đổi tập (bỏ qua event rác lúc load nguồn)

// uid của mình (host xác định qua state.host === uid); khách chưa đăng nhập = null
function myUid() {
    try {
        return (firebase.auth().currentUser || {}).uid || null;
    } catch (e) { return null; }
}

function isHost() {
    return !!(state && state.host && myUid() && state.host === myUid());
}

// Khoá control phát từ phía player cho NGƯỜI XEM (CSS .viewer-lock tê nút
// play/thanh tua/bấm giữa màn) — chỉ gắn khi auth đã chắc chắn uid MÀ uid
// đó không phải host, tránh khoá nhầm host lúc auth chưa kịp về.
function applyViewerLock() {
    var layout = document.getElementById('room-layout');
    if (!layout) return;
    layout.classList.toggle('viewer-lock', !!(authResolved && !isHost()));
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
        loadEpisodesThenMount(state);
    }
    if (!isHost() && loadedUrl && art) {
        if (state.playing === false) { if (!art.video.paused) art.pause(); }
        else if (state.playing === true) { if (art.video.paused) art.play(); }
        followPos();
    }
    applyViewerLock();
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

// Tải danh sách tập của bộ (pid = key Firebase anime/, k = slug kkphim —
// do trang create ghi vào room node) rồi mới mount player kèm plugin playlist.
// Bộ cũ không có pid/k (tạo trước tính năng) -> playlist rỗng, player vẫn chạy.
function loadEpisodesThenMount(st) {
    var key = String(st.pid || '') || 'k:' + String(st.k || '');
    var mount = function () { mountPlayer(st.url); };
    if (!key || key === 'k:') { episodeList = []; epsLoadedFor = ''; return mount(); }
    if (epsLoadedFor === key) return mount(); // đã tải cho bộ này (đổi tập không refetch)
    var p;
    if (st.pid) {
        p = fetch(RTDB + '/anime/' + st.pid + '.json').then(r => r.json())
            .then(d => mapEpisodes(d, st.pid));
    } else {
        p = fetch('https://phimapi.com/phim/' + st.k).then(r => r.json())
            .then(d => kkphimEpisodes(d));
    }
    p.then(function (eps) {
        episodeList = eps || [];
        epsLoadedFor = key;
    }).catch(function () {
        episodeList = [];
    }).then(mount);
}

// Host bấm tập trong playlist (hoặc autoNext hết tập): plugin đã switchUrl
// trong player — việc của mình là PHÁT url mới vào room node cho người xem
// theo kèm tin hệ thống chatbox. Người xem bấm (nếu lọt khoá CSS) -> hoàn tác.
function onPlaylistChanged(a, index) {
    var ep = episodeList[index];
    if (!ep || !ep.url) return;
    if (!isHost()) {
        loadedUrl = ''; // ép mount lại nguồn host (plugin đã switch cục bộ)
        syncFromState();
        return;
    }
    lastSeekLogPos = 0;      // seek về 0 của tập mới không thành tin "tua tới 0:00"
    loadedUrl = ep.url;      // đã switch trong player — không mount lại
    // Khoá event cho tới khi tập mới PHÁT THẬT: lúc load nguồn mới, các event
    // pause/seek phát sinh mang art.playing stale=false (đo thấy patch rác
    // playing:false 3.2s sau switch dù video đang phát). Timeout dự phòng
    // 15s cho nguồn lỗi/autoplay bị chặn.
    switchArmed = true;
    setTimeout(function () { switchArmed = false; }, 15000);
    // Tiêu đề phòng: giữ tên bộ (bỏ đuôi " — Tập ..."), đổi số tập
    var series = String(state.title || '').replace(/ — Tập .*$/, '');
    var title = (series ? series + ' — ' : '') + 'Tập ' + displayEp(ep.id);
    patchRoom({ url: ep.url, title: title, pos: 0, playing: true });
    document.title = title;
    var el = document.getElementById('room-label');
    if (el) el.textContent = title;
    if (typeof RoomChat !== 'undefined' && RoomChat.action) {
        RoomChat.action('đã đổi sang tập ' + displayEp(ep.id), '🎬');
    }
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
        // Setting + danh sách tập "tương tự artplayer": bánh răng setting
        // (playbackRate/aspectRatio/flip), thanh mini progress; autoPlayback
        // TẮT vì vị trí phòng do host quyết định, không resume localStorage
        setting: true,
        flip: true,
        playbackRate: true,
        aspectRatio: true,
        subtitleOffset: true,
        miniProgressBar: true,
        plugins: episodeList.length ? [
            artplayerPlaylist({
                rebuildPlayer: false,
                autoNext: true,
                showText: false,
                playlist: episodeList,
                onchanged: onPlaylistChanged,
            }),
        ] : [],
        customType: {
            m3u8: playM3u8,
            json: playJson,
        },
    });
    // type dựa trên url: json = node Firebase chứa m3u8 text, m3u8 = link trực tiếp
    // (Artplayer tự đoán theo đuôi file, customType m3u8 bắt cả link phim1280)
    void type;
    art.on('ready', applySync);

    // Nút chat trong CONTROL BAR (thay nút nổi góc phải — gọn, cùng hàng với
    // play/settings): icon SVG Material chat bubble, bật chat thì icon xanh.
    // Control bar tự ẩn khi xem phim nên không vướng màn hình.
    art.controls.add({
        name: 'chat',
        position: 'right',
        index: 2,
        html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',
        tooltip: 'Chat phòng',
        click: function () {
            var layout = document.getElementById('room-layout');
            var on = layout.classList.toggle('chat-open');
            var el = document.querySelector('.art-control-chat');
            if (el) el.classList.toggle('active', on);
            // video vừa co/giãn theo container -> bảo artplayer tính lại
            setTimeout(function () { try { art.resize(); } catch (e) { } }, 60);
        },
    });
    // Màn rộng mở sẵn sidebar (một lần duy nhất, không lặp khi đổi tập);
    // mobile đóng mặc định cho phim tràn màn, bấm nút chat khi cần
    if (!chatAutoOpened && window.innerWidth >= 900) {
        chatAutoOpened = true;
        document.getElementById('room-layout').classList.add('chat-open');
        var el0 = document.querySelector('.art-control-chat');
        if (el0) el0.classList.add('active');
        setTimeout(function () { try { art.resize(); } catch (e) { } }, 60);
    } else {
        chatAutoOpened = true;
    }
    // đổi tập khi chat đang mở -> nút giữ trạng thái active đúng
    if (document.getElementById('room-layout').classList.contains('chat-open')) {
        var el1 = document.querySelector('.art-control-chat');
        if (el1) el1.classList.add('active');
    }

    // Host phát điều khiển của MÌNH vào room node (người xem chỉ đọc):
    // play/pause/seek/hết tập — không ghi timeupdate liên tục.
    // Mỗi hành động còn ghi 1 TIN HỆ THỐNG vào chatbox (xám nghiêng) để cả
    // phòng thấy ai đang làm gì; tua nhỏ (phím ±5s) không log tránh spam.
    ['video:play', 'video:pause', 'video:seeked', 'video:ended'].forEach(function (ev) {
        art.on(ev, function () {
            // Đang chờ tập mới (host vừa đổi qua playlist) phát thật: mọi
            // event lúc load nguồn là rác (art.playing stale) — chờ video:play
            // với video KHÔNG paused mới mở khoá trở lại
            if (switchArmed) {
                if (ev === 'video:play' && !art.video.paused) switchArmed = false;
                return;
            }
            // playing lấy từ video.paused (ground truth) — art.playing là state
            // nội bộ artplayer, stale quanh lúc đổi nguồn
            patchRoom({ pos: (art.currentTime || 0), playing: !art.video.paused });
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

    // Người xem KHÔNG được tự điều khiển: play/pause/seek cục bộ bị hoàn tác
    // NGAY về trạng thái host (không đợi vòng poll 3s) — host đang pause mà
    // bấm play cũng bị dừng lại tức thì kèm notice giải thích; tua bị kéo
    // về mốc host. Volume/fullscreen là việc riêng từng máy nên không chặn.
    ['video:play', 'video:pause', 'video:seeked'].forEach(function (ev) {
        art.on(ev, function () {
            if (isHost() || !state || !loadedUrl) return;
            var wrong = false;
            if (state.playing === false && !art.video.paused) { art.pause(); wrong = true; }
            else if (state.playing === true && art.video.paused) { art.play(); wrong = true; }
            var tp = targetPos(state);
            if (tp != null && art.duration && isFinite(art.duration)
                && Math.abs(art.currentTime - tp) > 1) {
                art.currentTime = tp;
                wrong = true;
            }
            if (wrong && ev !== 'video:seeked') {
                art.notice.show = 'Phòng do host điều khiển — bạn xem theo';
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

// ── Phím tắt: volume là việc riêng từng máy; tua chỉ host (người xem bị
// khoá từ UI + hoàn tác event, tua cũng bị kéo về mốc host) ──
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
    if (isHost() && art) art.currentTime += 5;
}
function seekLeft() {
    if (isHost() && art) art.currentTime -= 5;
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
    // (nút bật/tắt nằm trong control bar artplayer — thêm ở mountPlayer)
    if (typeof RoomChat !== 'undefined') {
        RoomChat.mount(document.getElementById('chat-panel'), function () { return id; });
    }
    // Auth xác định xong uid -> đánh dấu để applyViewerLock không khoá nhầm
    // host trong khoảng auth chưa kịp restore session. Auth về MUỘN hơn
    // event 'ready' thì applySync đã chạy nhánh NGƯỜI XEM cho host (hostSynced
    // không bật -> mọi patchRoom chết im lặng) -> chạy lại nhánh host.
    if (typeof firebase !== 'undefined' && firebase.auth) {
        try {
            firebase.auth().onAuthStateChanged(function () {
                authResolved = true;
                applyViewerLock();
                if (isHost() && !hostSynced && art && loadedUrl) applySync();
            });
        } catch (e) { }
    }
});
