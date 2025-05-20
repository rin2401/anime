var video = document.getElementById('video');

function fetchData(url) {
    return fetch(url)
        .then((resp) => resp.ok && resp.arrayBuffer())
        .then((buf) => new Uint8Array(buf));
}
function waitForEvent(target, event_name) {
    return new Promise((res) => {
        target.addEventListener(event_name, res, { once: true });
    });
}

async function playM3u8(url) {
    console.log("HLS:", Hls.isSupported())
    const hlsMimeType = "application/vnd.apple.mpegurl";

    if (url.includes(".mp4")) {
        video.src = url;
        video.type = 'video/mp4';
        video.addEventListener('canplay', function () {
            video.play();
        });
    } else if (Hls.isSupported()) {
        var hls = new Hls();
        var m3u8Url = decodeURIComponent(url)
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        console.log(hls)
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play();
        });
    } else if (video.canPlayType(hlsMimeType)) {
        video.type = hlsMimeType;
        video.src = url;
        video.addEventListener('canplay', function () {
            video.play();
        });
    }
}

function playM3u8Text(m3u8Text) {
    const hlsMimeType = "application/vnd.apple.mpegurl";
    console.log("HLS m3u8 text:", Hls.isSupported())
    if (Hls.isSupported()) {
        var hls = new Hls();
        var m3u8Url = createBlobUrl(m3u8Text)
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        console.log(hls)
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play();
        });
    } else if (video.canPlayType(hlsMimeType)) {
        video.type = hlsMimeType;
        video.src = `data:${hlsMimeType};base64,${btoa(m3u8Text)}`;
        video.addEventListener('canplay', function () {
            video.play();
        });
    }
}

function playPause() {
    video.paused ? video.play() : video.pause();
}

function volumeUp() {
    if (video.volume <= 0.9) video.volume += 0.1;
}

function volumeDown() {
    if (video.volume >= 0.1) video.volume -= 0.1;
}

function seekRight() {
    video.currentTime += 5;
}

function seekLeft() {
    video.currentTime -= 5;
}

function vidFullscreen() {
    if (video.requestFullscreen) {
        video.requestFullscreen();
    } else if (video.mozRequestFullScreen) {
        video.mozRequestFullScreen();
    } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
    }
}

function createBlobUrl(data, mimeType = "application/vnd.apple.mpegurl") {
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
}


function removeAds(m3u8, url) {
    var baseUrl = url.split("/").slice(0, -1).join("/") + "/"
    m3u8 = m3u8.replace(/#EXT-X-DISCONTINUITY.*#EXT-X-DISCONTINUITY\n/sg, "");

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

video.addEventListener("seeked", () => {
    console.log(video.currentTime)
})


function loadRoom(roomId) {
    const roomRef = firebase.database().ref("room/" + roomId);
    roomRef.on('value', (data) => {
        const roomData = data.val();
        console.log(roomData)
        var url = roomData.player.url
        var t = roomData.player.time
        video.addEventListener('loadedmetadata', function () {
            const tst = Math.floor(Date.now() / 1000);

            video.currentTime = parseInt((tst + t) % parseInt(video.duration));
        });

        if (url.endsWith(".json")) {
            fetch(url).then(response => response.json()).then(function (data) {
                playM3u8Text(data.m3u8)
                if (data.title) {
                    document.title = data.title
                    setMediaSession(data.title)
                }
            })
        } else if (url.match(/.*phim1280.*\.m3u8/)) {
            fetch(url).then(response => response.text()).then(function (m3u8) {
                m3u8 = removeAds(m3u8, url)
                playM3u8Text(m3u8)
                setMediaSession("Anime Room")
            })
        } else {
            playM3u8(url)
            setMediaSession("Anime Room");
        }
    })
}

function setMediaSession(title) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artwork: [
                {
                    src: 'https://rin2401.github.io/anime/image/r3_512.png', sizes: '512x512',
                    type: 'image/png'
                },
                {
                    src: 'https://rin2401.github.io/anime/image/r3_128.png', sizes: '128x128',
                    type: 'image/png'
                },
            ]
        });
    }
}

$(window).on('load', async function () {
    // Mousetrap.bind('space', playPause);
    Mousetrap.bind('up', volumeUp);
    Mousetrap.bind('down', volumeDown);
    Mousetrap.bind('right', seekRight);
    Mousetrap.bind('left', seekLeft);
    Mousetrap.bind('f', vidFullscreen);

    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    if (id) {
        loadRoom(id);
    }
});