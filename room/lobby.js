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

// ── Danh sách phòng: GET /room.json public theo rules; phòng im > 24h coi
// như đã tan (host đóng tab không xoá node), schema legacy bỏ qua ──
function ageText(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return m + ' phút trước';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' giờ trước';
    return Math.round(h / 24) + ' ngày trước';
}

function loadRoomList() {
    fetch(RTDB + '/room.json').then(function (r) { return r.json(); }).then(function (rooms) {
        var box = document.getElementById('room-list');
        if (!box) return;
        var items = [];
        for (var code in rooms) {
            var r = rooms[code];
            if (!r || !r.url || !r.title) continue;
            var age = Date.now() - Number(r.updatedAt || 0);
            if (age > 86400000) continue;
            items.push({
                code: code, name: r.name || '', title: r.title, playing: !!r.playing,
                priv: !!r.priv, pw: r.pw || '', img: r.img || '', age: age,
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
    }).catch(function () { });
}

// ── Modal tạo phòng: tìm phim (Sheet gviz) → chọn tập → tên/mode/mật khẩu ──
// Copy pattern trang create cũ (đã gộp về đây): ưu tiên nguồn playlist >
// anilist_id > phimapi > gdrive.
var imageUrl = "/anime/image/r3_512.png";
var cRows = null;       // cache Sheet catalog
var cPickedRow = null;  // bộ đang chọn tập
var cPickedEps = [];

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

function epNum(id) { return parseFloat(String(id).replace(/_/g, '.')) || 0; }

function displayEp(id) {
    return String(id).replace(/_/g, '.').replace(/[\s._-]+end\s*$/i, '').trim();
}

function mapEpisodes(data, animeId) {
    var episodeList = [];
    data = data || {}
    Object.entries(data).forEach(function (pair) {
        var id = pair[0], episode = pair[1];
        if (!episode) return
        if (!episode.file && !episode.m3u8) return
        var file = episode.file ||
            ('https://r3fire.firebaseio.com/anime/' + animeId + '/' + id + '.json')
        id = episode.id || id
        episodeList.push({ id: id, title: episode.title, url: file, image: episode.image || '' });
    });
    episodeList.sort(function (a, b) { return epNum(a.id) - epNum(b.id); });
    return episodeList;
}

function kkphimEpisodes(data) {
    var lastNum = 0, extra = 0;
    var poster = data.movie && (data.movie.thumb_poster || data.movie.poster_url) || '';
    return (data.episodes[0].server_data || []).map(function (item) {
        var slug = item.slug || ''
        var id = 1
        var nm = (item.name || '').match(/(\d+(?:\.\d+)?)/)
        if (nm) {
            id = parseFloat(nm[1]); lastNum = id; extra = 0
        } else if (slug.indexOf("tap-") === 0) {
            var rest = slug.slice(4);
            var num = Number(rest);
            if (Number.isInteger(num)) {
                id = num; lastNum = num; extra = 0
            } else {
                id = lastNum + 0.5 + extra / 100; extra++
            }
        }
        return { id: id, title: (data.movie && data.movie.origin_name) + " - " + id, url: item.link_m3u8, image: poster };
    });
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

function cPickRow(row, cardEl) {
    var resultsEl = document.getElementById('c-results');
    Array.prototype.forEach.call(resultsEl.children, function (c) { c.classList.remove('picked'); });
    if (cardEl) cardEl.classList.add('picked');
    cPickedRow = row;
    var pid = row.playlist || row.anilist_id;
    var k = row.phimapi;
    if (!pid && !k) pid = row.gdrive;
    cSetStatus('Đang tải danh sách tập…');
    var p;
    if (pid) {
        p = fetch(RTDB + '/anime/' + pid + '.json').then(function (res) { return res.json(); })
            .then(function (data) { return mapEpisodes(data, pid); });
    } else if (k) {
        p = fetch('https://phimapi.com/phim/' + k).then(function (res) { return res.json(); })
            .then(function (data) { return kkphimEpisodes(data); });
    } else {
        p = Promise.resolve([]);
    }
    p.then(function (eps) {
        cPickedEps = eps;
        document.getElementById('c-eps-title').textContent = (row.name || '') + ' — chọn tập:';
        var grid = document.getElementById('c-ep-grid');
        grid.innerHTML = '';
        eps.forEach(function (ep) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = displayEp(ep.id);
            b.addEventListener('click', function () { cCreateRoom(ep); });
            grid.appendChild(b);
        });
        document.getElementById('c-eps').style.display = eps.length ? 'block' : 'none';
        cSetStatus(eps.length ? '' : 'Bộ này chưa có nguồn phát (chưa crawl).');
    }).catch(function () { cSetStatus('Tải danh sách tập lỗi — thử lại.'); });
}

// Tạo/cập nhật phòng rồi vào thẳng trang room. Code tái dùng localStorage
// room:hostcode: link share ổn định, chọn tập khác là cùng phòng đổi nguồn.
function cCreateRoom(ep) {
    var u = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!u) {
        document.getElementById('c-auth').style.display = 'block';
        cSetStatus('');
        return;
    }
    if (!ep || !ep.url) return;
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
    var title = (cPickedRow && cPickedRow.name ? cPickedRow.name + ' — Tập ' : 'Tập ') + displayEp(ep.id);
    var pid = cPickedRow ? (cPickedRow.playlist || cPickedRow.anilist_id) : '';
    var k = cPickedRow ? cPickedRow.phimapi : '';
    if (cPickedRow && !pid && !k) pid = cPickedRow.gdrive;
    var img = (cPickedRow && cPickedRow.image) || ep.image || '';
    cSetStatus('Đang tạo phòng…');
    sha256(pwPlain).then(function (pwHash) {
        var payload = {
            host: u.uid,
            created: Date.now(),
            url: ep.url,
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
        });
    }
    fetchSheetRows().then(function (r) { cRows = r; }).catch(function () { });

    loadRoomList();
    setInterval(loadRoomList, 15000); // phòng mới mở/tan hiện dần
});
