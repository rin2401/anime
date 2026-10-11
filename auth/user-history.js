// Lịch sử xem per-user trên Firebase Realtime DB — node users/{uid}/history.
// Ghi/đọc bằng REST kèm idToken (không cần database SDK), chưa đăng nhập thì
// rơi về localStorage; đăng nhập xong sẽ merge các entry local MỚI HƠN cloud
// lên (trường hợp xem lúc chưa login / rules chưa cập nhật).
//
// Cần load TRƯỚC file này: firebase-app-compat.js + firebase-auth-compat.js +
// auth/auth.js (khởi tạo app). Thiếu SDK thì vẫn chạy được phần localStorage.
//
// Entry: {
//   itemKey: key ổn định của bộ ('<playlist/anilist id>' | 'kk:<slug>' | 'gd:<id>'),
//   kind:    'playlist' | 'phimapi' | 'gdrive'  -> quyết định URL mở lại,
//   key:     id/slug dùng để build link player,
//   eid:     id tập đúng như node Firebase (giữ '07_5'/'24_END' cho ?e= khớp),
//   ep:      số tập hiển thị ('12.5', strip END),
//   title, poster: denormalize để trang lịch sử render không cần join,
//   t:       giây đã xem, dur: thời lượng tập (giây), ts: ms cập nhật cuối.
// }
var UserHistory = (function () {
    var DB = 'https://r3fire.firebaseio.com';
    var LS_KEY = 'anime-history';
    var MAX_ITEMS = 200; // cap số mục trên cloud — trim phần cũ nhất
    var user = null;
    var cbs = [];

    function lsGet() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }

    function lsSet(all) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { }
    }

    // Tiến độ không lùi lại: mở lại tập cũ (t=0) không được xoá mốc đã xem sâu
    // hơn trên máy khác (vd 12') — nếu không "tiếp tục xem" sẽ mất chỗ đang xem.
    // Rewatch chủ ý (autoPlayback) cũng giữ max, cùng hành vi.
    function mergeEntry(all, entry) {
        var old = all[entry.itemKey];
        if (old && old.eid === entry.eid && (entry.t || 0) < (old.t || 0) - 5) {
            entry.t = old.t;
            if (!entry.dur) entry.dur = old.dur;
        }
        all[entry.itemKey] = entry;
    }

    function histUrl(itemKey, tok) {
        return DB + '/users/' + user.uid + '/history/' + encodeURIComponent(itemKey) +
            '.json?auth=' + tok;
    }

    // PATCH đúng node entry đơn — KHÔNG update tổng node history: update đa path
    // trong RTDB ghi đè cả node cha, xoá mất field anh em.
    function cloudSave(entry, keepalive) {
        if (!user) return Promise.resolve(false);
        return user.getIdToken().then(function (tok) {
            return fetch(histUrl(entry.itemKey, tok), {
                method: 'PATCH',
                body: JSON.stringify(entry),
                keepalive: !!keepalive, // ghi lúc đóng tab cũng cố kịp gửi
            });
        }).then(function (r) { return r.ok; })
            .catch(function () { return false; });
    }

    function cloudAll() {
        if (!user) return Promise.resolve(null);
        return user.getIdToken().then(function (tok) {
            return fetch(DB + '/users/' + user.uid + '/history.json?auth=' + tok)
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; });
        });
    }

    // Đẩy lên cloud các entry local mới hơn cloud (xem ở máy chưa login, login
    // xong kéo theo). Cloud null = đọc lỗi (vd rules chưa cho) -> giữ local,
    // lần login sau thử lại.
    function mergeLocalUp() {
        var local = lsGet();
        var keys = Object.keys(local);
        if (!user || !keys.length) return;
        return cloudAll().then(function (cloud) {
            if (!cloud || !user) return;
            var writes = [];
            keys.forEach(function (k) {
                var e = local[k];
                if (!e || !e.ts || !e.itemKey) return;
                if (!cloud[k] || (cloud[k].ts || 0) < e.ts) writes.push(cloudSave(e));
            });
            return Promise.all(writes);
        });
    }

    function trim(cloud) {
        var keys = Object.keys(cloud).sort(function (a, b) {
            return (cloud[b].ts || 0) - (cloud[a].ts || 0);
        });
        if (keys.length <= MAX_ITEMS) return Promise.resolve();
        return user.getIdToken().then(function (tok) {
            var dels = keys.slice(MAX_ITEMS).map(function (k) {
                return fetch(histUrl(k, tok), { method: 'DELETE' }).catch(function () { });
            });
            return Promise.all(dels);
        });
    }

    function save(entry, keepalive) {
        if (!entry || !entry.itemKey || !entry.key || entry.eid === undefined) return;
        entry.ts = Date.now();
        if (user) cloudSave(entry, keepalive); // async, không chặn
        var all = lsGet();
        mergeEntry(all, entry);
        lsSet(all);
    }

    // Trả object {itemKey: entry} — đã login thì lấy cloud (đồng bộ đa thiết bị),
    // đọc lỗi thì rơi về local; chưa login thì local thuần.
    function list() {
        if (user) {
            return cloudAll().then(function (cloud) {
                if (cloud) { trim(cloud); return cloud; }
                return lsGet();
            });
        }
        return Promise.resolve(lsGet());
    }

    function remove(itemKey) {
        var all = lsGet();
        delete all[itemKey];
        lsSet(all);
        if (user) {
            return user.getIdToken().then(function (tok) {
                return fetch(histUrl(itemKey, tok), { method: 'DELETE' });
            }).catch(function () { });
        }
        return Promise.resolve();
    }

    function onChange(cb) {
        cbs.push(cb);
        cb(user);
    }

    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (u) {
            user = u || null;
            if (user) mergeLocalUp();
            cbs.forEach(function (cb) { cb(user); });
        });
    }

    return {
        save: save,
        remove: remove,
        list: list,
        user: function () { return user; },
        onChange: onChange,
    };
})();
