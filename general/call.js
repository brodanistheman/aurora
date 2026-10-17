import { getApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc, setDoc, collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { Room, RoomEvent, Track } from "https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/+esm";

// Your Cloudflare Worker URL (see worker.js).
const TOKEN_URL = 'https://aurora-token.brodanistheman.workers.dev';
const ROOM_NAME = 'general';
const SETTINGS_KEY = 'aurora_call_settings';
const HOLD_MS = 450;
const IN_CALL_HEARTBEAT_MS = 20000;
const IN_CALL_STALE_MS = 90000;

const STREAM_PRESETS = {
    '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 },
    '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 5000000 },
    '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8000000 }
};

const DEFAULT_SETTINGS = {
    mic: '',
    speaker: '',
    camera: '',
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    joinMuted: false,
    streamQuality: '1080p30',
    streamAudio: true
};

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const callButton = document.getElementById('call-button');
const callButtonLabel = document.getElementById('call-button-label');

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2366665f'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let room = null;
let deafened = false;
let micWasOn = false;
let pinnedKey = null;
let heartbeat = null;
let callCount = 0;
let statusDocs = [];

const tiles = new Map();      // key -> element
const tileInfo = new Map();   // key -> { identity, name, isLocal, isStream }
const profileCache = new Map();
const audioState = new Map(); // key -> { volume, muted }

/* ---------- Settings ---------- */
function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

let settings = loadSettings();

/* ---------- Helpers ---------- */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function isSafeImageSrc(src) {
    if (!src || typeof src !== 'string') return false;
    return src.startsWith('https://') || src.startsWith('http://') || src.startsWith('data:image/');
}

function getAudioState(key) {
    if (!audioState.has(key)) audioState.set(key, { volume: 1, muted: false });
    return audioState.get(key);
}

/* ---------- Overlay ---------- */
const overlay = el('div', 'call-overlay hidden');
overlay.id = 'call-overlay';
overlay.setAttribute('role', 'dialog');
overlay.setAttribute('aria-label', 'Voice and video call');
overlay.innerHTML = `
    <div class="call-window">
        <header class="call-header">
            <h2 class="call-title">General call</h2>
            <div class="call-header-right">
                <span id="call-status" class="call-status">Connecting…</span>
                <button id="call-minimize" class="icon-btn" type="button" title="Minimize (stay in call)" aria-label="Minimize call">
                    <i class="fa-solid fa-minus"></i>
                </button>
            </div>
        </header>

        <div id="call-grid" class="call-grid"></div>
        <div id="call-audio" class="hidden"></div>

        <div id="call-usermenu" class="call-usermenu hidden" role="menu"></div>

        <footer class="call-controls">
            <div id="call-menu" class="call-menu hidden" role="dialog" aria-label="Voice settings">
                <div class="call-menu-section">
                    <label class="call-menu-label" for="set-mic">Microphone</label>
                    <select id="set-mic" class="call-select"></select>
                </div>
                <div id="set-speaker-section" class="call-menu-section">
                    <label class="call-menu-label" for="set-speaker">Speaker</label>
                    <select id="set-speaker" class="call-select"></select>
                </div>
                <div class="call-menu-section">
                    <label class="call-menu-label" for="set-camera">Camera</label>
                    <select id="set-camera" class="call-select"></select>
                </div>
                <div class="call-menu-section">
                    <span class="call-menu-label">Voice processing</span>
                    <label class="call-check"><input type="checkbox" id="set-ns"> Noise suppression</label>
                    <label class="call-check"><input type="checkbox" id="set-echo"> Echo cancellation</label>
                    <label class="call-check"><input type="checkbox" id="set-agc"> Automatic gain control</label>
                    <label class="call-check"><input type="checkbox" id="set-join-muted"> Join with microphone muted</label>
                </div>
                <div class="call-menu-section">
                    <label class="call-menu-label" for="set-stream-quality">Streaming</label>
                    <select id="set-stream-quality" class="call-select">
                        <option value="720p30">720p · 30 fps</option>
                        <option value="1080p30">1080p · 30 fps</option>
                        <option value="1080p60">1080p · 60 fps</option>
                    </select>
                    <label class="call-check"><input type="checkbox" id="set-stream-audio"> Share audio when streaming</label>
                </div>
                <p class="call-menu-hint">Tip: hold the microphone button to open this menu. Click a person to adjust their volume.</p>
            </div>

            <button id="call-mic" class="call-ctrl" type="button" aria-pressed="false" title="Click to mute · hold to change microphone">
                <i class="fa-solid fa-microphone"></i>
            </button>
            <button id="call-deafen" class="call-ctrl" type="button" aria-pressed="false" title="Deafen (mutes everyone and your mic)">
                <i class="fa-solid fa-headphones"></i>
            </button>
            <button id="call-cam" class="call-ctrl" type="button" aria-pressed="false" title="Camera on / off">
                <i class="fa-solid fa-video-slash"></i>
            </button>
            <button id="call-stream" class="call-ctrl" type="button" title="Share your screen">
                <i class="fa-solid fa-display"></i>
            </button>
            <button id="call-settings" class="call-ctrl" type="button" title="Voice settings" aria-haspopup="true">
                <i class="fa-solid fa-sliders"></i>
            </button>
            <button id="call-leave" class="call-ctrl call-leave" type="button" title="Leave call">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </footer>
    </div>
`;
document.body.appendChild(overlay);

const callWindow = overlay.querySelector('.call-window');
const grid = overlay.querySelector('#call-grid');
const audioBox = overlay.querySelector('#call-audio');
const statusEl = overlay.querySelector('#call-status');
const minimizeBtn = overlay.querySelector('#call-minimize');
const userMenu = overlay.querySelector('#call-usermenu');
const menu = overlay.querySelector('#call-menu');

const micBtn = overlay.querySelector('#call-mic');
const deafenBtn = overlay.querySelector('#call-deafen');
const camBtn = overlay.querySelector('#call-cam');
const streamBtn = overlay.querySelector('#call-stream');
const settingsBtn = overlay.querySelector('#call-settings');
const leaveBtn = overlay.querySelector('#call-leave');

const micSelect = overlay.querySelector('#set-mic');
const speakerSelect = overlay.querySelector('#set-speaker');
const speakerSection = overlay.querySelector('#set-speaker-section');
const cameraSelect = overlay.querySelector('#set-camera');
const nsBox = overlay.querySelector('#set-ns');
const echoBox = overlay.querySelector('#set-echo');
const agcBox = overlay.querySelector('#set-agc');
const joinMutedBox = overlay.querySelector('#set-join-muted');
const streamQualitySelect = overlay.querySelector('#set-stream-quality');
const streamAudioBox = overlay.querySelector('#set-stream-audio');

nsBox.checked = settings.noiseSuppression;
echoBox.checked = settings.echoCancellation;
agcBox.checked = settings.autoGainControl;
joinMutedBox.checked = settings.joinMuted;
streamQualitySelect.value = STREAM_PRESETS[settings.streamQuality] ? settings.streamQuality : '1080p30';
streamAudioBox.checked = settings.streamAudio;

if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) streamBtn.classList.add('hidden');
if (!('setSinkId' in HTMLMediaElement.prototype)) speakerSection.classList.add('hidden');

/* ---------- Profiles ---------- */
async function resolveProfile(identity) {
    if (profileCache.has(identity)) return profileCache.get(identity);

    const profile = { src: defaultAvatar, sequentialId: null };
    try {
        const snap = await getDoc(doc(db, 'users', identity));
        if (snap.exists()) {
            const data = snap.data();
            if (isSafeImageSrc(data.profilePic)) profile.src = data.profilePic;
            if (data.sequentialId) profile.sequentialId = data.sequentialId;
        }
    } catch (err) {
        console.error('Could not load profile:', err);
    }
    profileCache.set(identity, profile);
    return profile;
}

function setTileAvatar(identity, img) {
    img.addEventListener('error', () => { img.src = defaultAvatar; }, { once: true });
    const cached = profileCache.get(identity);
    img.src = cached ? cached.src : defaultAvatar;
    resolveProfile(identity).then((p) => { img.src = p.src; });
}

/* ---------- Tiles ---------- */
function tileKeyFor(identity, isStream) {
    return isStream ? `${identity}:screen` : identity;
}

function ensureTile(p, isStream = false) {
    const key = tileKeyFor(p.identity, isStream);
    let tile = tiles.get(key);
    if (tile) return tile;

    const name = p.name || 'Anonymous';

    tile = el('div', 'call-tile' + (isStream ? ' stream' : ''));
    tile.dataset.key = key;

    const media = el('div', 'call-tile-media');
    tile.appendChild(media);

    if (!isStream) {
        const avatarWrap = el('div', 'call-avatar');
        const avatar = document.createElement('img');
        avatar.alt = '';
        avatarWrap.appendChild(avatar);
        tile.appendChild(avatarWrap);
        setTileAvatar(p.identity, avatar);
    }

    let label;
    if (isStream) label = p.isLocal ? 'Your stream' : `${name}’s stream`;
    else label = name + (p.isLocal ? ' (you)' : '');
    tile.appendChild(el('span', 'call-tile-name', label));

    tile.addEventListener('click', (e) => {
        e.stopPropagation();
        openUserMenu(key, e);
    });
    tile.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        closeMenus();
        toggleFullscreen(key);
    });

    tiles.set(key, tile);
    tileInfo.set(key, { identity: p.identity, name, isLocal: !!p.isLocal, isStream });
    grid.appendChild(tile);
    return tile;
}

function removeTileByKey(key) {
    const tile = tiles.get(key);
    if (tile) tile.remove();
    tiles.delete(key);
    tileInfo.delete(key);
    if (pinnedKey === key) setPin(null);
    closeUserMenu();
}

function removeParticipantTiles(p) {
    removeTileByKey(p.identity);
    removeTileByKey(tileKeyFor(p.identity, true));
}

function setPin(key) {
    pinnedKey = key;
    tiles.forEach((tile, k) => tile.classList.toggle('pinned', k === key));
    grid.classList.toggle('has-pin', !!key);
}

function toggleFullscreen(key) {
    const tile = tiles.get(key);
    if (!tile) return;
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    } else if (tile.requestFullscreen) {
        tile.requestFullscreen().catch(() => {});
    }
}

/* ---------- Tracks ---------- */
function attachTrack(track, participant) {
    const source = track.source;

    if (track.kind === Track.Kind.Video) {
        const isStream = source === Track.Source.ScreenShare;
        const tile = ensureTile(participant, isStream);
        const media = tile.querySelector('.call-tile-media');
        media.querySelectorAll('video').forEach((v) => v.remove());

        const video = track.attach();
        video.className = 'call-video' + (participant.isLocal && !isStream ? ' mirror' : '');
        media.appendChild(video);
        tile.classList.add('has-video');

        if (isStream && !participant.isLocal && !pinnedKey) {
            setPin(tileKeyFor(participant.identity, true));
        }
    } else if (track.kind === Track.Kind.Audio && !participant.isLocal) {
        audioBox.appendChild(track.attach());
        applyVolume(participant.identity, source === Track.Source.ScreenShareAudio);
    }
}

function detachTrack(track, participant) {
    track.detach().forEach((node) => node.remove());
    if (track.kind !== Track.Kind.Video || !participant) return;

    if (track.source === Track.Source.ScreenShare) {
        removeTileByKey(tileKeyFor(participant.identity, true));
    } else {
        const tile = tiles.get(participant.identity);
        if (tile) tile.classList.remove('has-video');
    }
}

/* ---------- Volume ---------- */
function applyVolume(identity, isStream) {
    if (!room) return;
    const p = room.remoteParticipants.get(identity);
    if (!p) return;

    const st = getAudioState(tileKeyFor(identity, isStream));
    const volume = deafened || st.muted ? 0 : st.volume;
    p.setVolume(volume, isStream ? Track.Source.ScreenShareAudio : Track.Source.Microphone);
}

function applyAllVolumes() {
    if (!room) return;
    room.remoteParticipants.forEach((p) => {
        applyVolume(p.identity, false);
        applyVolume(p.identity, true);
    });
}

/* ---------- Menus ---------- */
function placeMenu(menuEl, x, y) {
    menuEl.classList.remove('hidden');
    const maxW = callWindow.clientWidth;
    const maxH = callWindow.clientHeight;
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    menuEl.style.left = `${Math.max(8, Math.min(x, maxW - w - 8))}px`;
    menuEl.style.top = `${Math.max(8, Math.min(y, maxH - h - 8))}px`;
}

function closeUserMenu() {
    userMenu.classList.add('hidden');
    userMenu.innerHTML = '';
}

function closeSettings() {
    menu.classList.add('hidden');
}

function closeMenus() {
    closeUserMenu();
    closeSettings();
}

function menuButton(text, onClick, extraClass = '') {
    const btn = el('button', `um-btn ${extraClass}`.trim(), text);
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

function checkRow(text, checked, onChange) {
    const label = el('label', 'um-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, document.createTextNode(` ${text}`));
    return { label, input };
}

function openUserMenu(key, event) {
    const info = tileInfo.get(key);
    const tile = tiles.get(key);
    if (!info || !tile || !room) return;

    closeSettings();
    userMenu.innerHTML = '';

    const label = tile.querySelector('.call-tile-name');
    userMenu.appendChild(el('div', 'um-title', label ? label.textContent : info.name));

    if (!info.isLocal) {
        const st = getAudioState(key);

        const row = el('div', 'um-row');
        row.append(el('span', '', info.isStream ? 'Stream volume' : 'User volume'));
        const valueEl = el('span', '', `${Math.round(st.volume * 100)}%`);
        row.appendChild(valueEl);
        userMenu.appendChild(row);

        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.value = String(Math.round(st.volume * 100));
        range.className = 'um-range';
        range.setAttribute('aria-label', 'Volume');
        range.addEventListener('input', () => {
            st.volume = Number(range.value) / 100;
            valueEl.textContent = `${range.value}%`;
            applyVolume(info.identity, info.isStream);
        });
        userMenu.appendChild(range);

        const mute = checkRow('Mute for me', st.muted, (on) => {
            st.muted = on;
            applyVolume(info.identity, info.isStream);
        });
        userMenu.appendChild(mute.label);

        const hide = checkRow(info.isStream ? 'Hide stream' : 'Hide their video', tile.classList.contains('video-hidden'), (on) => {
            tile.classList.toggle('video-hidden', on);
        });
        userMenu.appendChild(hide.label);

        userMenu.appendChild(el('div', 'um-sep'));
        userMenu.appendChild(menuButton('Reset volume', () => {
            st.volume = 1;
            st.muted = false;
            range.value = '100';
            valueEl.textContent = '100%';
            mute.input.checked = false;
            applyVolume(info.identity, info.isStream);
        }));
    }

    userMenu.appendChild(menuButton(pinnedKey === key ? 'Unpin' : 'Pin to focus', () => {
        setPin(pinnedKey === key ? null : key);
        closeUserMenu();
    }));
    userMenu.appendChild(menuButton('Fullscreen', () => {
        closeUserMenu();
        toggleFullscreen(key);
    }));

    if (!info.isStream) {
        userMenu.appendChild(menuButton('View profile', async () => {
            const profile = await resolveProfile(info.identity);
            closeUserMenu();
            if (profile.sequentialId) {
                window.open(`/aurora/users/${encodeURIComponent(profile.sequentialId)}/profile/`, '_blank', 'noopener');
            } else {
                alert('This user’s profile is not available.');
            }
        }));
    }

    if (info.isLocal && info.isStream) {
        userMenu.appendChild(menuButton('Stop streaming', async () => {
            closeUserMenu();
            try { await room.localParticipant.setScreenShareEnabled(false); } catch (err) { console.error(err); }
            syncControls();
        }, 'danger'));
    }

    if (info.isLocal && !info.isStream) {
        userMenu.appendChild(menuButton('Voice settings', () => {
            closeUserMenu();
            openSettings(true);
        }));
    }

    const rect = callWindow.getBoundingClientRect();
    placeMenu(userMenu, event.clientX - rect.left, event.clientY - rect.top);
}

/* ---------- Devices ---------- */
async function fillDevices(select, kind, savedId, emptyText) {
    let devices = [];
    try {
        devices = await Room.getLocalDevices(kind, false);
    } catch (err) {
        console.error(`Could not list ${kind}:`, err);
    }

    devices = devices.filter((d) => d.deviceId);
    select.innerHTML = '';

    if (!devices.length) {
        const opt = el('option', '', emptyText);
        opt.value = '';
        select.appendChild(opt);
        select.disabled = true;
        return;
    }

    select.disabled = false;
    devices.forEach((d, i) => {
        const opt = el('option', '', d.label || `${emptyText.replace('No ', '').replace(' found', '')} ${i + 1}`);
        opt.value = d.deviceId;
        select.appendChild(opt);
    });

    const active = (room && room.getActiveDevice && room.getActiveDevice(kind)) || savedId || 'default';
    if (devices.some((d) => d.deviceId === active)) select.value = active;
}

async function refreshDevices() {
    await Promise.all([
        fillDevices(micSelect, 'audioinput', settings.mic, 'No microphones found'),
        fillDevices(speakerSelect, 'audiooutput', settings.speaker, 'No speakers found'),
        fillDevices(cameraSelect, 'videoinput', settings.camera, 'No cameras found')
    ]);
}

function bindDeviceSelect(select, kind, key) {
    select.addEventListener('change', async () => {
        if (!select.value) return;
        settings[key] = select.value;
        saveSettings();
        if (!room) return;
        try {
            await room.switchActiveDevice(kind, select.value);
        } catch (err) {
            console.error(`Could not switch ${kind}:`, err);
            alert('Could not switch to that device.');
            refreshDevices();
        }
    });
}

bindDeviceSelect(micSelect, 'audioinput', 'mic');
bindDeviceSelect(speakerSelect, 'audiooutput', 'speaker');
bindDeviceSelect(cameraSelect, 'videoinput', 'camera');

async function applyAudioProcessing() {
    if (!room) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub && pub.audioTrack;
    if (!track || !track.restartTrack) return;

    const deviceId = (room.getActiveDevice && room.getActiveDevice('audioinput')) || settings.mic;
    try {
        await track.restartTrack({
            deviceId: deviceId ? { ideal: deviceId } : undefined,
            noiseSuppression: settings.noiseSuppression,
            echoCancellation: settings.echoCancellation,
            autoGainControl: settings.autoGainControl
        });
    } catch (err) {
        console.error('Could not apply voice processing:', err);
    }
}

function bindToggle(box, key, afterChange) {
    box.addEventListener('change', () => {
        settings[key] = box.checked;
        saveSettings();
        if (afterChange) afterChange();
    });
}

bindToggle(nsBox, 'noiseSuppression', applyAudioProcessing);
bindToggle(echoBox, 'echoCancellation', applyAudioProcessing);
bindToggle(agcBox, 'autoGainControl', applyAudioProcessing);
bindToggle(joinMutedBox, 'joinMuted');
bindToggle(streamAudioBox, 'streamAudio');

streamQualitySelect.addEventListener('change', () => {
    settings.streamQuality = streamQualitySelect.value;
    saveSettings();
});

function openSettings(show) {
    const open = typeof show === 'boolean' ? show : menu.classList.contains('hidden');
    closeUserMenu();
    menu.classList.toggle('hidden', !open);
    if (open) refreshDevices();
}

menu.addEventListener('click', (e) => e.stopPropagation());
userMenu.addEventListener('click', (e) => e.stopPropagation());
overlay.addEventListener('click', closeMenus);

settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeMenus();
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

    deafenBtn.setAttribute('aria-pressed', String(deafened));
    deafenBtn.querySelector('i').className = deafened ? 'fa-solid fa-ear-deaf' : 'fa-solid fa-headphones';

    streamBtn.classList.toggle('active', lp.isScreenShareEnabled);
    streamBtn.title = lp.isScreenShareEnabled ? 'Stop streaming' : 'Share your screen';
}

async function setDeafened(on) {
    if (!room || deafened === on) return;
    const lp = room.localParticipant;
    deafened = on;

    try {
        if (on) {
            micWasOn = lp.isMicrophoneEnabled;
            if (micWasOn) await lp.setMicrophoneEnabled(false);
        } else if (micWasOn) {
            await lp.setMicrophoneEnabled(true);
            micWasOn = false;
        }
    } catch (err) {
        console.error('Deafen error:', err);
    }

    applyAllVolumes();
    syncControls();
}

deafenBtn.addEventListener('click', () => setDeafened(!deafened));

// Click the microphone to mute. Hold it (or right-click) to change microphone.
let micHoldTimer = null;
let micHeld = false;

micBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    micHeld = false;
    clearTimeout(micHoldTimer);
    micHoldTimer = setTimeout(() => {
        micHeld = true;
        openSettings(true);
    }, HOLD_MS);
});

['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => {
    micBtn.addEventListener(type, () => clearTimeout(micHoldTimer));
});

micBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    micHeld = true;
    openSettings(true);
});

micBtn.addEventListener('click', async (e) => {
    if (micHeld) {
        micHeld = false;
        e.stopPropagation();
        return;
    }
    if (!room) return;

    try {
        if (deafened) {
            deafened = false;
            micWasOn = false;
            applyAllVolumes();
            await room.localParticipant.setMicrophoneEnabled(true);
        } else {
            await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
        }
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

streamBtn.addEventListener('click', async () => {
    if (!room) return;
    const lp = room.localParticipant;

    try {
        if (lp.isScreenShareEnabled) {
            await lp.setScreenShareEnabled(false);
        } else {
            const q = STREAM_PRESETS[settings.streamQuality] || STREAM_PRESETS['1080p30'];
            await lp.setScreenShareEnabled(
                true,
                {
                    audio: settings.streamAudio,
                    resolution: { width: q.width, height: q.height, frameRate: q.frameRate }
                },
                { screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.frameRate } }
            );
        }
    } catch (err) {
        // NotAllowedError just means the user closed the share picker.
        if (!err || err.name !== 'NotAllowedError') {
            console.error('Streaming error:', err);
            alert('Could not start streaming.');
        }
    }
    syncControls();
});

leaveBtn.addEventListener('click', leaveCall);
minimizeBtn.addEventListener('click', () => {
    closeMenus();
    overlay.classList.add('hidden');
});

/* ---------- Who is in the call (for the sidebar button) ---------- */
async function setInCall(inCall) {
    const user = auth.currentUser;
    if (!user) return;
    try {
        await setDoc(doc(db, 'status', user.uid), {
            inCall,
            inCallAt: serverTimestamp()
        }, { merge: true });
    } catch (err) {
        console.error('Could not update call presence:', err);
    }
}

function recountCall() {
    const now = Date.now();
    callCount = statusDocs.filter((d) => {
        if (!d.inCall || d.status === 'offline') return false;
        const at = d.inCallAt && d.inCallAt.toMillis ? d.inCallAt.toMillis() : now;
        return now - at < IN_CALL_STALE_MS;
    }).length;
    updateCallButton();
}

function updateCallButton() {
    if (!callButton || !callButtonLabel) return;

    let text;
    if (room) text = 'Open Call';
    else if (callCount > 0) text = `Join Call · ${callCount}`;
    else text = 'Start Call';

    callButtonLabel.textContent = text;
    callButton.setAttribute('aria-label', text);
    callButton.classList.toggle('in-call', !!room);
}

let statusUnsub = null;
onAuthStateChanged(auth, (user) => {
    if (statusUnsub) { statusUnsub(); statusUnsub = null; }
    if (!user) return;

    statusUnsub = onSnapshot(collection(db, 'status'), (snapshot) => {
        statusDocs = snapshot.docs.map((d) => d.data());
        recountCall();
    }, (err) => console.error('Call presence error:', err));
});
setInterval(recountCall, 15000);

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

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: {
                deviceId: settings.mic ? { ideal: settings.mic } : undefined,
                noiseSuppression: settings.noiseSuppression,
                echoCancellation: settings.echoCancellation,
                autoGainControl: settings.autoGainControl
            },
            videoCaptureDefaults: settings.camera ? { deviceId: { ideal: settings.camera } } : undefined,
            audioOutput: settings.speaker ? { deviceId: settings.speaker } : undefined
        });

        room
            .on(RoomEvent.ParticipantConnected, (p) => { ensureTile(p); updateStatus(); })
            .on(RoomEvent.ParticipantDisconnected, (p) => { removeParticipantTiles(p); updateStatus(); })
            .on(RoomEvent.TrackSubscribed, (track, _pub, p) => attachTrack(track, p))
            .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => detachTrack(track, p))
            .on(RoomEvent.LocalTrackPublished, (pub, p) => {
                if (pub.track) attachTrack(pub.track, p);
                syncControls();
            })
            .on(RoomEvent.LocalTrackUnpublished, (pub, p) => {
                if (pub.track) detachTrack(pub.track, p);
                syncControls();
            })
            .on(RoomEvent.TrackMuted, syncControls)
            .on(RoomEvent.TrackUnmuted, syncControls)
            .on(RoomEvent.MediaDevicesChanged, refreshDevices)
            .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                const ids = new Set(speakers.map((s) => s.identity));
                tiles.forEach((tile, key) => tile.classList.toggle('speaking', ids.has(key)));
            })
            .on(RoomEvent.Disconnected, cleanup);

        await room.connect(url, token);

        ensureTile(room.localParticipant);
        room.remoteParticipants.forEach((p) => ensureTile(p));
        updateStatus();
        updateCallButton();

        setInCall(true);
        heartbeat = setInterval(() => setInCall(true), IN_CALL_HEARTBEAT_MS);

        if (!settings.joinMuted) {
            try {
                await room.localParticipant.setMicrophoneEnabled(true);
            } catch (err) {
                console.error('Microphone error:', err);
                alert('Could not access your microphone. You can still listen.');
            }
        }
        syncControls();
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
    const wasInCall = !!room || !!heartbeat;
    room = null;
    deafened = false;
    micWasOn = false;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (wasInCall) setInCall(false);

    tiles.clear();
    tileInfo.clear();
    pinnedKey = null;
    grid.classList.remove('has-pin');
    grid.innerHTML = '';
    audioBox.innerHTML = '';
    closeMenus();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.classList.add('hidden');
    updateCallButton();
}

if (callButton) {
    callButton.addEventListener('click', () => {
        if (room) overlay.classList.remove('hidden');
        else joinCall();
    });
}

updateCallButton();

window.addEventListener('beforeunload', () => {
    if (room) {
        setInCall(false);
        room.disconnect();
    }
});