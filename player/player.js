var video = document.getElementById('video');

async function playVideoAudio(url, audio_url) {
    video.src = url;
    video.type = 'video/mp4';

    const audio = document.createElement('audio');
    audio.src = audio_url;
    audio.type = 'audio/mp4';
    video.appendChild(audio);

    video.addEventListener('play', () => audio.play());
    video.addEventListener('pause', () => audio.pause());
    video.addEventListener('seeking', () => {
        audio.currentTime = video.currentTime;
    });
}

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
        if (url.includes(";")) {
            [url, audio_url] = url.split(";")
            await playVideoAudio(url, audio_url);
            return;
        }

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

function seekTime() {
    if (window.location.href.split("#").length >= 3) {
        video.currentTime = Number(window.location.href.split("#")[2])
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

console.log(window.location.href.split("#"))

var url = window.location.href.split("#")[1]
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
        setMediaSession("Anime Player")
    })
} else {
    playM3u8(url)
    setMediaSession("Anime Player");

}
seekTime()


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



async function loadSavedTime() {
    const hash = await getHash(url)
    console.log("Hash:", hash)

    const STORAGE_KEY = "history";
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    console.log("History:", history)
    if (history[hash]) {
        video.currentTime = history[hash];
    }

    setInterval(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...JSON.parse(localStorage.getItem(STORAGE_KEY)),
            [hash]: parseInt(video.currentTime)
        }));
        console.log("Saved time:", parseInt(video.currentTime));
    }, 5000);
}

function getHash(str, algo = "SHA-256") {
    let strBuf = new TextEncoder().encode(str);
    return crypto.subtle.digest(algo, strBuf)
        .then(hash => {
            window.hash = hash;
            let result = '';
            const view = new DataView(hash);
            for (let i = 0; i < hash.byteLength; i += 4) {
                result += ('00000000' + view.getUint32(i).toString(16)).slice(-8);
            }
            return result;
        });
}

$(window).on('load', async function () {
    // Mousetrap.bind('space', playPause);
    Mousetrap.bind('up', volumeUp);
    Mousetrap.bind('down', volumeDown);
    Mousetrap.bind('right', seekRight);
    Mousetrap.bind('left', seekLeft);
    Mousetrap.bind('f', vidFullscreen);
    await loadSavedTime();
    setMediaSession("Anime Player");
});