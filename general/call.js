import { getApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { Room, RoomEvent, Track } from "https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/+esm";

// Your Cloudflare Worker URL (see worker.js).
const TOKEN_URL = 'https://aurora-token.brodanistheman.workers.dev';
const ROOM_NAME = 'general';
const MIC_STORAGE_KEY = 'aurora_call_mic';

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const callButton = document.getElementById('call-button');

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2366665f'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let room = null;
const tiles = new Map();
const avatarCache = new Map();

/* ---------- Small helpers ---------- */
function isSafeImageSrc(src) {
    if (!src || typeof src !== 'string') return false;
    return src.startsWith('https://') || src.startsWith('http://') || src.startsWith('data:image/');
}

function getSavedMic() {
    try { return localStorage.getItem(MIC_STORAGE_KEY) || ''; } catch { return ''; }
}

function saveMic(id) {
    try { localStorage.setItem(MIC_STORAGE_KEY, id); } catch { /* ignore */ }
}

/* ---------- Build the call overlay once ---------- */
const overlay = document.createElement('div');
overlay.id = 'call-overlay';
overlay.className = 'call-overlay hidden';
overlay.setAttribute('role', 'dialog');
overlay.setAttribute('aria-label', 'Voice and video call');
overlay.innerHTML = `
    <div class="call-window">
        <header class="call-header">
            <h2 class="call-title">General call</h2>
            <span id="call-status" class="call-status">Connecting…</span>
        </header>
        <div id="call-grid" class="call-grid"></div>
        <div id="call-audio" class="hidden"></div>
        <footer class="call-controls">
            <div id="call-menu" class="call-menu hidden" role="dialog" aria-label="Audio settings">
                <label class="call-menu-label" for="call-mic-select">Microphone</label>
                <select id="call-mic-select" class="call-select"></select>
            </div>
            <div class="call-ctrl-group">
                <button id="call-mic" class="call-ctrl" type="button" aria-pressed="false" title="Mute / unmute">
                    <i class="fa-solid fa-microphone"></i>
                </button>
                <button id="call-mic-menu" class="call-ctrl call-ctrl-small" type="button" title="Choose microphone" aria-label="Choose microphone" aria-haspopup="true">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
            </div>
            <button id="call-cam" class="call-ctrl" type="button" aria-pressed="false" title="Camera on / off">
                <i class="fa-solid fa-video-slash"></i>
            </button>
            <button id="call-leave" class="call-ctrl call-leave" type="button" title="Leave call">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </footer>
    </div>
`;
document.body.appendChild(overlay);

const grid = overlay.querySelector('#call-grid');
const audioBox = overlay.querySelector('#call-audio');
const statusEl = overlay.querySelector('#call-status');
const micBtn = overlay.querySelector('#call-mic');
const micMenuBtn = overlay.querySelector('#call-mic-menu');
const camBtn = overlay.querySelector('#call-cam');
const leaveBtn = overlay.querySelector('#call-leave');
const menu = overlay.querySelector('#call-menu');
const micSelect = overlay.querySelector('#call-mic-select');

/* ---------- Profile pictures ---------- */
async function resolveAvatar(identity) {
    if (avatarCache.has(identity)) return avatarCache.get(identity);

    let src = defaultAvatar;
    try {
        const snap = await getDoc(doc(db, 'users', identity));
        const pic = snap.exists() ? snap.data().profilePic : '';
        if (isSafeImageSrc(pic)) src = pic;
    } catch (err) {
        console.error('Could not load profile picture:', err);
    }
    avatarCache.set(identity, src);
    return src;
}

function setTileAvatars(identity, imgs) {
    imgs.forEach((img) => {
        img.addEventListener('error', () => { img.src = defaultAvatar; }, { once: true });
        img.src = avatarCache.get(identity) || defaultAvatar;
    });
    resolveAvatar(identity).then((src) => imgs.forEach((img) => { img.src = src; }));
}

/* ---------- Tiles ---------- */
function ensureTile(p) {
    let tile = tiles.get(p.identity);
    if (tile) return tile;

    tile = document.createElement('div');
    tile.className = 'call-tile';

    const media = document.createElement('div');
    media.className = 'call-tile-media';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'call-avatar';
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatarWrap.appendChild(avatar);

    const label = document.createElement('span');
    label.className = 'call-tile-name';
    const smallAvatar = document.createElement('img');
    smallAvatar.className = 'call-tile-name-avatar';
    smallAvatar.alt = '';
    const nameText = document.createElement('span');
    nameText.textContent = (p.name || 'Anonymous') + (p.isLocal ? ' (you)' : '');
    label.append(smallAvatar, nameText);

    tile.append(media, avatarWrap, label);
    grid.appendChild(tile);
    tiles.set(p.identity, tile);

    setTileAvatars(p.identity, [avatar, smallAvatar]);
    return tile;
}

function removeTile(p) {
    const tile = tiles.get(p.identity);
    if (tile) tile.remove();
    tiles.delete(p.identity);
}

function attachTrack(track, participant) {
    if (track.kind === Track.Kind.Video) {
        const tile = ensureTile(participant);
        const media = tile.querySelector('.call-tile-media');
        media.querySelectorAll('video').forEach((v) => v.remove());
        const el = track.attach();
        el.className = 'call-video' + (participant.isLocal ? ' mirror' : '');
        media.appendChild(el);
        tile.classList.add('has-video');
    } else if (track.kind === Track.Kind.Audio && !participant.isLocal) {
        audioBox.appendChild(track.attach());
    }
}

function detachTrack(track) {
    track.detach().forEach((el) => {
        const tile = el.closest ? el.closest('.call-tile') : null;
        el.remove();
        if (tile && track.kind === Track.Kind.Video) tile.classList.remove('has-video');
    });
}

/* ---------- Microphone picker ---------- */
async function refreshMicList() {
    if (!room) return;

    let devices = [];
    try {
        devices = await Room.getLocalDevices('audioinput', false);
    } catch (err) {
        console.error('Could not list microphones:', err);
    }

    devices = devices.filter((d) => d.deviceId);
    micSelect.innerHTML = '';

    if (!devices.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No microphones found';
        opt.value = '';
        micSelect.appendChild(opt);
        micSelect.disabled = true;
        return;
    }

    micSelect.disabled = false;
    devices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${i + 1}`;
        micSelect.appendChild(opt);
    });

    const active = (room.getActiveDevice && room.getActiveDevice('audioinput')) || getSavedMic() || 'default';
    if (devices.some((d) => d.deviceId === active)) micSelect.value = active;
}

micSelect.addEventListener('change', async () => {
    if (!room || !micSelect.value) return;
    try {
        await room.switchActiveDevice('audioinput', micSelect.value);
        saveMic(micSelect.value);
    } catch (err) {
        console.error('Could not switch microphone:', err);
        alert('Could not switch to that microphone.');
        refreshMicList();
    }
});

function toggleMenu(show) {
    const open = typeof show === 'boolean' ? show : menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    micMenuBtn.setAttribute('aria-expanded', String(open));
    if (open) refreshMicList();
}

micMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
});

menu.addEventListener('click', (e) => e.stopPropagation());
overlay.addEventListener('click', () => toggleMenu(false));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) toggleMenu(false);
});

/* ---------- Controls ---------- */
function syncControls() {
    if (!room) return;
    const lp = room.localParticipant;
    const micOn = lp.isMicrophoneEnabled;
    const camOn = lp.isCameraEnabled;

    micBtn.setAttribute('aria-pressed', String(!micOn));
    micBtn.querySelector('i').className = micOn ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
    camBtn.setAttribute('aria-pressed', String(camOn));
    camBtn.querySelector('i').className = camOn ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';
}

micBtn.addEventListener('click', async () => {
    if (!room) return;
    try {
        await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    } catch (err) {
        console.error('Microphone error:', err);
        alert('Could not access your microphone.');
    }
    syncControls();
});

camBtn.addEventListener('click', async () => {
    if (!room) return;
    try {
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    } catch (err) {
        console.error('Camera error:', err);
        alert('Could not access your camera.');
    }
    syncControls();
});

leaveBtn.addEventListener('click', leaveCall);

/* ---------- Join / leave ---------- */
async function fetchToken() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const idToken = await user.getIdToken();
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            room: ROOM_NAME,
            name: window.currentDisplayName || user.displayName || 'Anonymous'
        })
    });

    if (!res.ok) throw new Error(`Token request failed (${res.status})`);
    return res.json(); // { token, url }
}

function updateStatus() {
    if (!room) return;
    const count = room.remoteParticipants.size + 1;
    statusEl.textContent = `${count} in call`;
}

async function joinCall() {
    if (room) return;
    overlay.classList.remove('hidden');
    statusEl.textContent = 'Connecting…';

    try {
        const { token, url } = await fetchToken();

        const savedMic = getSavedMic();
        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: savedMic ? { deviceId: { ideal: savedMic } } : undefined
        });

        room
            .on(RoomEvent.ParticipantConnected, (p) => { ensureTile(p); updateStatus(); })
            .on(RoomEvent.ParticipantDisconnected, (p) => { removeTile(p); updateStatus(); })
            .on(RoomEvent.TrackSubscribed, (track, _pub, p) => attachTrack(track, p))
            .on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track))
            .on(RoomEvent.LocalTrackPublished, (pub, p) => {
                if (pub.track) attachTrack(pub.track, p);
                syncControls();
            })
            .on(RoomEvent.LocalTrackUnpublished, (pub) => {
                if (pub.track) detachTrack(pub.track);
                syncControls();
            })
            .on(RoomEvent.TrackMuted, syncControls)
            .on(RoomEvent.TrackUnmuted, syncControls)
            .on(RoomEvent.MediaDevicesChanged, refreshMicList)
            .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                const ids = new Set(speakers.map((s) => s.identity));
                tiles.forEach((tile, id) => tile.classList.toggle('speaking', ids.has(id)));
            })
            .on(RoomEvent.Disconnected, cleanup);

        await room.connect(url, token);

        ensureTile(room.localParticipant);
        room.remoteParticipants.forEach((p) => ensureTile(p));
        updateStatus();

        try {
            await room.localParticipant.setMicrophoneEnabled(true);
        } catch (err) {
            console.error('Microphone error:', err);
            alert('Could not access your microphone. You can still listen.');
        }
        syncControls();
        refreshMicList();
    } catch (err) {
        console.error('Call error:', err);
        alert('Could not join the call.');
        leaveCall();
    }
}

function leaveCall() {
    if (room) room.disconnect();
    cleanup();
}

function cleanup() {
    room = null;
    tiles.clear();
    grid.innerHTML = '';
    audioBox.innerHTML = '';
    toggleMenu(false);
    overlay.classList.add('hidden');
}

if (callButton) callButton.addEventListener('click', joinCall);
window.addEventListener('beforeunload', () => { if (room) room.disconnect(); });