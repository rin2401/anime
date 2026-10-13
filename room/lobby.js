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

var lastRooms = {}; // bản rooms mới nhất — re-render khi auth resolve (nút ✏️ phòng của mình)

// uid đang đăng nhập (null khi chưa resolve/khách) — dùng để biết card nào là
// phòng CỦA MÌNH (hiện nút sửa)
function myUid() {
    try {
        var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
        return u ? u.uid : null;
    } catch (e) { return null; }
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
        if (!r || !r.url || !r.title) continue;
        var age = Date.now() - Number(r.updatedAt || 0);
        if (age > 86400000) continue;
        items.push({
            code: code, name: r.name || '', title: r.title, playing: !!r.playing,
            priv: !!r.priv, pw: r.pw || '', img: r.img || '', age: age,
            host: r.host || '', mine: !!me && r.host === me,
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
            (it.img ? '<img loading="lazy" alt="">' : '<div class="room-card-noimg">🎬</div>') +
            (it.priv ? '<span class="room-card-lock">🔒</span>' : '') +
            (it.mine ? '<span class="room-card-edit" title="Sửa phòng">✏️</span>' : '') +
            '</div>' +
            '<div class="room-card-body">' +
            '<div class="room-card-name"></div>' +
            '<div class="room-card-title"></div>' +
            '<div class="room-card-meta"><span class="room-card-dot"></span>' +
            '<span class="room-card-status"></span><span class="room-card-age"></span></div>' +
            '</div>';
        var img = d.querySelector('img');
        if (img) {
            img.src = it.img;
            img.onerror = function () { this.parentNode.innerHTML = '<div class="room-card-noimg">🎬</div>'; };
        }
        d.querySelector('.room-card-name').textContent = it.name || ('Phòng ' + it.code);
        d.querySelector('.room-card-title').textContent = it.title;
        d.querySelector('.room-card-status').textContent = it.playing ? 'Đang phát' : 'Tạm dừng';
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
        chatSys(code, '🛠 ' + nm + ' đã cập nhật phòng' + (name ? ' — ' + name : ''));
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
function chatSys(code, text) {
    var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    var nm = u ? (u.displayName || (u.email || '').split('@')[0]) : 'Ai đó';
    var entry = { uid: u ? u.uid : 'sys', name: nm, text: text, ts: Date.now(), sys: 1 };
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

// ── Modal tạo phòng: tìm phim (Sheet gviz) → chọn tập → tên/mode/mật khẩu ──
// Copy pattern trang create cũ (đã gộp về đây): ưu tiên nguồn playlist >
// anilist_id > phimapi > gdrive. Danh sách tập do player.js tự tải trong
// trang room (pid/k ghi vào node) — lobby không cần map tập nữa.
var imageUrl = "/anime/image/r3_512.png";
var cRows = null;       // cache Sheet catalog
var cPickedRow = null;  // bộ đang chọn

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

function myCode() {
    try {
        var c = localStorage.getItem('room:hostcode') || '';
        return /^[a-z2-9]{6}$/.test(c) ? c : '';
    } catch (e) { return ''; }
}

function renderCResults(list) {
    var resultsEl = document.getElementById('c-results');
    resultsEl.innerHTML = '';
    list.slice(0, 24).forEach(function (row) {
        var d = document.createElement('div');
        d.className = 'card';
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.src = row.image || imageUrl;
        img.onerror = function () { this.src = imageUrl; };
        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = row.name || '(không tên)';
        d.appendChild(img);
        d.appendChild(name);
        d.addEventListener('click', function () { cPickRow(row, d); });
        resultsEl.appendChild(d);
    });
    cSetStatus(list.length ? '' : 'Không tìm thấy bộ nào khớp.');
}

function cDoSearch() {
    if (!cRows) return;
    var qEl = document.getElementById('c-q');
    var nq = normalizeText(qEl.value).trim();
    if (!nq) { document.getElementById('c-results').innerHTML = ''; return; }
    renderCResults(cRows.filter(function (r) { return r.name && normalizeText(r.name).indexOf(nq) !== -1; }));
}

// Chọn bộ là VÀO PHÒNG NGAY — host chọn tập SAU trong trang room (overlay
// #ep-pick của player.js), không còn bước chọn tập ở modal.
function cPickRow(row, cardEl) {
    var resultsEl = document.getElementById('c-results');
    Array.prototype.forEach.call(resultsEl.children, function (c) { c.classList.remove('picked'); });
    if (cardEl) cardEl.classList.add('picked');
    cPickedRow = row;
    cCreateRoom();
}

// Tạo/cập nhật phòng rồi vào thẳng trang room. Code tái dùng localStorage
// room:hostcode: link share ổn định, chọn bộ khác là cùng phòng đổi nguồn.
// url để RỖNG — phòng mở chưa có tập, host chọn trong trang room.
function cCreateRoom() {
    var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!u) {
        document.getElementById('c-auth').style.display = 'block';
        cSetStatus('');
        return;
    }
    if (!cPickedRow) return;
    var hadCode = !!myCode();
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
    var title = cPickedRow.name || 'Phòng xem chung';
    var pid = cPickedRow.playlist || cPickedRow.anilist_id;
    var k = cPickedRow.phimapi;
    if (!pid && !k) pid = cPickedRow.gdrive;
    var img = cPickedRow.image || '';
    cSetStatus('Đang tạo phòng…');
    sha256(pwPlain).then(function (pwHash) {
        var payload = {
            host: u.uid,
            created: Date.now(),
            url: '',
            title: title,
            name: roomName,
            priv: priv,
            pw: priv ? pwHash : '',
            img: img,
            pid: String(pid || ''),
            k: String(k || ''),
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
            var text = (hadCode ? '🎬 ' + nm + ' đã đổi sang ' : '🎬 ' + nm + ' đã mở phòng — ') + title;
            u.getIdToken().then(function (tok) {
                return fetch(RTDB + '/chat/' + code + '.json?auth=' + tok, {
                    method: 'POST',
                    keepalive: true,
                    body: JSON.stringify({ uid: u.uid, name: nm, text: text, ts: Date.now(), sys: 1 }),
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

    // modal sửa phòng (chủ phòng — nút ✏️ trên card của mình)
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

    // modal tạo phòng
    var createModal = document.getElementById('create-modal');
    document.getElementById('create-btn').addEventListener('click', function () {
        createModal.classList.add('open');
        setTimeout(function () { document.getElementById('c-q').focus(); }, 50);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#create-modal .modal-x'), function (x) {
        x.addEventListener('click', function () { createModal.classList.remove('open'); });
    });
    var privEl = document.getElementById('c-priv');
    privEl.addEventListener('change', function () {
        var pwEl = document.getElementById('c-pw');
        pwEl.style.display = privEl.checked ? 'block' : 'none';
    });
    var qEl = document.getElementById('c-q');
    var searchTimer = 0;
    qEl.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(cDoSearch, 300);
    });
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (u) {
            document.getElementById('c-auth').style.display = (!u) ? 'block' : 'none';
            // auth vừa resolve -> vẽ lại list để nút ✏️ hiện đúng phòng CỦA MÌNH
            renderRoomList(lastRooms);
        });
    }
    fetchSheetRows().then(function (r) { cRows = r; }).catch(function () { });

    // Danh sách phòng: SDK đẩy realtime (phòng mới mở/tan hiện tức thì);
    // TV cũ không có SDK -> GET + refresh 15s như cũ
    var usedSdk = false;
    if (typeof firebase !== 'undefined' && firebase.database) {
        try {
            firebase.database().ref('room').on('value', function (snap) {
                renderRoomList(snap.val() || {});
            });
            usedSdk = true;
        } catch (e) { }
    }
    if (!usedSdk) {
        loadRoomList();
        setInterval(loadRoomList, 15000);
    }
});
