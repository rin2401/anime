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
var hostSynced = false; // host: đã áp mốc lần đầu chưa (cửa sổ mount: chặn patch pos=0 lúc autoplay trước seek)
var hostReady = false;  // host: đã rõ vai là ĐƯỢC PHÉP GHI node (dán cứng, không reset theo mount)
var lastSeekLogPos = 0; // host: mốc tua đã log chat lần gần nhất (tua nhỏ không log)
var chatAutoOpened = false; // đã tự mở sidebar chat mặc định chưa (1 lần/trang, mọi cỡ màn)
var authResolved = false; // firebase.auth đã xác định xong uid (tránh khoá nhầm host khi auth chưa về)
var episodeList = [];   // danh sách tập của bộ đang phát (nút playlist control bar)
var epsLoadedFor = ''; // pid/k đã tải tập rồi (tránh refetch mỗi lần đổi tập)
var switchArmed = false; // đang chờ tập mới phát thật sau khi host đổi tập (bỏ qua event rác lúc load nguồn)
var autoTriedFor = '';   // host: pid|k đã tự chọn tập mở màn rồi (khỏi lặp mỗi lần sync)
var lastAr = '';         // host: aspectRatio đã patch lên node lần cuối
var lastFlip = '';       // host: flip đã patch lên node lần cuối (chuỗi, '' = chưa patch)

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
// tự ngoại suy pos + (now - updatedAt)/1000 giữa 2 lần ghi.
// Quyền ghi theo hostReady (dán cứng khi host rõ vai) — KHÔNG theo hostSynced:
// hostSynced là cửa sổ mount (reset mỗi lần mountPlayer, bật lại khi ready),
// nếu event ready không bao giờ bắn (m3u8 chậm/lỗi) thì cờ kẹt false mãi và
// mọi patchRoom chết im lặng, kể cả chọn phim — đúng bug đã gặp: tin chat vẫn
// hiện (đi đường khác) mà node không đổi, người xem không theo được.
function patchRoom(patch) {
    // không có player đang mount thì không có rủi ro autoplay patch trước seek
    if (!hostSynced && !art) markHostReady();
    if (!isHost() || !hostReady) return;
    patch.updatedAt = Date.now();
    // SDK (WebSocket) tự gắn token của user đang đăng nhập — gọn hơn
    // getIdToken + fetch tay; TV cũ không có SDK thì đi REST như cũ
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('room/' + roomCode).update(patch).catch(function () { });
            return;
        } catch (e) { }
    }
    var u = firebase.auth().currentUser;
    u.getIdToken().then(function (tok) {
        return fetch(RTDB + '/room/' + roomCode + '.json?auth=' + tok, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
    }).catch(function () { });
}

// Vị trí theo host: pos + thời gian trôi từ lần host cập nhật gần nhất.
// Tốc độ (rate) nhân vào thời gian trôi — host xem 2x thì 10s sau vị trí
// của host đã đi 20s, không nhân là người xem trôi chậm dần rồi bị tua.
function targetPos(s) {
    if (!s || s.pos == null) return null;
    var pos = Number(s.pos) || 0;
    if (s.playing) pos += ((Date.now() - Number(s.updatedAt || 0)) / 1000) * (Number(s.rate) || 1);
    // Host bỏ chạy hết tập không đổi gì -> quay vòng theo duration (loop)
    var d = art ? art.duration : 0;
    if (d && d > 0 && pos > d) pos = pos % d;
    return pos;
}

// Áp state vừa nhận: đổi nguồn nếu host đổi tập, theo play/pause, seek nếu lệch.
// Host (uid trùng state.host) là nguồn sự thật — KHÔNG tự theo mình: chỉ mount
// url mới (khi đổi tập từ trang create), không play/pause cưỡng bức, không
// followPos.
// Phòng riêng: người xem đã nhập đúng mật khẩu lần này (sessionStorage) —
// host miễn, reload cùng tab không hỏi lại
function pwOk() {
    try {
        return sessionStorage.getItem('roompw:' + roomCode) === String(state.pw || '');
    } catch (e) { return false; }
}

function syncFromState() {
    if (!state) return;
    // Phòng riêng: chờ auth rõ vai (host/khách) rồi mới quyết định — nếu
    // mount ngay từ poll đầu thì khách xem lén được vài giây trước cổng
    if (state.priv && !authResolved) return;
    // Khoá điều khiển của người xem phải tính lại mỗi lần state/auth đổi, mà
    // các nhánh dưới đều có return sớm (phòng chưa chọn tập, cổng mật khẩu)
    // nên đặt ngay đây, không để cuối hàm
    applyViewerLock();
    // Auth đã rõ vai -> host đủ quyền ghi node kể cả khi player chưa mount
    markHostReady();
    // Phòng riêng (priv): người xem phải qua modal mật khẩu TRƯỚC khi mount
    // nguồn. Poll 3s gọi lại nên modal tự bật lại nếu bị đóng.
    if (state.priv && !isHost() && !pwOk()) {
        if (art) art.pause();
        if (typeof RoomPw !== 'undefined') {
            RoomPw.ask(state.name || ('Phòng ' + roomCode), String(state.pw || ''), function () {
                try { sessionStorage.setItem('roompw:' + roomCode, String(state.pw || '')); } catch (e) { }
                syncFromState();
            });
        }
        return;
    }
    if (state.url && state.url !== loadedUrl) {
        loadedUrl = state.url;
        if (state.title) {
            document.title = state.title;
            setMediaSession(state.title);
            var el = document.getElementById('room-label');
            if (el) el.textContent = state.title;
        }
        loadEpisodesThenMount(state);
    } else if (!state.url) {
        // Phòng chưa có tập: cập nhật tên phim lên header chatbox rồi
        // - chưa chọn phim  -> overlay mời host chọn phim (người xem chờ)
        // - host đã có phim -> TỰ chọn tập mở màn và phát luôn, KHÔNG hiện
        //   màn chọn tập (bộ chưa crawl ra nguồn thì overlay báo rõ)
        if (state.title) {
            document.title = state.title;
            var elu = document.getElementById('room-label');
            if (elu) elu.textContent = state.title;
        }
        if (!autoStartIfNeeded(state, false)) showEpPick();
        return;
    }
    if (!isHost() && loadedUrl && art) {
        if (state.playing === false) { if (!art.video.paused) art.pause(); }
        else if (state.playing === true) { if (art.video.paused) art.play(); }
        // tốc độ phát theo host (host đổi 2x thì người xem cũng 2x)
        var tr = Number(state.rate) || 1;
        if (art.playbackRate !== tr) art.playbackRate = tr;
        applyViewerDisplaySettings();
        followPos();
    }
}

// Giây buffer còn phía trước vị trí đang xem (0 nếu currentTime rơi ngoài
// mọi range đã đệm — tức chưa có dữ liệu tại chỗ đang đứng)
function bufferedAhead(v) {
    try {
        for (var i = 0; i < v.buffered.length; i++) {
            if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) {
                return v.buffered.end(i) - v.currentTime;
            }
        }
    } catch (e) { }
    return 0;
}

// Seek về phía host khi lệch quá 3s (đủ rộng để không dập lệnh tua của host,
// đủ chặt để người xem không trôi quá xa) — host tự là nguồn sự thật nên bỏ qua.
// Mạng chậm: đang đứng load (readyState < 3) hoặc buffer phía trước < 5s thì
// HOÃN lượt tua — tua lúc thiếu buffer chỉ tạo vòng lặp tua-đứng-tua (currentTime
// đứng nhưng targetPos vẫn trôi, 4s sau lại tua). Chờ đệm đủ mới nhảy 1 phát
// đuổi kịp → người xem trễ mượt sau host thay vì giật slideshow.
function followPos() {
    if (isHost()) return;
    var tp = targetPos(state);
    if (tp == null || !art) return;
    if (art.duration && isFinite(art.duration)
        && Math.abs(art.currentTime - tp) > 3) {
        var v = art.video;
        // Đang pause thì tua NGAY (không có gì phát để ngắt, seek còn kích
        // download tại mốc mới) — kẹt không theo được host tua trong lúc pause
        // vì video pause không tải thêm buffer, bufferedAhead mãi < 5s.
        if (!v.paused && (v.readyState < 3 || bufferedAhead(v) < 5)) return;
        art.currentTime = tp;
    }
}

// Host rõ vai là ĐÃ đủ quyền patch room node — kể cả phòng chưa mount (chưa
// chọn phim: pickEp/changeRoomMovie cần patchRoom ngay khi art còn null) hay
// state chưa kịp tải. Gọi ở applySync (player ready) VÀ ở syncFromState: auth
// có thể resolve TRƯỚC snapshot đầu tiên, lúc đó isHost() còn false nên
// applySync bị bỏ qua -> cờ không bao giờ bật, mọi patchRoom chết im lặng.
function markHostReady() {
    if (isHost()) hostReady = true;
}

// Player sẵn sàng -> đặt mốc theo host ngay lần đầu. Host: mốc pos trong node
// (vị trí lúc bấm nút xem chung từ artplayer) và KHÔNG cưỡng bức play/pause (autoplay
// sẵn trong config; play/pause sau đó là của host, patch qua listener)
function applySync() {
    if (isHost()) {
        markHostReady();
        // hết cửa sổ mount (player đã sẵn sàng, mốc sẽ được áp ngay dưới đây):
        // listener video:play/pause/seeked được phép patch pos/playing lại
        hostSynced = true;
        if (!state || !loadedUrl || !art) return;
        // host reload trang giữa lúc đang xem 2x -> áp lại tốc độ từ node
        // (ratechange nổ ra bị chặn vì rate trùng state.rate)
        var hr = Number(state.rate) || 1;
        if (art.playbackRate !== hr) art.playbackRate = hr;
        // áp lại cả tỷ lệ khung hình + xoay từ node (settings đồng bộ theo host)
        applyHostDisplaySettings();
        art.currentTime = Number(state.pos) || 0;
        lastSeekLogPos = Number(state.pos) || 0; // seek ban đầu không phải "tua"
        return;
    }
    if (!state || !loadedUrl || !art) return;
    var tp = targetPos(state);
    if (tp != null && art.duration && isFinite(art.duration)) art.currentTime = tp;
    var vr = Number(state.rate) || 1;
    if (art.playbackRate !== vr) art.playbackRate = vr;
    applyViewerDisplaySettings();
    if (state.playing === false) art.pause();
    else art.play();
}

// Tỷ lệ khung hình + lật (flip) từ state node (host ghi, mọi máy áp) —
// settings hiển thị của phòng ĐỒNG BỘ theo host: người xem bị ẩn nút settings
// nên không tự chỉnh được, chỉ nhận theo node. LƯU Ý: art.aspectRatio và
// art.flip đều là CHUỖI ('default'/'16:9', 'normal'/'horizontal'/'vertical')
// — art.flip = 90 (số) nổ "t.charAt is not a function".
function applyViewerDisplaySettings() {
    if (!art || !state) return;
    if (state.ar && String(art.aspectRatio || 'default') !== String(state.ar)) {
        art.aspectRatio = String(state.ar);
    }
    if (state.flip && String(art.flip || 'normal') !== String(state.flip)) {
        art.flip = String(state.flip);
    }
}

// Host: áp từ node + ghi mốc đã patch để poller không patch lại chính nó
function applyHostDisplaySettings() {
    if (!art || !state) return;
    // phòng cũ chưa từng ghi ar/flip -> giữ nguyên hiện trạng của player
    var ar = String(state.ar || art.aspectRatio || 'default');
    var fl = String(state.flip || art.flip || 'normal');
    if (String(art.aspectRatio || 'default') !== ar) art.aspectRatio = ar;
    if (String(art.flip || 'normal') !== fl) art.flip = fl;
    lastAr = ar;
    lastFlip = fl;
}

// Host chỉnh tỷ lệ khung hình / lật trong settings -> phát lên node cho cả
// phòng theo. Artplayer KHÔNG có event cho 2 thao tác này (aspectRatio/flip
// chỉ là setter) nên dò 2s một lần so với mốc đã patch — rẻ (đọc cục bộ) và
// không lệ event của từng bản artplayer.
function syncHostDisplaySettings() {
    if (!isHost() || !art || !state || !hostSynced) return;
    var ar = String(art.aspectRatio || 'default');
    var fl = String(art.flip || 'normal');
    if (ar === lastAr && fl === lastFlip) return;
    lastAr = ar;
    lastFlip = fl;
    patchRoom({ ar: ar, flip: fl });
}

// Tải danh sách tập của bộ (pid = key Firebase anime/, k = slug kkphim —
// do trang create ghi vào room node) rồi mới mount player kèm plugin playlist.
// Bộ cũ không có pid/k (tạo trước tính năng) -> playlist rỗng, player vẫn chạy.
// Tải danh sách tập của bộ (pid = key Firebase anime/, k = slug kkphim —
// do trang create ghi vào room node). Bộ cũ không có pid/k (tạo trước tính
// năng) -> playlist rỗng. Cache theo key để đổi tập không refetch.
function loadEpisodes(st) {
    var key = String(st.pid || '') || 'k:' + String(st.k || '');
    if (!key || key === 'k:') { episodeList = []; epsLoadedFor = ''; return Promise.resolve(); }
    if (epsLoadedFor === key) return Promise.resolve();
    var p;
    if (st.pid) {
        p = fetch(RTDB + '/anime/' + st.pid + '.json').then(r => r.json())
            .then(d => mapEpisodes(d, st.pid));
    } else {
        p = fetch('https://phimapi.com/phim/' + st.k).then(r => r.json())
            .then(d => kkphimEpisodes(d));
    }
    return p.then(function (eps) {
        episodeList = eps || [];
        epsLoadedFor = key;
    }).catch(function () {
        episodeList = [];
        epsLoadedFor = key;
    });
}

function loadEpisodesThenMount(st) {
    loadEpisodes(st).then(function () { mountPlayer(st.url); });
}

// ── Gom tập MỌI MÙA vào panel playlist (như trang artplayer) ──
// Sheet catalog là nguồn group: các dòng cùng giá trị cột `series` là các mùa
// của một bộ. Plugin render sẵn tập MÙA HIỆN TẠI; các mùa khác inject thêm
// header "Mùa N" + item tập vào .art-selector-list. Khác artplayer (bấm tập
// mùa khác = điều hướng sang URL player mùa đó): trong phòng bấm tập mùa
// khác = host PHÁT tập đó lên room node (đổi hẳn pid/k sang mùa mới), người
// xem tự mount theo — mọi máy cùng xem chung như thiết kế phòng.

// Sheet catalog đã nạp chưa (cRows là cache chung với lobby.js); chưa có thì
// tự fetch (phòng mở trực tiếp link, init sảnh không chạy)
function sheetRowsNow() {
    if (cRows) return Promise.resolve(cRows);
    if (typeof fetchSheetRows !== 'function') return Promise.resolve(null);
    return fetchSheetRows().then(function (r) { cRows = r; return r; })
        .catch(function () { return null; });
}

// Promise -> {members: [dòng Sheet các mùa], curIdx: chỉ số mùa đang phát}
// theo (year, name); null khi bộ 1 mùa / không có trong Sheet.
function currentSeriesMembers() {
    return sheetRowsNow().then(function (rows) {
        if (!rows || !state) return null;
        var pid = String(state.pid || ''), k = String(state.k || '');
        var match = null;
        rows.forEach(function (row) {
            if (pid && (String(row.playlist) == pid || String(row.gdrive) == pid
                || String(row.anilist_id) == pid)) {
                match = row;
            } else if (!pid && k && String(row.phimapi) == k) {
                match = row;
            }
        });
        if (!match) return null;
        var series = String(match.series || '').trim();
        if (!series) return null;
        var members = rows.filter(function (row) {
            return String(row.series || '').trim() == series;
        }).sort(function (a, b) {
            var ya = parseInt(a.year) || 0, yb = parseInt(b.year) || 0;
            if (ya != yb) return ya - yb;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        var curIdx = 0;
        members.forEach(function (m, i) { if (m === match) curIdx = i; });
        return { members: members, curIdx: curIdx };
    }).catch(function () { return null; });
}

// Danh sách tập của một mùa khác trong series: pid (playlist/anilist/gdrive)
// -> node Firebase anime/, slug phimapi -> kkphim — cùng map như luồng chính
function fetchMemberEpisodes(row) {
    var pid = row.playlist || row.anilist_id || row.gdrive || '';
    if (pid) {
        return fetch(RTDB + '/anime/' + pid + '.json').then(r => r.json())
            .then(d => mapEpisodes(d, pid));
    }
    if (row.phimapi) {
        return fetch('https://phimapi.com/phim/' + row.phimapi).then(r => r.json())
            .then(d => kkphimEpisodes(d));
    }
    return Promise.resolve([]);
}

// Inject header mùa + tập các mùa khác vào panel playlist của player HIỆN
// TẠI. Chốt `list` ngay đầu: chờ Sheet/xong fetch mà host đã đổi tập (player
// bị destroy tạo mới) thì list cũ lìa DOM -> bỏ qua, list mới do lần gọi sau
// của mountPlayer tự inject.
function injectSeasonList() {
    if (!art || !art.controls || !art.controls.playlist) return;
    var list = art.controls.playlist.querySelector('.art-selector-list');
    if (!list || list.querySelector('.art-season-header')) return;
    currentSeriesMembers().then(function (res) {
        if (!res || !res.members || res.members.length < 2) return;
        if (!document.contains(list) || list.querySelector('.art-season-header')) return;
        var members = res.members, curIdx = res.curIdx;
        Promise.all(members.map(function (m) {
            return members.indexOf(m) === curIdx
                ? Promise.resolve(null)
                : fetchMemberEpisodes(m).catch(function () { return []; });
        })).then(function (results) {
            if (!document.contains(list) || list.querySelector('.art-season-header')) return;
            // Khối item của plugin nằm liền nhau: mùa TRƯỚC mùa hiện tại chèn
            // trước khối (beforeRef = item đầu), mùa sau nối vào cuối panel.
            // Mùa hiện tại chỉ có header (tập do plugin render sẵn).
            var beforeRef = list.querySelector('.art-selector-item');
            members.forEach(function (m, i) {
                var after = i > curIdx;
                var label = 'Mùa ' + (i + 1);
                var header = document.createElement('div');
                header.className = 'art-season-header';
                header.textContent = label;
                list.insertBefore(header, after ? null : beforeRef);
                (results[i] || []).forEach(function (ep) {
                    var item = document.createElement('div');
                    item.className = 'art-selector-item art-season-ep';
                    item.textContent = displayEp(ep.id);
                    item.title = ep.title || '';
                    item.style.textAlign = 'left';
                    item.addEventListener('click', function (ev) {
                        ev.stopPropagation();
                        if (!isHost()) {
                            art.notice.show = 'Phòng do host điều khiển — bạn xem theo';
                            return;
                        }
                        pickSeasonEp(m, ep, label);
                    });
                    list.insertBefore(item, after ? null : beforeRef);
                });
            });
        });
    });
}

// Host bấm tập MÙA KHÁC: phòng đổi hẳn sang mùa đó — pid/k/itk theo dòng Sheet
// của mùa mới (node Firebase/slug riêng), phát tập đã bấm lên node như pickEp
// (pos 0, không theo lịch sử xem vì là mùa khác). syncFromState thấy url đổi
// -> tải lại danh sách tập theo pid mới -> mount player mới (plugin render
// đúng tập mùa mới, injectSeasonList gom lại các mùa còn lại).
function pickSeasonEp(row, ep, label) {
    if (!isHost() || !ep || !ep.url || !state) return;
    var pid = row.playlist || row.anilist_id || row.gdrive || '';
    var k = row.phimapi || '';
    var itk = rowItemKey(row);
    var title = (row.name ? row.name + ' — ' : '') + 'Tập ' + displayEp(ep.id);
    // mốc mở màn không phải thao tác tua -> không thành tin "tua tới"
    lastSeekLogPos = 0;
    switchArmed = true;
    setTimeout(function () { switchArmed = false; }, 15000);
    // reset cục bộ theo mùa mới: episodeList tải lại từ pid/k mới khi mount
    episodeList = [];
    epsLoadedFor = '';
    loadedUrl = '';
    state.url = ep.url;
    state.title = title;
    state.pid = String(pid || '');
    state.k = String(k || '');
    state.itk = itk;
    state.pos = 0;
    state.playing = true;
    patchRoom({
        url: ep.url, title: title, pid: String(pid || ''), k: String(k || ''),
        itk: itk, img: row.image || state.img || '', pos: 0, playing: true,
    });
    document.title = title;
    var el = document.getElementById('room-label');
    if (el) el.textContent = title;
    if (typeof RoomChat !== 'undefined' && RoomChat.action) {
        RoomChat.action('đã chọn tập ' + displayEp(ep.id)
            + (label ? ' (' + label + ')' : ''), 'movie');
    }
    syncFromState();
}

// Overlay "Bấm để phát" khi autoplay bị TRÌNH DUYỆT chặn (mobile/iOS: play()
// không có thao tác chạm bị từ chối). Người xem còn bị .viewer-lock tê mọi
// nút nên overlay là cửa duy nhất để bắt đầu phát trên điện thoại — chạm vào
// overlay là gesture hợp lệ nên play() được phép. Chỉ hiện khi node nói
// ĐANG PHÁT mà video đứng im đã có dữ liệu (readyState >= 2: đang load thì
// đỡ nhá — autoplay có thể tự chạy khi đủ dữ liệu), và sau khi ổn định >2.5s
// kể từ lúc mount (đỡ flash overlay trên desktop autoplay chạy bình thường).
var artMountedAt = 0;
function checkTapPlay() {
    var tp = document.getElementById('tap-play');
    if (!tp) return;
    if (!art || !state || !state.playing || !art.video || !art.video.paused
        || art.video.readyState < 2 || Date.now() - artMountedAt < 2500) {
        tp.style.display = 'none';
        return;
    }
    tp.style.display = 'flex';
}

// Overlay #ep-pick ở chế độ CHỈ BÁO TRẠNG THÁI (không có gì để bấm): dùng khi
// host chọn phim xong đang tải tập, hoặc bộ chưa crawl ra nguồn phát
function showLoading(text) {
    var pk = document.getElementById('ep-pick');
    if (!pk) return;
    if (art) {
        try { art.destroy(false); } catch (e) { }
        art = null;
    }
    loadedUrl = '';
    pk.style.display = 'flex';
    document.getElementById('ep-pick-title').textContent = text;
    document.getElementById('ep-pick-grid').innerHTML = '';
}

// Phòng CHƯA CHỌN PHIM (phòng mới tạo chỉ có tên + mật khẩu): host thấy nút
// chọn phim, người xem chờ. Phòng ĐÃ có phim thì không còn màn chọn tập nữa —
// host tự phát theo lịch sử xem (autoStartIfNeeded), đổi tập bằng playlist
// trên artplayer; người xem chỉ chờ host.
function showEpPick() {
    var pk = document.getElementById('ep-pick');
    if (!pk) return;
    if (art) {
        try { art.destroy(false); } catch (e) { }
        art = null;
    }
    loadedUrl = '';
    pk.style.display = 'flex';
    var titleEl = document.getElementById('ep-pick-title');
    var grid = document.getElementById('ep-pick-grid');
    grid.innerHTML = '';
    var hasMovie = !!(state && (state.pid || state.k));
    if (!hasMovie) {
        titleEl.textContent = isHost() ? 'Chọn phim cho phòng:' : 'Chờ host chọn phim…';
        if (isHost() && typeof RoomMoviePicker !== 'undefined') {
            var pick = document.createElement('button');
            pick.type = 'button';
            pick.id = 'ep-pick-movie';
            // Chữ giống hệt nút ở header chatbox + tiêu đề modal ("Chọn phim
            // cho phòng") — cùng một hành động thì cùng một nhãn
            pick.innerHTML = (typeof RoomChat !== 'undefined' && RoomChat.ico ? RoomChat.ico('movie') : '')
                + '<span>Chọn phim</span>';
            pick.addEventListener('click', function () { RoomMoviePicker.open(changeRoomMovie); });
            grid.appendChild(pick);
        }
        return;
    }
    titleEl.textContent = isHost() ? 'Đang tải phim…' : 'Chờ host chọn tập…';
}

// itemKey của phòng khi KHÔNG có dòng Sheet (mở lại phòng cũ, reload): ưu tiên
// itk đã ghi vào node lúc chọn phim, không có thì suy từ pid/k — bộ gdrive
// (itemKey 'gd:<id>') chỉ khớp được nếu node có itk (chọn từ Sheet luôn có)
function roomItemKey(st) {
    if (!st) return '';
    if (st.itk) return String(st.itk);
    if (st.pid) return String(st.pid);
    if (st.k) return 'kk:' + st.k;
    return '';
}

// Host vào phòng có phim nhưng chưa có tập (vừa chọn phim, hoặc mở lại phòng
// đang trong lúc tải): TỰ chọn tập mở màn rồi phát — không hiện màn chọn tập.
// force = vừa chọn phim nên phải thử lại kể cả đã thử cho bộ này rồi.
function autoStartIfNeeded(st, force) {
    if (!isHost() || !st) return false;
    var key = String(st.pid || '') + '|' + String(st.k || '');
    if (!key || key === '|') return false;         // chưa chọn phim
    if (!force && autoTriedFor === key) return true;
    autoTriedFor = key;
    showLoading('Đang tải phim…');
    autoPlayStart(roomItemKey(st));
    return true;
}

// ── CHỦ PHÒNG CHỌN PHIM cho phòng (nút Chọn phim ở header chatbox) ──
// Chọn bộ mới từ Sheet: patch room node {url:'', title, pid, k, img} → overlay
// #ep-pick hiện ra cho host chọn tập đầu (pickEp phát lên node như thường).
// Giữ nguyên host/created/name/priv/pw — không tạo phòng mới, link share không
// đổi; người xem tự thấy "Chờ host chọn tập…".
// itemKey phải TRÙNG quy ước trang chủ/artplayer (playlist > anilist_id >
// kkphim > gdrive) — lệch một chữ là tra lịch sử không ra, phòng tự phát tập 1
function rowItemKey(row) {
    if (row.playlist) return String(row.playlist);
    if (row.anilist_id) return String(row.anilist_id);
    if (row.phimapi) return 'kk:' + row.phimapi;
    if (row.gdrive) return 'gd:' + row.gdrive;
    return '';
}

// Tập phát đầu tiên sau khi host chọn phim: theo lịch sử xem CỦA CHÍNH HOST —
// đang xem dở thì tiếp tục đúng tập + mốc giây, xem gần hết tập (còn < 60s)
// thì sang tập kế, chưa xem bao giờ thì tập đầu tiên.
function historyStartEp(itemKey) {
    var first = episodeList.length ? { ep: episodeList[0], pos: 0 } : null;
    if (!itemKey || typeof UserHistory === 'undefined') return Promise.resolve(first);
    return UserHistory.list().then(function (all) {
        var h = all && all[itemKey];
        if (!h || !h.eid) return first;
        var idx = -1;
        episodeList.forEach(function (ep, i) {
            if (String(ep.id) === String(h.eid)) idx = i;
        });
        if (idx < 0) return first; // tập đã xem không còn trong danh sách
        var t = Number(h.t) || 0, dur = Number(h.dur) || 0;
        if (dur && t >= dur - 60 && idx + 1 < episodeList.length) {
            return { ep: episodeList[idx + 1], pos: 0 };
        }
        return { ep: episodeList[idx], pos: t };
    }).catch(function () { return first; });
}

// Chọn phim cho phòng: ghi pid/k + itk (itemKey để tra lịch sử khi mở lại) vào
// node rồi PHÁT LUÔN — không còn màn chọn tập, host vào xem ngay; đổi tập sau
// đó bằng playlist trên artplayer.
function changeRoomMovie(row) {
    if (!isHost() || !row || !state) return;
    var pid = row.playlist || row.anilist_id || row.gdrive || '';
    var k = row.phimapi || '';
    var itemKey = rowItemKey(row);
    var title = row.name || 'Phòng xem chung';
    // reset cục bộ để tải lại danh sách tập + mount lại từ đầu cho bộ mới
    episodeList = [];
    epsLoadedFor = '';
    loadedUrl = '';
    state.url = '';
    state.title = title;
    state.pid = String(pid || '');
    state.k = String(k || '');
    state.itk = itemKey;
    state.pos = 0;
    state.playing = false;
    patchRoom({
        url: '', title: title, pid: String(pid || ''), k: String(k || ''),
        itk: itemKey, img: row.image || '', pos: 0, playing: false,
    });
    document.title = title;
    var el = document.getElementById('room-label');
    if (el) el.textContent = title;
    if (typeof RoomChat !== 'undefined' && RoomChat.action) {
        RoomChat.action('đã chọn phim — ' + title, 'movie');
    }
    autoStartIfNeeded(state, true);
}

// Tải danh sách tập của bộ vừa chọn rồi phát tập mở màn (lịch sử xem của host)
function autoPlayStart(itemKey) {
    loadEpisodes(state).then(function () {
        if (state.url) return; // đã có tập khác đang phát trong lúc chờ
        if (!episodeList.length) { showLoading('Bộ này chưa có nguồn phát (chưa crawl).'); return; }
        return historyStartEp(itemKey).then(function (sel) {
            if (sel && !state.url) pickEp(sel.ep, sel.pos);
        });
    });
}

// Host bấm tập trong #ep-pick: phát lên room node + mount ngay (không đợi
// poll 3s) — cùng pattern onPlaylistChanged. startPos = giây tiếp tục (khi
// phát theo lịch sử xem), mặc định 0.
function pickEp(ep, startPos) {
    if (!isHost() || !ep || !ep.url) return;
    var pos = Math.max(0, Number(startPos) || 0);
    // mốc mở màn không phải thao tác tua của host -> không ghi tin "tua tới"
    lastSeekLogPos = pos;
    switchArmed = true;
    setTimeout(function () { switchArmed = false; }, 15000);
    var series = String(state.title || '').replace(/ — Tập .*$/, '');
    var title = (series ? series + ' — ' : '') + 'Tập ' + displayEp(ep.id);
    // cập nhật state cục bộ để syncFromState mount ngay + applySync seek đúng
    state.url = ep.url;
    state.title = title;
    state.pos = pos;
    state.playing = true;
    patchRoom({ url: ep.url, title: title, pos: pos, playing: true });
    document.title = title;
    var el = document.getElementById('room-label');
    if (el) el.textContent = title;
    var pk = document.getElementById('ep-pick');
    if (pk) pk.style.display = 'none';
    if (typeof RoomChat !== 'undefined' && RoomChat.action) {
        RoomChat.action('đã chọn tập ' + displayEp(ep.id)
            + (pos > 0 ? ' — tiếp tục từ ' + hhmmss(pos) : ''), 'movie');
    }
    syncFromState();
}

// mm:ss cho tin hệ thống chatbox (mốc tiếp tục xem)
function hhmmss(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m < 60) return m + ':' + (r < 10 ? '0' : '') + r;
    return Math.floor(m / 60) + ':' + ((m % 60) < 10 ? '0' : '') + (m % 60) + ':' + (r < 10 ? '0' : '') + r;
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
        RoomChat.action('đã đổi sang tập ' + displayEp(ep.id), 'movie');
    }
}

// Bật sidebar chat mặc định (1 lần/trang): gọi ở mountPlayer cho phòng đã có
// tập, và gọi ngay lúc init cho phòng CHƯA có tập (host vừa chọn bộ mới, chưa
// chọn tập -> không mount player -> nếu chỉ móc ở mountPlayer thì chat im lặng
// không tự mở, nhất là trên mobile)
function autoOpenChat() {
    if (chatAutoOpened) return;
    chatAutoOpened = true;
    var layout = document.getElementById('room-layout');
    if (layout) layout.classList.add('chat-open');
    var btn = document.querySelector('.art-control-chat');
    if (btn) btn.classList.add('active');
    if (art) setTimeout(function () { try { art.resize(); } catch (e) { } }, 60);
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
    artMountedAt = Date.now();
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
    // Mở sẵn sidebar chat mặc định ở MỌI cỡ màn (một lần duy nhất, không lặp
    // khi đổi tập) — mobile user muốn chat bật ngay (kiểu live stream);
    // mobile đóng chat thì video chiếm trọn màn hình (CSS #video-area flex:1)
    autoOpenChat();
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
            // Cửa sổ mount (hostSynced false tới khi applySync áp mốc xong):
            // chặn patch pos/playing khỏi đè mốc node lúc autoplay mở nguồn
            if (!isHost() || !hostSynced) return;
            // playing lấy từ video.paused (ground truth) — art.playing là state
            // nội bộ artplayer, stale quanh lúc đổi nguồn
            patchRoom({ pos: (art.currentTime || 0), playing: !art.video.paused });
            if (typeof RoomChat === 'undefined' || !RoomChat.action) return;
            if (ev === 'video:play') RoomChat.action('đã phát tiếp', 'play');
            else if (ev === 'video:pause') RoomChat.action('đã tạm dừng', 'pause');
            else if (ev === 'video:ended') RoomChat.action('đã xem hết tập', 'movie');
            else {
                var cur = art.currentTime || 0;
                if (Math.abs(cur - lastSeekLogPos) > 30) {
                    RoomChat.action('đã tua tới ' + mmss(cur), 'seek');
                    lastSeekLogPos = cur;
                }
            }
        });
    });

    // Host chỉnh tốc độ phát (settings playbackRate) -> phát lên node để
    // người xem theo (art.playbackRate + targetPos nhân rate). Event này nổ
    // cả lúc nguồn mới được load (rate reset về 1) và lúc MÌNH áp rate từ
    // node (reload/đổi tập xong applySync áp lại) nên chỉ tính event khi
    // player đã ổn (hết cửa sổ mount + switch) VÀ rate khác state.rate —
    // tránh vòng lặp patch và spam tin chatbox.
    art.on('video:ratechange', function () {
        if (!isHost() || switchArmed || !hostSynced) return;
        var r = art.playbackRate;
        if (!r || r === (Number(state.rate) || 1)) return;
        patchRoom({ rate: r, pos: (art.currentTime || 0), playing: !art.video.paused });
        if (typeof RoomChat !== 'undefined' && RoomChat.action) {
            RoomChat.action('đã chỉnh tốc độ ' + r + 'x', 'rate');
        }
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

    // Panel playlist: gom thêm tập các MÙA KHÁC của cùng bộ (header "Mùa N")
    // như trang artplayer — host bấm tập mùa khác thì phòng đổi hẳn sang mùa đó
    injectSeasonList();
}

// 123 -> "2:03" cho tin hệ thống "đã tua tới"
function mmss(s) {
    s = Math.max(0, Math.round(s || 0));
    var m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + ('0' + ss).slice(-2);
}

// Link share phòng = chính URL của trang (thanh địa chỉ) — host copy từ đó,
// không cần nút/panel share riêng.

// Copy chuỗi vào clipboard: API mới fail (webview cũ / không focus) thì
// fallback textarea + execCommand cũ kỹ — callback báo thành/bại để UI flash
function copyText(txt, cb) {
    var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { }
        document.body.removeChild(ta);
        cb(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { cb(true); }, fallback);
    } else {
        fallback();
    }
}

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

// ── Nhận state (lớp FALLBACK REST cho thiết bị không có Firebase SDK) ──
// Loại event nằm ở TÊN event SSE ('put'/'patch'), không có trong payload
// (payload chỉ có {path, data}). Thiết bị có SDK dùng WebSocket của SDK.
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
    // Ưu tiên Firebase SDK (WebSocket): đẩy state tức thì, tự reconnect và
    // tự resync khi tab quay lại foreground — không cần poll dày. Poll chỉ
    // còn làm heartbeat 30s dự phòng (webview lạ làm chết socket im lặng).
    // Không có SDK (TV rất cũ không tải được script) -> SSE + poll 3s như cũ.
    var usedSdk = false;
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('room/' + code).on('value', function (snap) {
                var data = snap.val();
                if (JSON.stringify(data) === JSON.stringify(state)) return;
                state = data || null;
                syncFromState();
            }, function (err) { /* mất quyền/mạng: heartbeat gánh */ });
            usedSdk = true;
        } catch (e) { }
    }
    if (!usedSdk) {
        if (typeof EventSource !== 'undefined') {
            var es = new EventSource(RTDB + '/room/' + code + '.json');
            ['put', 'patch'].forEach(function (ev) {
                es.addEventListener(ev, function (e) {
                    try { onStateEvent(ev, JSON.parse(e.data)); } catch (err) { }
                });
            });
            es.onerror = function () { /* EventSource tự reconnect; poll gánh phía sau */ };
        }
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
    }, usedSdk ? 30000 : 3000);
    // Vòng kéo theo host giữa các update (host đang phát thì không ghi liên tục)
    setInterval(followPos, 4000);
    // Host chỉnh tỷ lệ khung hình / xoay trong settings -> dò 2s phát lên node
    setInterval(syncHostDisplaySettings, 2000);
    // Overlay "Bấm để phát" khi autoplay bị chặn (mobile) — dò 2s cho cả 2 vai
    setInterval(checkTapPlay, 2000);
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
        // Sảnh chờ (không ?id): lobby.js gánh toàn bộ (card phòng, modal tạo
        // phòng, modal mật khẩu) — player.js chỉ việc hiện overlay
        var join = document.getElementById('room-join');
        if (join) join.style.display = 'block';
        return;
    }
    var codeLabel = document.getElementById('room-code');
    if (codeLabel) codeLabel.textContent = id;
    roomCode = id;
    watchRoom(id);
    // Dự phòng: auth chết/không tải được thì phòng riêng vẫn phải dùng được
    // (sau 5s coi như đã rõ vai — host sẽ đi qua cổng mật khẩu như khách)
    setTimeout(function () {
        if (!authResolved) { authResolved = true; syncFromState(); }
    }, 5000);
    // Chat: dùng chung room/chat.js, panel nằm trong sidebar #chat-side
    // (nút bật/tắt nằm trong control bar artplayer — thêm ở mountPlayer)
    if (typeof RoomChat !== 'undefined') {
        RoomChat.mount(document.getElementById('chat-panel'), function () { return id; });
    }
    // Mở chat ngay từ đầu — phòng chưa chọn tập không mount player nên không
    // đi qua autoOpenChat() trong mountPlayer
    autoOpenChat();
    // Nạp sẵn catalog Sheet cho modal CHỌN PHIM: khối init của sảnh bị bỏ qua
    // khi URL có ?id nên nếu đợi tới lúc mở modal mới fetch thì grid gợi ý
    // hiện trễ vài giây
    if (typeof fetchSheetRows === 'function') {
        fetchSheetRows().then(function (r) { cRows = r; }).catch(function () { });
    }
    // Nút Chọn phim ở header chatbox — CHỈ chủ phòng thấy (CSS .viewer-lock
    // ẩn với người xem; changeRoomMovie tự chặn nếu không phải host)
    var changeMovieBtn = document.getElementById('chat-change-movie');
    if (changeMovieBtn) {
        changeMovieBtn.addEventListener('click', function () {
            if (!isHost()) return;
            if (typeof RoomMoviePicker === 'undefined') return;
            RoomMoviePicker.open(changeRoomMovie);
        });
    }
    // Overlay "Bấm để phát" (autoplay bị chặn trên mobile): chạm = gesture
    // hợp lệ nên play() được phép — người xem tua về mốc host rồi phát
    var tapPlay = document.getElementById('tap-play');
    if (tapPlay) {
        tapPlay.addEventListener('click', function () {
            if (!art || !state) return;
            if (!isHost()) {
                var tpv = targetPos(state);
                if (tpv != null && art.duration && isFinite(art.duration)) {
                    art.currentTime = tpv;
                }
            }
            art.play();
            tapPlay.style.display = 'none';
        });
    }
    // Mã QR link phòng + copy mã phòng (header chatbox): QR sinh CỤC BỘC bằng
    // qrcode-generator vendored (room/qrcode.min.js) — link phòng không đi qua
    // dịch vụ QR ngoài. Cả host lẫn người xem đều dùng được (chia sẻ).
    var qrBtn = document.getElementById('chat-qr');
    var copyBtn = document.getElementById('chat-copy');
    if (qrBtn || copyBtn) {
        var roomLink = location.origin + location.pathname + '?id=' + encodeURIComponent(roomCode);
        var qrPop = document.getElementById('qr-pop');
        if (qrBtn && qrPop) {
            qrBtn.addEventListener('click', function () {
                var on = qrPop.classList.toggle('open');
                if (on && !qrPop.getAttribute('data-built')) {
                    qrPop.setAttribute('data-built', '1');
                    try {
                        var qr = window.qrcode(0, 'M'); // typeNumber 0 = tự chọn size nhỏ nhất vừa
                        qr.addData(roomLink);
                        qr.make();
                        qrPop.innerHTML = qr.createImgTag(4, 8) // cellSize 4, margin 8 (quiet zone)
                            + '<div class="qr-cap">Quét để vào phòng</div>';
                    } catch (e) {
                        qrPop.textContent = 'Không tạo được mã QR';
                    }
                }
            });
        }
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                copyText(roomCode, function (ok) {
                    copyBtn.classList.toggle('ok', ok);
                    copyBtn.title = ok ? 'Đã copy: ' + roomCode : 'Không copy được';
                    setTimeout(function () {
                        copyBtn.classList.remove('ok');
                        copyBtn.title = 'Copy mã phòng';
                    }, 1500);
                });
            });
        }
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
                // applySync tự xử lý art chưa mount (phòng chưa chọn tập)
                if (isHost() && !hostSynced) applySync();
                // Đánh giá lại syncFromState khi auth rõ vai: cổng mật khẩu
                // phòng riêng (poll chỉ gọi khi dữ liệu ĐỔI nên lần đầu chạy
                // lúc auth chưa resolve bị bỏ lỡ) + mount phòng riêng đang chờ
                syncFromState();
            });
        } catch (e) { }
    }
});
