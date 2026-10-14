// Sảnh chờ /anime/room/ (không ?id): danh sách phòng dạng card + modal tạo
// phòng + modal mật khẩu phòng riêng. Trang room CÓ ?id là player — mọi
// logic ở đây tự tắt khi có ?id (player.js gánh).
// Schema room node mở rộng: name (tên phòng), priv (phòng riêng), pw (bcrypt
// không có nên sha256 hex mật khẩu), img (poster bộ đang chiếu).

var RTDB = 'https://r3fire.firebaseio.com';
var SHEET_ID = '12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA';
var SHEET_GID = "1193967919";

// ── Mật khẩu: sha256 hex (crypto.subtle có trên https/localhost; webview cũ
// thiếu subtle thì hash chuỗi đơn giản — cùng helper 2 phía nên vẫn khớp) ──
function sha256(s) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
            return Array.prototype.map.call(new Uint8Array(buf), function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('');
        });
    }
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return Promise.resolve('x' + h.toString(16));
}

// ── Modal mật khẩu dùng chung: card phòng riêng (sảnh) và cổng vào phòng
// khi mở link trực tiếp (player.js gọi RoomPw.ask) ──
var RoomPw = {
    open: false,
    expected: '',
    cb: null,
    ask: function (title, expected, cb) {
        if (RoomPw.open) return; // đang mở thì không mở lại (poll 3s gọi lại)
        RoomPw.open = true;
        RoomPw.expected = expected || '';
        RoomPw.cb = cb;
        var m = document.getElementById('pw-modal');
        document.getElementById('pw-title').textContent = title || 'Phòng riêng';
        document.getElementById('pw-input').value = '';
        document.getElementById('pw-err').textContent = '';
        m.classList.add('open');
        setTimeout(function () { document.getElementById('pw-input').focus(); }, 50);
    },
    close: function () {
        RoomPw.open = false;
        document.getElementById('pw-modal').classList.remove('open');
    },
    submit: function () {
        var v = document.getElementById('pw-input').value;
        sha256(v).then(function (h) {
            if (h === RoomPw.expected) {
                var cb = RoomPw.cb;
                RoomPw.close();
                if (cb) cb();
            } else {
                document.getElementById('pw-err').textContent = 'Sai mật khẩu — thử lại.';
                document.getElementById('pw-input').value = '';
            }
        });
    },
};

// ── Danh sách phòng: node room/ đọc public theo rules (SDK realtime hoặc
// GET /room.json); phòng im > 24h coi như đã tan (host đóng tab không xoá
// node), schema legacy bỏ qua ──
function ageText(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return m + ' phút trước';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' giờ trước';
    return Math.round(h / 24) + ' ngày trước';
}

var lastRooms = {}; // bản rooms mới nhất — re-render khi auth resolve (nút sửa phòng của mình)
var lastViewers = {}; // roomview/{code}/{cid} mới nhất — presence người xem (ts heartbeat)

// Số người đang xem một phòng: đếm entry có mốc ts còn tươi (60s — beat 20s
// từ player.js chịu được 2 nhịp miss; tab đóng không kịp xoá cũng tự rớt)
function countViewers(code) {
    var v = lastViewers[code];
    if (!v) return 0;
    var cut = Date.now() - 60000, n = 0;
    for (var cid in v) {
        if (v[cid] && Number(v[cid].ts) >= cut) n++;
    }
    return n;
}

// uid đang đăng nhập (null khi chưa resolve/khách) — dùng để biết card nào là
// phòng CỦA MÌNH (hiện nút sửa)
function myUid() {
    try {
        var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
        return u ? u.uid : null;
    } catch (e) { return null; }
}

// Icon SVG của phòng (nguồn duy nhất nằm trong chat.js) — nút/card không chép
// lại path và không dùng emoji
function roomIco(key, cls) {
    return (typeof RoomChat !== 'undefined' && RoomChat.ico) ? RoomChat.ico(key, cls) : '';
}

function renderRoomList(rooms) {
    lastRooms = rooms || {};
    rooms = lastRooms;
    var box = document.getElementById('room-list');
    if (!box) return;
    var me = myUid();
    var items = [];
    for (var code in rooms) {
        var r = rooms[code];
        // Phòng mới có thể CHƯA chọn phim (url/title còn là tên phòng) — vẫn
        // phải hiện trong sảnh để người khác vào chờ host chọn
        if (!r || !r.host) continue;
        var age = Date.now() - Number(r.updatedAt || 0);
        if (age > 86400000) continue;
        items.push({
            code: code, name: r.name || '', title: r.title || '', playing: !!r.playing,
            priv: !!r.priv, pw: r.pw || '', img: r.img || '', age: age,
            host: r.host || '', mine: !!me && r.host === me,
            viewers: countViewers(code),
        });
    }
    items.sort(function (a, b) { return a.age - b.age; });
    box.innerHTML = '';
    if (!items.length) {
        box.innerHTML = '<div class="room-empty">Chưa có phòng nào đang mở — bấm “Tạo phòng” để mở phòng đầu tiên.</div>';
        return;
    }
    items.slice(0, 30).forEach(function (it) {
        var d = document.createElement('div');
        d.className = 'room-card' + (it.playing ? ' live' : '') + (it.priv ? ' lock' : '');
        d.innerHTML =
            '<div class="room-card-img">' +
            (it.img ? '<img loading="lazy" alt="">' : '<div class="room-card-noimg">' + roomIco('movie') + '</div>') +
            (it.priv ? '<span class="room-card-lock">' + roomIco('lock') + '</span>' : '') +
            (it.mine ? '<span class="room-card-edit" title="Sửa phòng">' + roomIco('edit') + '</span>' : '') +
            '</div>' +
            '<div class="room-card-body">' +
            '<div class="room-card-name"></div>' +
            '<div class="room-card-title"></div>' +
            '<div class="room-card-meta"><span class="room-card-dot"></span>' +
            '<span class="room-card-status"></span>' +
            (it.viewers ? '<span class="room-card-viewers">' + roomIco('person', 'room-card-pico') + it.viewers + '</span>' : '') +
            '<span class="room-card-age"></span></div>' +
            '</div>';
        var img = d.querySelector('img');
        if (img) {
            img.src = it.img;
            img.onerror = function () { this.parentNode.innerHTML = '<div class="room-card-noimg">' + roomIco('movie') + '</div>'; };
        }
        d.querySelector('.room-card-name').textContent = it.name || ('Phòng ' + it.code);
        // Phòng chưa chọn phim: title còn là tên phòng -> ghi rõ đang chờ chọn
        d.querySelector('.room-card-title').textContent = it.title || 'Chưa chọn phim';
        d.querySelector('.room-card-status').textContent =
            !it.title ? 'Chờ chọn phim' : (it.playing ? 'Đang phát' : 'Tạm dừng');
        d.querySelector('.room-card-age').textContent = ageText(it.age);
        var editBtn = d.querySelector('.room-card-edit');
        if (editBtn) {
            editBtn.addEventListener('click', function (e) {
                e.stopPropagation(); // không vào phòng khi bấm sửa
                openRoomEdit(it);
            });
        }
        d.addEventListener('click', function () {
            if (it.priv) {
                RoomPw.ask(it.name || ('Phòng ' + it.code), it.pw, function () {
                    // ghi mốc đã qua mật khẩu để trang room khỏi hỏi lại
                    try { sessionStorage.setItem('roompw:' + it.code, it.pw); } catch (e) { }
                    window.location.href = '/anime/room/?id=' + it.code;
                });
            } else {
                window.location.href = '/anime/room/?id=' + it.code;
            }
        });
        box.appendChild(d);
    });
}

// ── Modal SỬA PHÒNG (chủ phòng): đổi tên / riêng-tư / mật khẩu. PATCH đúng
// mấy field đó, KHÔNG đụng url/pos/playing/pid (không làm gián đoạn người xem).
// Mật khẩu để trống = giữ nguyên hash cũ. ──
var editingCode = null;

function eSetStatus(s) { document.getElementById('e-status').textContent = s || ''; }

function openRoomEdit(it) {
    var u = myUid();
    if (!u || it.host !== u) return; // chỉ chủ phòng
    editingCode = it.code;
    document.getElementById('e-title').textContent = 'Sửa phòng — ' + it.code;
    document.getElementById('e-name').value = it.name || '';
    var privEl = document.getElementById('e-priv');
    var pwEl = document.getElementById('e-pw');
    privEl.checked = !!it.priv;
    pwEl.value = '';
    pwEl.style.display = privEl.checked ? 'block' : 'none';
    eSetStatus('');
    document.getElementById('edit-modal').classList.add('open');
    setTimeout(function () { document.getElementById('e-name').focus(); }, 50);
}

function closeRoomEdit() {
    document.getElementById('edit-modal').classList.remove('open');
    editingCode = null;
}

function saveRoomEdit() {
    var u = myUid();
    var code = editingCode;
    if (!u || !code) return;
    var name = (document.getElementById('e-name').value || '').trim().slice(0, 40);
    var priv = !!document.getElementById('e-priv').checked;
    var pwPlain = (document.getElementById('e-pw').value || '').trim();
    if (priv && !pwPlain && !(lastRooms[code] && lastRooms[code].pw)) {
        eSetStatus('Phòng riêng cần mật khẩu.'); return;
    }
    var btn = document.getElementById('e-save');
    btn.disabled = true;
    eSetStatus('Đang lưu…');
    var done = function () {
        btn.disabled = false;
        // tin hệ thống để người trong phòng biết phòng vừa đổi
        var nm = u.displayName || (u.email || '').split('@')[0];
        chatSys(code, nm + ' đã cập nhật phòng' + (name ? ' — ' + name : ''), 'room');
        closeRoomEdit();
        eSetStatus('');
    };
    var fail = function (e) {
        btn.disabled = false;
        eSetStatus('Lưu lỗi: ' + (e && e.message ? e.message : e));
    };
    // không đổi mật khẩu -> không gửi field pw (giữ hash cũ)
    var applyPatch = function (patch) {
        if (typeof firebase !== 'undefined' && firebase.database) {
            return firebase.database().ref('room/' + code).update(patch);
        }
        return u.getIdToken().then(function (tok) {
            return fetch(RTDB + '/room/' + code + '.json?auth=' + tok, {
                method: 'PATCH', body: JSON.stringify(patch),
            }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
        });
    };
    var patch = { name: name, priv: priv, updatedAt: Date.now() };
    var run = pwPlain
        ? sha256(pwPlain).then(function (h) { patch.pw = priv ? h : ''; return applyPatch(patch); })
        : (function () { if (!priv) patch.pw = ''; return applyPatch(patch); })();
    run.then(done).catch(fail);
}

// Tin hệ thống vào chatbox phòng (khách/rỗng thì bỏ qua im lặng)
function chatSys(code, text, icoKey) {
    var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    var nm = u ? (u.displayName || (u.email || '').split('@')[0]) : 'Ai đó';
    var entry = { uid: u ? u.uid : 'sys', name: nm, text: text, ts: Date.now(), sys: 1 };
    if (icoKey) entry.ico = icoKey;   // khoá icon SVG, render bên chat.js
    var post = function (tok) {
        return fetch(RTDB + '/chat/' + code + '.json' + (tok ? '?auth=' + tok : ''), {
            method: 'POST', body: JSON.stringify(entry),
        });
    };
    (u ? u.getIdToken() : Promise.resolve(null)).then(post).catch(function () { });
}

// GET /room.json public theo rules — fallback cho thiết bị không có SDK
function loadRoomList() {
    fetch(RTDB + '/room.json').then(function (r) { return r.json(); })
        .then(renderRoomList).catch(function () { });
}

// Presence người xem (roomview) — bản REST cho thiết bị không có SDK
function loadViewers() {
    fetch(RTDB + '/roomview.json').then(function (r) { return r.json(); })
        .then(function (v) { lastViewers = v || {}; renderRoomList(lastRooms); })
        .catch(function () { });
}

// ── Modal tạo phòng: CHỈ tên + mật khẩu (chọn phim sau, trong trang room) ──
// Sheet catalog vẫn được nạp sẵn ở đây vì RoomMoviePicker dùng chung cache.
var imageUrl = "/anime/image/r3_512.png";
var cRows = null;       // cache Sheet catalog

function fetchSheetRows() {
    var url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&tq&gid=' + SHEET_GID;
    return fetch(url).then(function (res) { return res.text(); }).then(function (txt) {
        var jsonString = txt.substring(txt.indexOf('"table":') + '"table":'.length, txt.lastIndexOf('});'))
        var data = JSON.parse(jsonString)
        var cols = data.cols.map(function (col) { return col.label; })
        return data.rows.map(function (r) {
            var row = {}
            cols.map(function (col, i) {
                var cel = r.c[i]
                row[col] = cel ? (cel.f ? cel.f : cel.v) : ''
            })
            return row
        })
    })
}

function normalizeText(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d");
}

function cSetStatus(s) { document.getElementById('c-status').textContent = s || ''; }

// ── RoomMoviePicker: modal CHỌN PHIM dùng trong TRANG ROOM (nút Chọn phim ở
// chatbox + nút trên overlay #ep-pick, chỉ chủ phòng thấy). Mở ra là có sẵn
// grid poster GỢI Ý giống trang chủ (1 bộ 1 card — gom mùa theo cột series,
// ảnh bìa qua Photon w=300), gõ tên thì chuyển sang kết quả tìm kiếm. Lazy-
// wire DOM vì khối init của sảnh bị bỏ qua khi URL có ?id. Dùng chung cache
// Sheet (cRows) với modal tạo phòng; chọn bộ xong gọi callback (player.js
// patch room node + tự phát theo lịch sử xem). ──
var RoomMoviePicker = (function () {
    var wired = false;
    var onPick = null;
    var timer = 0;
    var DEF_MAX = 24;   // số card gợi ý mặc định

    function setStatus(s) {
        var el = document.getElementById('m-status');
        if (el) el.textContent = s || '';
    }

    function setHead(s) {
        var el = document.getElementById('m-head');
        if (el) el.textContent = s || '';
    }

    // Poster nhỏ qua Photon (300px) — cùng URL với trang chủ nên trùng cache
    function thumb(u) {
        if (!u) return imageUrl;
        if (u.indexOf('http') !== 0) return u;
        return 'https://i0.wp.com/' + u.replace(/^https?:\/\//, '') + '?w=300&quality=70&ssl=1';
    }

    function hasSource(r) {
        return !!(r.playlist || r.anilist_id || r.phimapi || r.gdrive);
    }

    // Card gợi ý: gom mùa cùng bộ (cột series) còn 1 card như trang chủ —
    // dòng đại diện là mùa 1 (id == series), fallback dòng đầu. Bộ nào cũng
    // còn tìm thấy từng mùa riêng khi gõ tên.
    function defaultList() {
        var rows = (cRows || []).filter(hasSource);
        // Thứ tự như trang chủ: status giảm dần (RELEASING lên trước)
        rows.sort(function (a, b) {
            return String(b.status || '').localeCompare(String(a.status || ''));
        });
        var seen = {}, out = [];
        rows.forEach(function (r) {
            var s = String(r.series || '').trim();
            if (!s) { out.push(r); return; }
            if (seen[s]) return;
            seen[s] = true;
            var members = (cRows || []).filter(function (x) { return String(x.series || '').trim() === s; });
            out.push(members.filter(function (x) { return String(x.id) === s; })[0] || members[0] || r);
        });
        return out.slice(0, DEF_MAX);
    }

    function card(row) {
        var d = document.createElement('div');
        d.className = 'card';
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.src = thumb(row.image);
        img.onerror = function () { this.src = imageUrl; };
        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = row.name || '(không tên)';
        // Dòng phụ: năm + thể loại/trạng thái (gọn như card trang chủ)
        var bits = [row.year, row.category || row.status].filter(function (x) { return !!x; });
        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = bits.join(' · ');
        d.appendChild(img);
        d.appendChild(name);
        if (bits.length) d.appendChild(meta);
        d.addEventListener('click', function () {
            var cb = onPick;
            close();
            if (cb) cb(row);
        });
        return d;
    }

    function render(list, head) {
        var box = document.getElementById('m-results');
        if (!box) return;
        box.innerHTML = '';
        var frag = document.createDocumentFragment();
        list.slice(0, 60).forEach(function (row) { frag.appendChild(card(row)); });
        box.appendChild(frag);
        box.scrollTop = 0;
        setHead(head);
    }

    function showDefaults() {
        if (!cRows) return;
        var list = defaultList();
        render(list, 'Phim gợi ý');
        setStatus(list.length ? '' : 'Không có phim nào trong danh mục.');
    }

    function doSearch() {
        var qEl = document.getElementById('m-q');
        if (!cRows || !qEl) return;
        var q = normalizeText(qEl.value).trim();
        if (!q) { showDefaults(); return; }
        var hits = cRows.filter(function (r) { return r.name && normalizeText(r.name).indexOf(q) !== -1; });
        render(hits, 'Kết quả tìm kiếm');
        setStatus(hits.length ? hits.length + ' bộ khớp “' + qEl.value.trim() + '”' : 'Không tìm thấy bộ nào khớp.');
    }

    function close() {
        document.getElementById('movie-modal').classList.remove('open');
        onPick = null;
    }

    function wire() {
        if (wired) return;
        wired = true;
        document.getElementById('m-q').addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(doSearch, 300);
        });
        Array.prototype.forEach.call(document.querySelectorAll('#movie-modal .modal-x'), function (x) {
            x.addEventListener('click', close);
        });
        document.getElementById('movie-modal').addEventListener('click', function (e) {
            if (e.target === this) close();
        });
    }

    function open(cb) {
        var m = document.getElementById('movie-modal');
        if (!m) return;
        wire();
        onPick = cb;
        var qEl = document.getElementById('m-q');
        qEl.value = '';
        // Sheet chưa về thì khoá ô nhập: doSearch lúc cRows còn rỗng sẽ bị bỏ
        // qua im lặng (người dùng tưởng tìm không ra phim)
        qEl.disabled = !cRows;
        document.getElementById('m-results').innerHTML = '';
        m.classList.add('open');
        if (cRows) {
            showDefaults();               // mở ra là có sẵn phim gợi ý
            setTimeout(function () { qEl.focus(); }, 50);
        } else {
            setHead('Phim gợi ý');
            setStatus('Đang tải danh sách phim…');
            fetchSheetRows().then(function (r) {
                cRows = r;
                qEl.disabled = false;
                showDefaults();
                qEl.focus();
            }).catch(function () { setStatus('Tải danh sách phim lỗi — thử lại.'); });
        }
    }

    return { open: open };
})();

function myCode() {
    try {
        var c = localStorage.getItem('room:hostcode') || '';
        return /^[a-z2-9]{6}$/.test(c) ? c : '';
    } catch (e) { return ''; }
}

// Tạo phòng rồi vào thẳng trang room — phòng CHƯA có phim (host chọn phim
// trong trang room bằng nút Chọn phim). Code tái dùng localStorage room:hostcode:
// link share ổn định, mở lại là cùng phòng.
function cCreateRoom() {
    var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!u) {
        document.getElementById('c-auth').style.display = 'block';
        cSetStatus('');
        return;
    }
    var code = myCode();
    if (!code) {
        var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    }
    var nameEl = document.getElementById('c-name');
    var privEl = document.getElementById('c-priv');
    var pwEl = document.getElementById('c-pw');
    var roomName = (nameEl.value || '').trim().slice(0, 40);
    var priv = !!privEl.checked;
    var pwPlain = priv ? (pwEl.value || '').trim() : '';
    if (priv && !pwPlain) { cSetStatus('Phòng riêng cần mật khẩu.'); return; }
    cSetStatus('Đang tạo phòng…');
    sha256(pwPlain).then(function (pwHash) {
        var payload = {
            host: u.uid,
            created: Date.now(),
            url: '',
            // Tên phòng làm nhãn tạm; chọn phim xong title đổi thành tên phim
            title: roomName || ('Phòng ' + code),
            name: roomName,
            priv: priv,
            pw: priv ? pwHash : '',
            img: '',
            pid: '',
            k: '',
            pos: 0,
            playing: false,
            updatedAt: Date.now(),
        };
        return u.getIdToken().then(function (tok) {
            return fetch(RTDB + '/room/' + code + '.json?auth=' + tok, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            try { localStorage.setItem('room:hostcode', code); } catch (e) { }
            // Tin hệ thống vào chatbox phòng (xám nghiêng) — keepalive sống
            // qua lần điều hướng
            var nm = u.displayName || (u.email || '').split('@')[0];
            u.getIdToken().then(function (tok) {
                return fetch(RTDB + '/chat/' + code + '.json?auth=' + tok, {
                    method: 'POST',
                    keepalive: true,
                    body: JSON.stringify({
                        uid: u.uid, name: nm, ts: Date.now(), sys: 1, ico: 'movie',
                        text: nm + ' đã mở phòng — ' + (roomName || ('Phòng ' + code)),
                    }),
                });
            }).catch(function () { });
            window.location.href = '/anime/room/?id=' + code;
        });
    }).catch(function (e) {
        cSetStatus('Tạo phòng lỗi: ' + e.message);
    });
}

// ── Khởi động sảnh chờ (chỉ khi KHÔNG có ?id) ──
window.addEventListener('load', function () {
    if (new URLSearchParams(window.location.search).get('id')) return;

    // nhập mã phòng
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

    // modal mật khẩu
    document.getElementById('pw-btn').addEventListener('click', function () { RoomPw.submit(); });
    document.getElementById('pw-input').addEventListener('keydown', function (e) {
        if (e.isComposing === true || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); RoomPw.submit(); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pw-modal .modal-x'), function (x) {
        x.addEventListener('click', function () { RoomPw.close(); });
    });

    // modal sửa phòng (chủ phòng — nút sửa trên card của mình)
    document.getElementById('e-save').addEventListener('click', saveRoomEdit);
    document.getElementById('e-cancel').addEventListener('click', closeRoomEdit);
    Array.prototype.forEach.call(document.querySelectorAll('#edit-modal .modal-x'), function (x) {
        x.addEventListener('click', function () { closeRoomEdit(); });
    });
    document.getElementById('e-priv').addEventListener('change', function () {
        var pwEl = document.getElementById('e-pw');
        pwEl.style.display = this.checked ? 'block' : 'none';
    });
    document.getElementById('e-name').addEventListener('keydown', function (e) {
        if (e.isComposing === true || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); saveRoomEdit(); }
    });
    document.getElementById('edit-modal').addEventListener('click', function (e) {
        if (e.target === this) closeRoomEdit();
    });

    // modal tạo phòng: chỉ tên + mật khẩu, chọn phim sau khi vào phòng
    var createModal = document.getElementById('create-modal');
    document.getElementById('create-btn').addEventListener('click', function () {
        createModal.classList.add('open');
        cSetStatus('');
        setTimeout(function () { document.getElementById('c-name').focus(); }, 50);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#create-modal .modal-x'), function (x) {
        x.addEventListener('click', function () { createModal.classList.remove('open'); });
    });
    document.getElementById('c-cancel').addEventListener('click', function () {
        createModal.classList.remove('open');
    });
    document.getElementById('c-create').addEventListener('click', cCreateRoom);
    ['c-name', 'c-pw'].forEach(function (id) {
        document.getElementById(id).addEventListener('keydown', function (e) {
            if (e.isComposing === true || e.keyCode === 229) return; // IME ghép vần
            if (e.key === 'Enter') { e.preventDefault(); cCreateRoom(); }
        });
    });
    var privEl = document.getElementById('c-priv');
    privEl.addEventListener('change', function () {
        var pwEl = document.getElementById('c-pw');
        pwEl.style.display = privEl.checked ? 'block' : 'none';
    });
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (u) {
            document.getElementById('c-auth').style.display = (!u) ? 'block' : 'none';
            // auth vừa resolve -> vẽ lại list để nút sửa hiện đúng phòng CỦA MÌNH
            renderRoomList(lastRooms);
        });
    }
    // Nạp sẵn catalog Sheet cho RoomMoviePicker (dùng chung cache cRows)
    fetchSheetRows().then(function (r) { cRows = r; }).catch(function () { });

    // Danh sách phòng: SDK đẩy realtime (phòng mới mở/tan hiện tức thì);
    // TV cũ không có SDK -> GET + refresh 15s như cũ. Presence người xem
    // (roomview) đi cùng kênh: SDK lắng nghe riêng, REST poll chung nhịp 15s
    // (ts tươi 60s nên nhịp này đủ mượt cho con số đếm)
    var usedSdk = false;
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('room').on('value', function (snap) {
                renderRoomList(snap.val() || {});
            });
            firebase.database().ref('roomview').on('value', function (snap) {
                lastViewers = snap.val() || {};
                renderRoomList(lastRooms);
            });
            usedSdk = true;
        } catch (e) { }
    }
    if (!usedSdk) {
        loadRoomList();
        loadViewers();
        setInterval(loadRoomList, 15000);
        setInterval(loadViewers, 15000);
    }
});
