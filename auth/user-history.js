// Lịch sử xem + yêu thích per-user trên Firebase Realtime DB — node
// users/{uid}/history và users/{uid}/favorites. Ghi/đọc bằng REST kèm idToken
// (không cần database SDK), chưa đăng nhập thì rơi về localStorage; đăng nhập
// xong sẽ merge các entry local MỚI HƠN cloud lên (trường hợp xem lúc chưa
// login / rules chưa cập nhật).
//
// Cần load TRƯỚC file này: firebase-app-compat.js + firebase-auth-compat.js +
// auth/auth.js (khởi tạo app). Thiếu SDK thì vẫn chạy được phần localStorage.
//
// Entry history: {
//   itemKey: key ổn định của bộ ('<playlist/anilist id>' | 'kk:<slug>' | 'gd:<id>'),
//   kind:    'playlist' | 'phimapi' | 'gdrive'  -> quyết định URL mở lại,
//   key:     id/slug dùng để build link player,
//   eid:     id tập đúng như node Firebase (giữ '07_5'/'24_END' cho ?e= khớp),
//   ep:      số tập hiển thị ('12.5', strip END),
//   title, poster: denormalize để trang render không cần join,
//   t:       giây đã xem, dur: thời lượng tập (giây), ts: ms cập nhật cuối.
// }
// Entry favorites: cùng shape nhưng KHÔNG t/dur (yêu thích theo BỘ, không
// theo tập — link mở lại đúng mùa/bộ tại tập đang xem lúc bấm ♥).
var UserHistory = (function () {
    var DB = 'https://r3fire.firebaseio.com';
    // store id -> {lsKey: key localStorage fallback, path: node cloud, max: cap}
    var STORES = {
        hist: { lsKey: 'anime-history', path: 'history', max: 200 },
        fav: { lsKey: 'anime-favorites', path: 'favorites', max: 500 },
    };
    var user = null;
    var cbs = [];

    function lsGet(store) {
        try { return JSON.parse(localStorage.getItem(store.lsKey) || '{}') || {}; }
        catch (e) { return {}; }
    }

    function lsSet(store, all) {
        try { localStorage.setItem(store.lsKey, JSON.stringify(all)); } catch (e) { }
    }

    // Tiến độ không lùi lại: mở lại tập cũ (t=0) không được xoá mốc đã xem sâu
    // hơn trên máy khác (vd 12') — nếu không "tiếp tục xem" sẽ mất chỗ đang xem.
    // Rewatch chủ ý (autoPlayback) cũng giữ max, cùng hành vi. Favorites không
    // có t nên biểu thức luôn false -> entry ghi đè thuần, đúng ý toggle.
    function mergeEntry(all, entry) {
        var old = all[entry.itemKey];
        if (old && old.eid === entry.eid && (entry.t || 0) < (old.t || 0) - 5) {
            entry.t = old.t;
            if (!entry.dur) entry.dur = old.dur;
        }
        all[entry.itemKey] = entry;
    }

    function nodeUrl(store, itemKey, tok) {
        return DB + '/users/' + user.uid + '/' + store.path + '/' +
            encodeURIComponent(itemKey) + '.json?auth=' + tok;
    }

    // PATCH đúng node entry đơn — KHÔNG update tổng node: update đa path trong
    // RTDB ghi đè cả node cha, xoá mất field anh em.
    function cloudSave(store, entry, keepalive) {
        if (!user) return Promise.resolve(false);
        return user.getIdToken().then(function (tok) {
            return fetch(nodeUrl(store, entry.itemKey, tok), {
                method: 'PATCH',
                body: JSON.stringify(entry),
                keepalive: !!keepalive, // ghi lúc đóng tab cũng cố kịp gửi
            });
        }).then(function (r) { return r.ok; })
            .catch(function () { return false; });
    }

    function cloudAll(store) {
        if (!user) return Promise.resolve(null);
        return user.getIdToken().then(function (tok) {
            return fetch(DB + '/users/' + user.uid + '/' + store.path + '.json?auth=' + tok)
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; });
        });
    }

    // Đẩy lên cloud các entry local mới hơn cloud (xem ở máy chưa login, login
    // xong kéo theo). Cloud null = đọc lỗi -> giữ local, lần login sau thử lại.
    function mergeLocalUp(store) {
        var local = lsGet(store);
        var keys = Object.keys(local);
        if (!user || !keys.length) return;
        return cloudAll(store).then(function (cloud) {
            if (!cloud || !user) return;
            var writes = [];
            keys.forEach(function (k) {
                var e = local[k];
                if (!e || !e.ts || !e.itemKey) return;
                if (!cloud[k] || (cloud[k].ts || 0) < e.ts) writes.push(cloudSave(store, e));
            });
            return Promise.all(writes);
        });
    }

    function trim(store, cloud) {
        var keys = Object.keys(cloud).sort(function (a, b) {
            return (cloud[b].ts || 0) - (cloud[a].ts || 0);
        });
        if (keys.length <= store.max) return Promise.resolve();
        return user.getIdToken().then(function (tok) {
            var dels = keys.slice(store.max).map(function (k) {
                return fetch(nodeUrl(store, k, tok), { method: 'DELETE' }).catch(function () { });
            });
            return Promise.all(dels);
        });
    }

    function save(store, entry, keepalive) {
        if (!entry || !entry.itemKey || !entry.key || entry.eid === undefined) return;
        entry.ts = Date.now();
        if (user) cloudSave(store, entry, keepalive); // async, không chặn
        var all = lsGet(store);
        mergeEntry(all, entry);
        lsSet(store, all);
    }

    // Trả object {itemKey: entry} — đã login thì lấy cloud (đồng bộ đa thiết
    // bị), đọc lỗi thì rơi về local; chưa login thì local thuần.
    function list(store) {
        if (user) {
            return cloudAll(store).then(function (cloud) {
                if (cloud) { trim(store, cloud); return cloud; }
                return lsGet(store);
            });
        }
        return Promise.resolve(lsGet(store));
    }

    function remove(store, itemKey) {
        var all = lsGet(store);
        delete all[itemKey];
        lsSet(store, all);
        if (user) {
            return user.getIdToken().then(function (tok) {
                return fetch(nodeUrl(store, itemKey, tok), { method: 'DELETE' });
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
            if (user) {
                mergeLocalUp(STORES.hist);
                mergeLocalUp(STORES.fav);
            }
            cbs.forEach(function (cb) { cb(user); });
        });
    }

    return {
        // lịch sử xem
        save: function (entry, keepalive) { return save(STORES.hist, entry, keepalive); },
        remove: function (itemKey) { return remove(STORES.hist, itemKey); },
        list: function () { return list(STORES.hist); },
        // yêu thích
        saveFav: function (entry) { return save(STORES.fav, entry, false); },
        removeFav: function (itemKey) { return remove(STORES.fav, itemKey); },
        listFav: function () { return list(STORES.fav); },
        isFav: function (itemKey) {
            return list(STORES.fav).then(function (all) { return !!all[itemKey]; });
        },
        user: function () { return user; },
        onChange: onChange,
    };
})();
