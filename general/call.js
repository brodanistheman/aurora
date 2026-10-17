import { getApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
    onSnapshot, runTransaction, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { Room, RoomEvent, Track } from "https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/+esm";

/* ==========================================================================
   Config
   ========================================================================== */
const TOKEN_URL = 'https://aurora-token.brodanistheman.workers.dev';
const ROOM_NAME = 'general';
const SETTINGS_KEY = 'aurora_call_settings';
const MINI_KEY = 'aurora_call_mini_corner';
const HEARTBEAT_MS = 15000;
const STALE_MS = 45000;      // a participant with no heartbeat for this long is treated as gone
const END_GRACE_MS = 45000;  // never auto-end a call younger than this
const GAP = 8;

const STREAM_PRESETS = {
    '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 2500000, label: '720p · 30 fps' },
    '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 5000000, label: '1080p · 30 fps' },
    '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8000000, label: '1080p · 60 fps' }
};
const CAMERA_PRESETS = {
    '360p': { width: 640, height: 360, frameRate: 30, label: '360p' },
    '720p': { width: 1280, height: 720, frameRate: 30, label: '720p' },
    '1080p': { width: 1920, height: 1080, frameRate: 30, label: '1080p' }
};
const DEFAULT_SETTINGS = {
    mic: '', speaker: '', camera: '',
    noiseSuppression: true, echoCancellation: true, autoGainControl: true,
    joinMuted: false, streamQuality: '1080p30', streamAudio: true, cameraQuality: '720p'
};

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const callButton = document.getElementById('call-button');
const callButtonLabel = document.getElementById('call-button-label');

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2366665f'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

/* ==========================================================================
   State
   ========================================================================== */
let room = null;
let currentCallId = null;
let joining = false;
let minimized = false;
let deafened = false;
let micWasOn = false;
let pinnedKey = null;
let fsKey = null;
let heartbeat = null;
let lastSpeaker = null;
let camState = '';          // '' | 'loading' | 'error'
let activeCallId = null;    // from rooms/{room}
let clockOffset = 0;
let layoutQueued = false;
let stateTimer = null;
let openDropdown = null;
let pendingConfirm = null;
let miniCorner = 'br';

const tiles = new Map();
const tileInfo = new Map();
const profileCache = new Map();
const audioState = new Map();
const callStore = new Map();   // callId -> { data, parts, partsLoaded }
const watchers = new Map();    // callId -> { doc, parts }

/* ==========================================================================
   Helpers
   ========================================================================== */
function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
}
function icon(name, extra = '') {
    const i = document.createElement('i');
    i.className = `fa-solid fa-${name} ${extra}`.trim();
    i.setAttribute('aria-hidden', 'true');
    return i;
}
function setIcon(btn, name) { const i = btn.querySelector('i'); if (i) i.className = `fa-solid fa-${name}`; }
function tip(node, text) {
    node.dataset.tip = text;
    if (!node.textContent.trim()) node.setAttribute('aria-label', text);
    return node;
}
function iconButton(cls, iconName, tipText) {
    const b = el('button', cls);
    b.type = 'button';
    b.appendChild(icon(iconName));
    return tip(b, tipText);
}
const clamp = (v, a, b) => Math.max(a, Math.min(v, b));
const pad2 = (n) => String(n).padStart(2, '0');
const tsMs = (v) => (v && v.toMillis ? v.toMillis() : null);
const serverNow = () => Date.now() + clockOffset;

function formatDuration(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}
function isSafeImageSrc(src) {
    return typeof src === 'string' && (src.startsWith('https://') || src.startsWith('http://') || src.startsWith('data:image/'));
}
function getAudioState(key) {
    if (!audioState.has(key)) audioState.set(key, { volume: 1, muted: false });
    return audioState.get(key);
}
function displayName() {
    return window.currentDisplayName || (auth.currentUser && auth.currentUser.displayName) || 'Anonymous';
}

/* Server clock: backend timestamps are authoritative, so estimate our skew once. */
function syncClock(user) {
    const ref = doc(db, 'clock', user.uid);
    setDoc(ref, { t: serverTimestamp() }).catch(() => {});
    const un = onSnapshot(ref, (snap) => {
        const t = snap.data() && tsMs(snap.data().t);
        if (t && !snap.metadata.hasPendingWrites) { clockOffset = t - Date.now(); un(); }
    }, () => {});
}

/* ---------- Settings ---------- */
function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
let settings = loadSettings();

/* ---------- Profiles (avatars are never stored in call documents) ---------- */
async function resolveProfile(uid) {
    if (profileCache.has(uid)) return profileCache.get(uid);
    const profile = { src: defaultAvatar, sequentialId: null };
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
            const d = snap.data();
            if (isSafeImageSrc(d.profilePic)) profile.src = d.profilePic;
            if (d.sequentialId) profile.sequentialId = d.sequentialId;
        }
    } catch (err) { console.error('Could not load profile:', err); }
    profileCache.set(uid, profile);
    return profile;
}
function bindAvatar(img, uid) {
    img.alt = '';
    img.addEventListener('error', () => { img.src = defaultAvatar; }, { once: true });
    const cached = profileCache.get(uid);
    img.src = cached ? cached.src : defaultAvatar;
    if (!cached) resolveProfile(uid).then((p) => { img.src = p.src; });
    return img;
}
function makeAvatar(uid, cls) { const img = document.createElement('img'); img.className = cls; return bindAvatar(img, uid); }

/* ==========================================================================
   Custom UI components: tooltip, toast, dropdown, switch, slider, menu, dialog
   ========================================================================== */
const tipEl = el('div', 'au-tip hidden');
tipEl.setAttribute('role', 'tooltip');
document.body.appendChild(tipEl);
let tipTarget = null;
let tipTouchTimer = null;

function showTip(target) {
    const text = target.dataset.tip;
    if (!text) return;
    tipTarget = target;
    tipEl.textContent = text;
    tipEl.classList.remove('hidden');
    const r = target.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    tipEl.style.top = `${clamp(top, 8, window.innerHeight - h - 8)}px`;
    tipEl.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
}
function hideTip() { tipTarget = null; tipEl.classList.add('hidden'); clearTimeout(tipTouchTimer); }

document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t); else hideTip();
});
document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') { hideTip(); return; }
    const t = e.target.closest && e.target.closest('[data-tip]');
    clearTimeout(tipTouchTimer);
    if (t) tipTouchTimer = setTimeout(() => { showTip(t); setTimeout(hideTip, 2500); }, 500); // long-press on touch
});
['pointerup', 'pointercancel', 'scroll'].forEach((ev) => document.addEventListener(ev, () => clearTimeout(tipTouchTimer), true));
document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('[data-tip]') && e.target.matches(':focus-visible')) showTip(e.target); });
document.addEventListener('focusout', hideTip);

const toastBox = el('div', 'au-toasts');
toastBox.setAttribute('role', 'status');
toastBox.setAttribute('aria-live', 'polite');
document.body.appendChild(toastBox);
function toast(message) {
    const t = el('div', 'au-toast', message);
    toastBox.appendChild(t);
    setTimeout(() => t.remove(), 4500);
}

function createDropdown(label, onChange) {
    const root = el('div', 'au-dd');
    const btn = el('button', 'au-dd-btn');
    btn.type = 'button';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', label);
    const valueEl = el('span', 'au-dd-value');
    btn.append(valueEl, icon('chevron-down', 'au-dd-caret'));
    const list = el('div', 'au-dd-list hidden');
    list.setAttribute('role', 'listbox');
    root.append(btn, list);

    let options = [], value = '', active = 0, disabled = false;

    function paint() {
        list.innerHTML = '';
        options.forEach((o, i) => {
            const it = el('div', 'au-dd-item', o.label);
            it.setAttribute('role', 'option');
            it.setAttribute('aria-selected', String(o.value === value));
            it.classList.toggle('selected', o.value === value);
            it.classList.toggle('active', i === active);
            it.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(i); });
            list.appendChild(it);
        });
        const cur = options.find((o) => o.value === value);
        valueEl.textContent = cur ? cur.label : (options[0] ? options[0].label : 'None');
        const act = list.children[active];
        if (act && !list.classList.contains('hidden')) act.scrollIntoView({ block: 'nearest' });
    }
    function choose(i) {
        const o = options[i];
        if (!o) return;
        value = o.value;
        close();
        paint();
        onChange(value);
    }
    function open() {
        if (disabled || !options.length) return;
        if (openDropdown && openDropdown !== api) openDropdown.close();
        active = Math.max(0, options.findIndex((o) => o.value === value));
        const r = btn.getBoundingClientRect();
        list.style.minWidth = `${r.width}px`;
        list.classList.remove('hidden');
        paint();
        const h = list.offsetHeight;
        const below = window.innerHeight - r.bottom - 8;
        list.style.left = `${clamp(r.left, 8, window.innerWidth - list.offsetWidth - 8)}px`;
        list.style.top = `${below >= Math.min(h, 200) ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;
        btn.setAttribute('aria-expanded', 'true');
        openDropdown = api;
    }
    function close() {
        list.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (openDropdown === api) openDropdown = null;
    }
    btn.addEventListener('click', () => (list.classList.contains('hidden') ? open() : close()));
    btn.addEventListener('keydown', (e) => {
        const isOpen = !list.classList.contains('hidden');
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            if (!isOpen) { open(); return; }
            if (e.key === 'ArrowDown') active = Math.min(options.length - 1, active + 1);
            else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
            else active = e.key === 'Home' ? 0 : options.length - 1;
            paint();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isOpen) choose(active); else open();
        } else if (e.key === 'Tab') close();
    });

    const api = {
        root, btn, close,
        setOptions(opts, val) { options = opts; value = val; paint(); },
        setDisabled(b) { disabled = b; btn.disabled = b; root.classList.toggle('disabled', b); }
    };
    return api;
}
document.addEventListener('pointerdown', (e) => {
    if (openDropdown && !openDropdown.root.contains(e.target)) openDropdown.close();
});

function createSwitch(text, tipText, onChange) {
    const row = el('div', 'au-row');
    const lab = el('span', 'au-row-label', text);
    const sw = el('button', 'au-switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', 'false');
    sw.setAttribute('aria-label', text);
    sw.appendChild(el('span', 'au-switch-knob'));
    if (tipText) tip(row, tipText);
    let on = false;
    const set = (v) => { on = !!v; sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('on', on); };
    sw.addEventListener('click', () => { if (sw.disabled) return; set(!on); onChange(on); });
    lab.addEventListener('click', () => sw.click());
    row.append(lab, sw);
    return { row, sw, set };
}

function createSlider({ min = 0, max = 100, value = 100, label, format = (v) => `${v}%`, onInput }) {
    const wrap = el('div', 'au-slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'au-range';
    input.min = String(min); input.max = String(max); input.value = String(value);
    input.setAttribute('aria-label', label);
    const out = el('span', 'au-slider-val');
    const paint = () => {
        input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`);
        out.textContent = format(Number(input.value));
    };
    input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
    paint();
    wrap.append(input, out);
    return { wrap, set(v) { input.value = String(v); paint(); } };
}

function confirmAction({ title, body, confirmLabel, danger = false }) {
    return new Promise((resolve) => {
        const back = el('div', 'au-modal');
        const box = el('div', 'au-dialog');
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        box.append(el('h3', 'au-dialog-title', title), el('p', 'au-dialog-body', body));
        const actions = el('div', 'au-dialog-actions');
        const cancel = el('button', 'au-btn', 'Cancel'); cancel.type = 'button';
        const ok = el('button', `au-btn ${danger ? 'danger' : 'primary'}`, confirmLabel); ok.type = 'button';
        const done = (v) => { back.remove(); pendingConfirm = null; resolve(v); };
        cancel.addEventListener('click', () => done(false));
        ok.addEventListener('click', () => done(true));
        actions.append(cancel, ok);
        box.appendChild(actions);
        back.appendChild(box);
        pendingConfirm = done;
        callWindow.appendChild(back);
        ok.focus();
    });
}

/* ==========================================================================
   Overlay markup
   ========================================================================== */
const overlay = el('div', 'call-overlay hidden');
overlay.id = 'call-overlay';
overlay.setAttribute('role', 'dialog');
overlay.setAttribute('aria-label', 'Voice and video call');
overlay.innerHTML = `
    <div class="call-window">
        <header class="call-header">
            <div class="call-header-left">
                <span id="call-header-timer" class="call-timer">00:00</span>
                <span id="call-status" class="call-status"></span>
            </div>
            <button id="call-minimize" class="call-min-btn" type="button" aria-label="Minimize call">
                <i class="fa-solid fa-down-left-and-up-right-to-center" aria-hidden="true"></i><span>Minimize</span>
            </button>
        </header>
        <div id="call-stage" class="call-stage"></div>
        <div id="call-audio" class="hidden"></div>
        <div id="call-loading" class="call-loading hidden"><span class="au-spinner"></span><span id="call-loading-text"></span></div>
        <div id="call-settings-panel" class="call-settings au-scroll hidden" role="dialog" aria-label="Call settings"></div>
        <footer id="call-controls" class="call-controls"></footer>
    </div>
`;
document.body.appendChild(overlay);

const callWindow = overlay.querySelector('.call-window');
const stage = overlay.querySelector('#call-stage');
const audioBox = overlay.querySelector('#call-audio');
const statusEl = overlay.querySelector('#call-status');
const headerTimer = overlay.querySelector('#call-header-timer');
const minimizeBtn = overlay.querySelector('#call-minimize');
const loadingEl = overlay.querySelector('#call-loading');
const loadingText = overlay.querySelector('#call-loading-text');
const settingsPanel = overlay.querySelector('#call-settings-panel');
const controls = overlay.querySelector('#call-controls');
tip(minimizeBtn, 'Minimize the call and keep talking while you use Aurora');

const micBtn = iconButton('call-ctrl', 'microphone', 'Mute or unmute your microphone');
const deafenBtn = iconButton('call-ctrl', 'headphones', 'Deafen: mute everyone and your microphone');
const camBtn = iconButton('call-ctrl', 'video-slash', 'Turn your camera on or off');
const streamBtn = iconButton('call-ctrl', 'display', 'Share your screen');
const settingsBtn = iconButton('call-ctrl', 'sliders', 'Call settings');
const endBtn = iconButton('call-ctrl call-end hidden', 'phone-flip', 'End the call for everyone');
const leaveBtn = iconButton('call-ctrl call-leave', 'phone-slash', 'Leave the call');
settingsBtn.id = 'call-settings';
settingsBtn.setAttribute('aria-haspopup', 'dialog');
[micBtn, deafenBtn, camBtn].forEach((b) => b.setAttribute('aria-pressed', 'false'));
controls.append(micBtn, deafenBtn, camBtn, streamBtn, settingsBtn, endBtn, leaveBtn);
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) streamBtn.classList.add('hidden');

/* ==========================================================================
   Settings panel
   ========================================================================== */
const ui = {};
function section(title) {
    const s = el('section', 'au-section');
    s.appendChild(el('h3', 'au-section-title', title));
    settingsPanel.appendChild(s);
    return s;
}
function field(parent, label, control, tipText) {
    const f = el('div', 'au-field');
    f.appendChild(el('span', 'au-label', label));
    f.appendChild(control);
    if (tipText) tip(f, tipText);
    parent.appendChild(f);
    return f;
}

(function buildSettings() {
    const head = el('div', 'au-settings-head');
    head.appendChild(el('span', 'au-settings-title', 'Call settings'));
    const close = iconButton('au-icon-btn', 'xmark', 'Close settings');
    close.addEventListener('click', () => toggleSettings(false));
    head.appendChild(close);
    settingsPanel.appendChild(head);

    // Audio
    const audio = section('Audio');
    ui.mic = createDropdown('Microphone', (v) => changeDevice('audioinput', 'mic', v));
    field(audio, 'Microphone', ui.mic.root, 'Choose which microphone people hear');
    ui.speaker = createDropdown('Speaker', (v) => changeDevice('audiooutput', 'speaker', v));
    ui.speakerField = field(audio, 'Speaker', ui.speaker.root, 'Choose where call audio plays');
    if (!('setSinkId' in HTMLMediaElement.prototype)) ui.speakerField.classList.add('hidden');
    ui.micNote = el('p', 'au-note hidden');
    audio.appendChild(ui.micNote);

    const test = el('div', 'au-test');
    ui.micTestBtn = el('button', 'au-btn', 'Test microphone');
    ui.micTestBtn.type = 'button';
    tip(ui.micTestBtn, 'Speak to see your input level. Nothing is sent to the call.');
    ui.meter = el('div', 'au-meter');
    ui.meterFill = el('div', 'au-meter-fill');
    ui.meter.appendChild(ui.meterFill);
    test.append(ui.micTestBtn, ui.meter);
    audio.appendChild(test);
    ui.micTestBtn.addEventListener('click', toggleMicTest);

    ui.ns = createSwitch('Noise suppression', 'Filters steady background noise from your microphone', (v) => { settings.noiseSuppression = v; saveSettings(); applyAudioProcessing(); });
    ui.echo = createSwitch('Echo cancellation', 'Stops your speakers from feeding back into your microphone', (v) => { settings.echoCancellation = v; saveSettings(); applyAudioProcessing(); });
    ui.agc = createSwitch('Automatic gain control', 'Automatically evens out your microphone volume', (v) => { settings.autoGainControl = v; saveSettings(); applyAudioProcessing(); });
    ui.joinMuted = createSwitch('Join with microphone muted', 'Start every call muted', (v) => { settings.joinMuted = v; saveSettings(); });
    audio.append(ui.ns.row, ui.echo.row, ui.agc.row, ui.joinMuted.row);
    ui.ns.set(settings.noiseSuppression); ui.echo.set(settings.echoCancellation);
    ui.agc.set(settings.autoGainControl); ui.joinMuted.set(settings.joinMuted);

    // Video
    const video = section('Video');
    ui.camera = createDropdown('Camera', (v) => changeDevice('videoinput', 'camera', v));
    field(video, 'Camera', ui.camera.root, 'Choose which camera people see');
    ui.camQuality = createDropdown('Camera quality', (v) => { settings.cameraQuality = v; saveSettings(); applyCameraQuality(); });
    ui.camQuality.setOptions(Object.entries(CAMERA_PRESETS).map(([value, p]) => ({ value, label: p.label })), settings.cameraQuality);
    field(video, 'Quality', ui.camQuality.root, 'Higher quality uses more bandwidth');
    ui.camSwitch = createSwitch('Camera on', 'Turn your camera on or off in the call', (v) => toggleCamera(v));
    video.appendChild(ui.camSwitch.row);
    ui.camNote = el('p', 'au-note hidden');
    video.appendChild(ui.camNote);
    ui.previewBtn = el('button', 'au-btn', 'Preview camera');
    ui.previewBtn.type = 'button';
    tip(ui.previewBtn, 'See yourself before turning your camera on in the call');
    ui.previewBtn.addEventListener('click', togglePreview);
    ui.previewWrap = el('div', 'au-preview hidden');
    ui.previewVideo = document.createElement('video');
    ui.previewVideo.muted = true; ui.previewVideo.playsInline = true; ui.previewVideo.autoplay = true;
    ui.previewWrap.appendChild(ui.previewVideo);
    video.append(ui.previewBtn, ui.previewWrap);

    // Screen sharing
    const share = section('Screen sharing');
    ui.streamQuality = createDropdown('Stream quality', (v) => { settings.streamQuality = v; saveSettings(); });
    ui.streamQuality.setOptions(Object.entries(STREAM_PRESETS).map(([value, p]) => ({ value, label: p.label })),
        STREAM_PRESETS[settings.streamQuality] ? settings.streamQuality : '1080p30');
    field(share, 'Quality', ui.streamQuality.root, 'Applies the next time you start sharing');
    ui.streamAudio = createSwitch('Share audio', 'Include sound from the shared tab or screen, where the browser allows it', (v) => { settings.streamAudio = v; saveSettings(); });
    ui.streamAudio.set(settings.streamAudio);
    share.appendChild(ui.streamAudio.row);
    ui.shareState = el('p', 'au-note');
    share.appendChild(ui.shareState);
    ui.shareBtn = el('button', 'au-btn', 'Start sharing');
    ui.shareBtn.type = 'button';
    ui.shareBtn.addEventListener('click', toggleScreenShare);
    share.appendChild(ui.shareBtn);
    share.appendChild(el('p', 'au-note', 'Your browser asks which screen, window or tab to share. Audio sharing depends on the browser and what you pick.'));

    // Interface
    const iface = section('Interface');
    ui.minBtn = el('button', 'au-btn', 'Minimize call');
    ui.minBtn.type = 'button';
    ui.minBtn.addEventListener('click', minimizeCall);
    ui.unpinBtn = el('button', 'au-btn hidden', 'Unpin stream');
    ui.unpinBtn.type = 'button';
    ui.unpinBtn.addEventListener('click', () => setPin(null));
    iface.append(ui.minBtn, ui.unpinBtn);
    iface.appendChild(el('p', 'au-note', 'Click a stream for fullscreen. Right-click any tile for volume, pin and more.'));
})();

function toggleSettings(force) {
    const open = typeof force === 'boolean' ? force : settingsPanel.classList.contains('hidden');
    if (!open) { stopMicTest(); stopPreview(); if (openDropdown) openDropdown.close(); }
    else { closeCtx(); refreshDevices(); syncControls(); }
    settingsPanel.classList.toggle('hidden', !open);
    settingsBtn.setAttribute('aria-expanded', String(open));
}
settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
settingsPanel.addEventListener('scroll', () => { if (openDropdown) openDropdown.close(); }, { passive: true });

/* ---------- Devices ---------- */
async function fillDevices(dd, kind, saved, none) {
    let devs = [];
    try { devs = (await Room.getLocalDevices(kind, false)).filter((d) => d.deviceId); }
    catch (err) { console.error(`Could not list ${kind}:`, err); }
    if (!devs.length) { dd.setOptions([{ value: '', label: none }], ''); dd.setDisabled(true); return devs; }
    dd.setDisabled(false);
    const opts = devs.map((d, i) => ({ value: d.deviceId, label: d.label || `Device ${i + 1}` }));
    const active = (room && room.getActiveDevice && room.getActiveDevice(kind)) || saved || 'default';
    dd.setOptions(opts, opts.some((o) => o.value === active) ? active : opts[0].value);
    return devs;
}
async function refreshDevices() {
    const [mics, , cams] = await Promise.all([
        fillDevices(ui.mic, 'audioinput', settings.mic, 'No microphones found'),
        fillDevices(ui.speaker, 'audiooutput', settings.speaker, 'No speakers found'),
        fillDevices(ui.camera, 'videoinput', settings.camera, 'No cameras found')
    ]);
    const noMic = !mics.length, noLabels = mics.length && mics.every((d) => !d.label);
    ui.micNote.textContent = noMic ? 'No microphone detected. Check that it is plugged in and allowed in your browser.'
        : noLabels ? 'Allow microphone access in your browser to see device names.' : '';
    ui.micNote.classList.toggle('hidden', !ui.micNote.textContent);
    ui.micNote.classList.toggle('error', noMic);
    if (!cams.length) { ui.camNote.textContent = 'No camera detected.'; ui.camNote.classList.remove('hidden'); ui.camNote.classList.add('error'); }
    else if (camState !== 'error') ui.camNote.classList.add('hidden');
}
async function changeDevice(kind, key, value) {
    if (!value) return;
    settings[key] = value;
    saveSettings();
    if (!room) return;
    try { await room.switchActiveDevice(kind, value); }
    catch (err) { console.error(`Could not switch ${kind}:`, err); toast('Could not switch to that device.'); refreshDevices(); }
}
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
    } catch (err) { console.error('Could not apply voice processing:', err); toast('Could not apply that audio setting.'); }
}
function cameraOptions() {
    const q = CAMERA_PRESETS[settings.cameraQuality] || CAMERA_PRESETS['720p'];
    return {
        deviceId: settings.camera ? { ideal: settings.camera } : undefined,
        resolution: { width: q.width, height: q.height, frameRate: q.frameRate }
    };
}
async function applyCameraQuality() {
    if (!room || !room.localParticipant.isCameraEnabled) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub && pub.videoTrack;
    if (!track || !track.restartTrack) return;
    try { await track.restartTrack(cameraOptions()); } catch (err) { console.error(err); toast('Could not change camera quality.'); }
}

/* ---------- Mic test and camera preview (local only, never sent to the call) ---------- */
let testStream = null, testCtx = null, testRaf = 0;
async function toggleMicTest() {
    if (testStream) { stopMicTest(); return; }
    try {
        testStream = await navigator.mediaDevices.getUserMedia({ audio: {
            deviceId: settings.mic ? { ideal: settings.mic } : undefined,
            noiseSuppression: settings.noiseSuppression, echoCancellation: settings.echoCancellation, autoGainControl: settings.autoGainControl
        } });
        testCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = testCtx.createAnalyser();
        analyser.fftSize = 512;
        testCtx.createMediaStreamSource(testStream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        ui.micTestBtn.textContent = 'Stop test';
        const loop = () => {
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
            ui.meterFill.style.width = `${clamp(Math.sqrt(sum / buf.length) * 300, 0, 100)}%`;
            testRaf = requestAnimationFrame(loop);
        };
        loop();
    } catch (err) {
        stopMicTest();
        ui.micNote.textContent = micErrorText(err);
        ui.micNote.classList.remove('hidden'); ui.micNote.classList.add('error');
    }
}
function stopMicTest() {
    cancelAnimationFrame(testRaf);
    if (testStream) testStream.getTracks().forEach((t) => t.stop());
    if (testCtx) testCtx.close().catch(() => {});
    testStream = null; testCtx = null;
    ui.micTestBtn.textContent = 'Test microphone';
    ui.meterFill.style.width = '0%';
}
let previewStream = null;
async function togglePreview() {
    if (previewStream) { stopPreview(); return; }
    try {
        previewStream = await navigator.mediaDevices.getUserMedia({ video: cameraOptions() });
        ui.previewVideo.srcObject = previewStream;
        ui.previewWrap.classList.remove('hidden');
        ui.previewBtn.textContent = 'Stop preview';
    } catch (err) {
        stopPreview();
        ui.camNote.textContent = camErrorText(err);
        ui.camNote.classList.remove('hidden'); ui.camNote.classList.add('error');
    }
}
function stopPreview() {
    if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
    ui.previewVideo.srcObject = null;
    ui.previewWrap.classList.add('hidden');
    ui.previewBtn.textContent = 'Preview camera';
}
function camErrorText(err) {
    switch (err && err.name) {
        case 'NotAllowedError': return 'Camera access was blocked. Allow it in your browser’s site settings.';
        case 'NotFoundError': return 'No camera was found.';
        case 'NotReadableError': return 'Your camera is in use by another app.';
        case 'OverconstrainedError': return 'That camera or quality is not available.';
        default: return 'Could not start your camera.';
    }
}
function micErrorText(err) {
    switch (err && err.name) {
        case 'NotAllowedError': return 'Microphone access was blocked. Allow it in your browser’s site settings.';
        case 'NotFoundError': return 'No microphone was found.';
        case 'NotReadableError': return 'Your microphone is in use by another app.';
        default: return 'Could not access your microphone.';
    }
}

/* ==========================================================================
   Context menu
   ========================================================================== */
const ctx = el('div', 'au-pop au-menu hidden');
ctx.setAttribute('role', 'menu');
overlay.appendChild(ctx);
function closeCtx() { ctx.classList.add('hidden'); ctx.innerHTML = ''; }
function menuItem(text, iconName, fn, danger = false) {
    const b = el('button', `au-menu-item${danger ? ' danger' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(icon(iconName), el('span', '', text));
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
}
ctx.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...ctx.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
});

function openTileMenu(key, x, y) {
    const info = tileInfo.get(key), tile = tiles.get(key);
    if (!info || !tile || !room) return;
    toggleSettings(false);
    closeCtx();
    ctx.appendChild(el('div', 'au-menu-title', info.label));

    if (!info.isLocal) {
        const st = getAudioState(key);
        ctx.appendChild(el('div', 'au-menu-sub', info.isStream ? 'Stream volume' : 'User volume'));
        const slider = createSlider({ label: 'Volume', value: Math.round(st.volume * 100), onInput: (v) => { st.volume = v / 100; applyVolume(info.identity, info.isStream); } });
        ctx.appendChild(slider.wrap);
        const mute = createSwitch('Mute for me', null, (on) => { st.muted = on; applyVolume(info.identity, info.isStream); });
        mute.set(st.muted);
        const hide = createSwitch(info.isStream ? 'Hide stream' : 'Hide their video', null, (on) => tile.classList.toggle('video-hidden', on));
        hide.set(tile.classList.contains('video-hidden'));
        ctx.append(mute.row, hide.row);
        ctx.appendChild(menuItem('Reset volume', 'rotate-left', () => {
            st.volume = 1; st.muted = false; slider.set(100); mute.set(false); applyVolume(info.identity, info.isStream);
        }));
        ctx.appendChild(el('div', 'au-menu-sep'));
    }
    ctx.appendChild(menuItem(pinnedKey === key ? 'Unpin' : 'Pin to top', 'thumbtack', () => { setPin(pinnedKey === key ? null : key); closeCtx(); }));
    ctx.appendChild(menuItem(fsKey === key ? 'Exit fullscreen' : 'Fullscreen', 'expand', () => { closeCtx(); toggleFullscreen(key); }));
    if (!info.isStream) {
        ctx.appendChild(menuItem('View profile', 'user', async () => {
            const p = await resolveProfile(info.identity);
            closeCtx();
            if (p.sequentialId) window.open(`/aurora/users/${encodeURIComponent(p.sequentialId)}/profile/`, '_blank', 'noopener');
            else toast('This user’s profile is not available.');
        }));
    }
    if (info.isLocal && info.isStream) {
        ctx.appendChild(menuItem('Stop streaming', 'stop', () => { closeCtx(); toggleScreenShare(); }, true));
    }
    if (info.isLocal && !info.isStream) {
        ctx.appendChild(menuItem('Call settings', 'sliders', () => { closeCtx(); toggleSettings(true); }));
    }

    ctx.classList.remove('hidden');
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = `${clamp(x, 8, window.innerWidth - w - 8)}px`;
    ctx.style.top = `${clamp(y, 8, window.innerHeight - h - 8)}px`;
    const first = ctx.querySelector('button.au-menu-item');
    if (first && x === undefined) first.focus();
}

/* ==========================================================================
   Tiles and layout engine
   Tiles are absolutely positioned by JS so pinning / resizing never moves
   them in the DOM (video elements keep playing, no reconnects).
   ========================================================================== */
function tileKeyFor(identity, isStream) { return isStream ? `${identity}:screen` : identity; }

function ensureTile(p, isStream = false) {
    const key = tileKeyFor(p.identity, isStream);
    let tile = tiles.get(key);
    if (tile) return tile;

    const name = p.name || 'Anonymous';
    const label = isStream ? (p.isLocal ? 'Your stream' : `${name}’s stream`) : name + (p.isLocal ? ' (you)' : '');

    tile = el('div', 'call-tile' + (isStream ? ' stream' : ''));
    tile.dataset.key = key;
    tile.tabIndex = 0;
    tile.setAttribute('role', 'group');
    tile.setAttribute('aria-label', label);
    tile.appendChild(el('div', 'call-tile-media'));

    if (!isStream) {
        const wrap = el('div', 'call-avatar');
        wrap.appendChild(makeAvatar(p.identity, 'call-avatar-img'));
        tile.appendChild(wrap);
        const spin = el('div', 'call-cam-state');
        spin.appendChild(el('span', 'au-spinner'));
        spin.appendChild(icon('triangle-exclamation', 'cam-err-icon'));
        tile.appendChild(spin);
    }

    const nameRow = el('div', 'call-tile-name');
    nameRow.appendChild(el('span', 'call-tile-label', label));
    if (!isStream) {
        nameRow.appendChild(icon('microphone-slash', 'ind ind-mic'));
        nameRow.appendChild(icon('video-slash', 'ind ind-cam'));
    }
    tile.appendChild(nameRow);

    const actions = el('div', 'call-tile-actions');
    const pinBtn = iconButton('tile-btn tile-pin', 'thumbtack', 'Pin to top');
    const fsBtn = iconButton('tile-btn tile-fs', 'expand', 'Fullscreen');
    pinBtn.addEventListener('click', (e) => { e.stopPropagation(); setPin(pinnedKey === key ? null : key); });
    fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(key); });
    actions.append(pinBtn, fsBtn);
    tile.appendChild(actions);

    const exit = iconButton('tile-exit', 'compress', 'Exit fullscreen');
    exit.appendChild(el('span', '', 'Exit fullscreen'));
    exit.addEventListener('click', (e) => { e.stopPropagation(); exitFullscreen(); });
    tile.appendChild(exit);

    tile.addEventListener('click', (e) => {
        if (isStream) toggleFullscreen(key);
        else openTileMenu(key, e.clientX, e.clientY);
    });
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); openTileMenu(key, e.clientX, e.clientY); });
    tile.addEventListener('keydown', (e) => {
        if (e.target !== tile) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isStream) toggleFullscreen(key);
            else { const r = tile.getBoundingClientRect(); openTileMenu(key, r.left + 24, r.top + 24); }
        }
    });

    tiles.set(key, tile);
    tileInfo.set(key, { identity: p.identity, name, label, isLocal: !!p.isLocal, isStream, aspect: 16 / 9 });
    stage.appendChild(tile);
    scheduleLayout();
    return tile;
}

function removeTileByKey(key) {
    const tile = tiles.get(key);
    if (fsKey === key) exitFullscreen();
    if (tile) { tile.querySelectorAll('video').forEach((v) => { v.srcObject = null; }); tile.remove(); }
    tiles.delete(key);
    tileInfo.delete(key);
    if (pinnedKey === key) setPin(null);
    scheduleLayout();
}
function removeParticipantTiles(p) {
    removeTileByKey(p.identity);
    removeTileByKey(tileKeyFor(p.identity, true));
}

function setPin(key) {
    pinnedKey = key && tiles.has(key) ? key : null;
    tiles.forEach((tile, k) => {
        const on = k === pinnedKey;
        tile.classList.toggle('pinned', on);
        const b = tile.querySelector('.tile-pin');
        if (b) tip(b, on ? 'Unpin' : 'Pin to top');
    });
    ui.unpinBtn.classList.toggle('hidden', !pinnedKey);
    scheduleLayout();
}

/* Fit n tiles of a given aspect into an area; returns centred rects. */
function fitGrid(n, area, aspect) {
    if (!n) return [];
    const colsList = (n === 4 && area.w >= 480) ? [2] : Array.from({ length: n }, (_, i) => i + 1);
    let best = null;
    for (const cols of colsList) {
        const rows = Math.ceil(n / cols);
        let tw = (area.w - GAP * (cols - 1)) / cols;
        let th = tw / aspect;
        const maxH = (area.h - GAP * (rows - 1)) / rows;
        if (th > maxH) { th = maxH; tw = th * aspect; }
        if (!best || tw > best.tw) best = { cols, rows, tw, th };
    }
    const { cols, rows, tw, th } = best;
    const y0 = area.y + (area.h - (rows * th + (rows - 1) * GAP)) / 2;
    const out = [];
    for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
        const x0 = area.x + (area.w - (inRow * tw + (inRow - 1) * GAP)) / 2;
        out.push({ x: x0 + c * (tw + GAP), y: y0 + r * (th + GAP), w: tw, h: th });
    }
    return out;
}
function place(key, r) {
    const t = tiles.get(key);
    if (!t) return;
    const s = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    if (t._r !== s) {
        t._r = s;
        t.style.width = `${Math.round(r.w)}px`;
        t.style.height = `${Math.round(r.h)}px`;
        t.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
    }
    t.classList.add('placed');
}
function placeList(keys, region) {
    if (!keys.length) return;
    const first = tileInfo.get(keys[0]);
    const aspect = keys.length === 1 && first.isStream ? first.aspect : 16 / 9;
    fitGrid(keys.length, region, aspect).forEach((r, i) => place(keys[i], r));
}
function placeGroups(region, streamKeys, peopleKeys) {
    let sr = region, pr = region;
    if (streamKeys.length && peopleKeys.length) {
        const sh = Math.round((region.h - GAP) * 0.64);
        sr = { ...region, h: sh };
        pr = { x: region.x, y: region.y + sh + GAP, w: region.w, h: region.h - sh - GAP };
    }
    placeList(streamKeys, sr);
    placeList(peopleKeys, pr);
}
function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(layout);
}
function layout() {
    layoutQueued = false;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const area = { x: GAP, y: GAP, w: W - GAP * 2, h: H - GAP * 2 };
    const keys = [...tiles.keys()];
    const isStream = (k) => tileInfo.get(k).isStream;
    const pin = pinnedKey && tiles.has(pinnedKey) ? pinnedKey : null;

    if (pin) {
        const others = keys.filter((k) => k !== pin);
        if (!others.length) { placeList([pin], area); return; }
        const topH = Math.round(area.h * 0.6);
        placeList([pin], { ...area, h: topH });
        const rest = { x: area.x, y: area.y + topH + GAP, w: area.w, h: area.h - topH - GAP };
        placeGroups(rest, others.filter(isStream), others.filter((k) => !isStream(k)));
    } else {
        placeGroups(area, keys.filter(isStream), keys.filter((k) => !isStream(k)));
    }
}
new ResizeObserver(scheduleLayout).observe(stage);
window.addEventListener('resize', scheduleLayout);

/* ---------- Fullscreen ---------- */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
async function enterFullscreen(key) {
    const t = tiles.get(key);
    if (!t) return;
    if (fsKey && fsKey !== key) exitFullscreen();
    fsKey = key;
    try {
        if (t.requestFullscreen) await t.requestFullscreen();
        else if (t.webkitRequestFullscreen) t.webkitRequestFullscreen();
        else throw new Error('unsupported');
    } catch {
        t.classList.add('fs-fallback');   // iOS and others without element fullscreen
    }
}
function exitFullscreen() {
    if (fsElement()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* ignore */ } }
    tiles.forEach((t) => t.classList.remove('fs-fallback', 'is-fs'));
    fsKey = null;
    scheduleLayout();
}
function toggleFullscreen(key) { if (fsKey === key) exitFullscreen(); else enterFullscreen(key); }
function onFsChange() {
    const cur = fsElement();
    tiles.forEach((t) => t.classList.toggle('is-fs', t === cur));
    if (!cur) { tiles.forEach((t) => t.classList.remove('fs-fallback')); fsKey = null; }
    scheduleLayout();
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

/* ==========================================================================
   Tracks, tile flags, volume
   ========================================================================== */
function syncTile(p) {
    const tile = tiles.get(p.identity);
    if (!tile) return;
    const cam = p.getTrackPublication(Track.Source.Camera);
    const mic = p.getTrackPublication(Track.Source.Microphone);
    tile.classList.toggle('has-video', !!cam && !cam.isMuted && !!cam.track);
    tile.classList.toggle('mic-off', !mic || mic.isMuted);
    if (p.isLocal) tile.dataset.cam = camState;
}

function attachTrack(track, p) {
    if (track.kind === Track.Kind.Video) {
        const isStream = track.source === Track.Source.ScreenShare;
        const tile = ensureTile(p, isStream);
        const media = tile.querySelector('.call-tile-media');
        track.detach().forEach((n) => n.remove());
        media.querySelectorAll('video').forEach((v) => { v.srcObject = null; v.remove(); });
        const video = track.attach();
        video.className = 'call-video' + (p.isLocal && !isStream ? ' mirror' : '');
        video.playsInline = true;
        if (isStream) {
            const info = tileInfo.get(tile.dataset.key);
            const onSize = () => {
                const a = video.videoWidth / video.videoHeight;
                if (a && isFinite(a) && Math.abs(a - info.aspect) > 0.01) { info.aspect = a; scheduleLayout(); }
            };
            video.addEventListener('resize', onSize);
            video.addEventListener('loadedmetadata', onSize);
            tile.classList.add('has-video');
        }
        media.appendChild(video);
        scheduleLayout();
    } else if (track.kind === Track.Kind.Audio && !p.isLocal) {
        track.detach().forEach((n) => n.remove());
        audioBox.appendChild(track.attach());
        applyVolume(p.identity, track.source === Track.Source.ScreenShareAudio);
    }
}
function detachTrack(track, p) {
    track.detach().forEach((n) => { n.srcObject = null; n.remove(); });
    if (track.kind !== Track.Kind.Video || !p) return;
    if (track.source === Track.Source.ScreenShare) removeTileByKey(tileKeyFor(p.identity, true));
    else { const t = tiles.get(p.identity); if (t) t.classList.remove('has-video'); }
}
function watchEnded(pub) {
    const mst = pub.track && pub.track.mediaStreamTrack;
    if (!mst) return;
    mst.addEventListener('ended', () => {
        if (pub.source === Track.Source.Camera) { toast('Your camera was disconnected.'); setCamState('error'); }
        else if (pub.source === Track.Source.Microphone) toast('Your microphone was disconnected.');
        syncControls();
    });
}

function applyVolume(identity, isStream) {
    if (!room) return;
    const p = room.remoteParticipants.get(identity);
    if (!p) return;
    const st = getAudioState(tileKeyFor(identity, isStream));
    p.setVolume(deafened || st.muted ? 0 : st.volume, isStream ? Track.Source.ScreenShareAudio : Track.Source.Microphone);
}
function applyAllVolumes() {
    if (!room) return;
    room.remoteParticipants.forEach((p) => { applyVolume(p.identity, false); applyVolume(p.identity, true); });
}

/* ==========================================================================
   Controls
   ========================================================================== */
function setCamState(s) {
    camState = s;
    camBtn.classList.toggle('loading', s === 'loading');
    camBtn.classList.toggle('error', s === 'error');
    if (room) { const t = tiles.get(room.localParticipant.identity); if (t) t.dataset.cam = s; }
    if (ui.camNote) {
        ui.camNote.classList.toggle('hidden', s !== 'error');
        ui.camNote.classList.toggle('error', s === 'error');
    }
}

function syncControls() {
    if (!room) return;
    const lp = room.localParticipant;
    const micOn = lp.isMicrophoneEnabled, camOn = lp.isCameraEnabled, sharing = lp.isScreenShareEnabled;

    micBtn.setAttribute('aria-pressed', String(!micOn));
    setIcon(micBtn, micOn ? 'microphone' : 'microphone-slash');
    tip(micBtn, micOn ? 'Mute microphone' : 'Unmute microphone');
    camBtn.setAttribute('aria-pressed', String(camOn));
    setIcon(camBtn, camOn ? 'video' : 'video-slash');
    tip(camBtn, camOn ? 'Turn camera off' : 'Turn camera on');
    deafenBtn.setAttribute('aria-pressed', String(deafened));
    setIcon(deafenBtn, deafened ? 'ear-deaf' : 'headphones');
    tip(deafenBtn, deafened ? 'Undeafen' : 'Deafen: mute everyone and your microphone');
    streamBtn.classList.toggle('active', sharing);
    tip(streamBtn, sharing ? 'Stop sharing your screen' : 'Share your screen');

    ui.camSwitch.set(camOn);
    ui.shareBtn.textContent = sharing ? 'Stop sharing' : 'Start sharing';
    ui.shareBtn.classList.toggle('danger', sharing);
    ui.shareState.textContent = sharing ? 'You are sharing your screen.' : 'You are not sharing.';

    const mini = document.getElementById('mini-mic');
    if (mini) { setIcon(mini, micOn ? 'microphone' : 'microphone-slash'); mini.classList.toggle('off', !micOn); }

    syncTile(lp);
    publishLocalState();
}

async function setDeafened(on) {
    if (!room || deafened === on) return;
    const lp = room.localParticipant;
    deafened = on;
    try {
        if (on) { micWasOn = lp.isMicrophoneEnabled; if (micWasOn) await lp.setMicrophoneEnabled(false); }
        else if (micWasOn) { await lp.setMicrophoneEnabled(true); micWasOn = false; }
    } catch (err) { console.error('Deafen error:', err); }
    applyAllVolumes();
    syncControls();
}
deafenBtn.addEventListener('click', () => setDeafened(!deafened));

async function toggleMic() {
    if (!room) return;
    try {
        if (deafened) {
            deafened = false; micWasOn = false; applyAllVolumes();
            await room.localParticipant.setMicrophoneEnabled(true);
        } else {
            await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
        }
    } catch (err) { console.error('Microphone error:', err); toast(micErrorText(err)); }
    syncControls();
}
micBtn.addEventListener('click', toggleMic);

async function toggleCamera(on) {
    if (!room || camState === 'loading') return;
    const lp = room.localParticipant;
    const target = typeof on === 'boolean' ? on : !lp.isCameraEnabled;
    if (target) setCamState('loading');
    try {
        await lp.setCameraEnabled(target, target ? cameraOptions() : undefined);
        setCamState('');
    } catch (err) {
        console.error('Camera error:', err);
        setCamState('error');
        toast(camErrorText(err));
    }
    syncControls();
}
camBtn.addEventListener('click', () => toggleCamera());

async function toggleScreenShare() {
    if (!room) return;
    const lp = room.localParticipant;
    try {
        if (lp.isScreenShareEnabled) await lp.setScreenShareEnabled(false);
        else {
            const q = STREAM_PRESETS[settings.streamQuality] || STREAM_PRESETS['1080p30'];
            await lp.setScreenShareEnabled(true,
                { audio: settings.streamAudio, resolution: { width: q.width, height: q.height, frameRate: q.frameRate } },
                { screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.frameRate } });
        }
    } catch (err) {
        if (!err || err.name !== 'NotAllowedError') { console.error('Streaming error:', err); toast('Could not start sharing your screen.'); }
    }
    syncControls();
}
streamBtn.addEventListener('click', toggleScreenShare);

leaveBtn.addEventListener('click', () => cleanup());
endBtn.addEventListener('click', async () => {
    const id = currentCallId;
    if (!id) return;
    const ok = await confirmAction({
        title: 'End call for everyone?',
        body: 'Everyone will be disconnected and the call will be marked as ended.',
        confirmLabel: 'End call', danger: true
    });
    if (!ok) return;
    try { await endCall(id); } catch (err) { console.error(err); toast('Could not end the call.'); return; }
    cleanup();
});

/* ---------- Layers / escape ---------- */
function closeLayers() {
    if (pendingConfirm) { pendingConfirm(false); return true; }
    if (openDropdown) { openDropdown.close(); return true; }
    if (!ctx.classList.contains('hidden')) { closeCtx(); return true; }
    if (!settingsPanel.classList.contains('hidden')) { toggleSettings(false); return true; }
    if (fsKey) { exitFullscreen(); return true; }
    return false;
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeLayers();
});
overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.call-settings, .au-menu, .au-dd-list, #call-settings, .au-dialog')) return;
    closeCtx();
    if (!settingsPanel.classList.contains('hidden')) toggleSettings(false);
});

/* ==========================================================================
   Minimized window
   ========================================================================== */
const mini = el('div', 'call-mini hidden');
mini.setAttribute('role', 'region');
mini.setAttribute('aria-label', 'Call in progress');
const miniAvatar = el('img', 'mini-avatar'); miniAvatar.alt = '';
const miniText = el('div', 'mini-text');
const miniName = el('span', 'mini-name');
const miniTimer = el('span', 'mini-timer', '00:00');
miniText.append(miniName, miniTimer);
const miniMic = iconButton('mini-btn', 'microphone', 'Mute or unmute your microphone');
miniMic.id = 'mini-mic';
const miniRestore = iconButton('mini-btn', 'up-right-and-down-left-from-center', 'Restore the full call');
mini.append(miniAvatar, miniText, miniMic, miniRestore);
document.body.appendChild(mini);

function setMiniCorner(c) {
    miniCorner = c;
    try { sessionStorage.setItem(MINI_KEY, c); } catch { /* ignore */ }
    mini.style.left = mini.style.top = mini.style.right = mini.style.bottom = '';
    mini.className = mini.className.replace(/\bcorner-\w+/g, '').trim();
    mini.classList.add(`corner-${c}`);
}
try { const saved = sessionStorage.getItem(MINI_KEY); if (/^[tb][lr]$/.test(saved || '')) miniCorner = saved; } catch { /* ignore */ }
setMiniCorner(miniCorner);

let drag = null;
mini.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = mini.getBoundingClientRect();
    drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    mini.setPointerCapture(e.pointerId);
});
mini.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    mini.classList.add('dragging');
    mini.style.right = mini.style.bottom = 'auto';
    mini.style.left = `${clamp(drag.ox + dx, 8, window.innerWidth - mini.offsetWidth - 8)}px`;
    mini.style.top = `${clamp(drag.oy + dy, 8, window.innerHeight - mini.offsetHeight - 8)}px`;
});
function endDrag(e, allowRestore) {
    if (!drag) return;
    const d = drag; drag = null;
    mini.classList.remove('dragging');
    if (!d.moved) { if (allowRestore) restoreCall(); return; }
    const r = mini.getBoundingClientRect();
    setMiniCorner(`${r.top + r.height / 2 > window.innerHeight / 2 ? 'b' : 't'}${r.left + r.width / 2 > window.innerWidth / 2 ? 'r' : 'l'}`);
}
mini.addEventListener('pointerup', (e) => endDrag(e, true));
mini.addEventListener('pointercancel', (e) => endDrag(e, false));
miniMic.addEventListener('click', (e) => { e.stopPropagation(); toggleMic(); });
miniRestore.addEventListener('click', (e) => { e.stopPropagation(); restoreCall(); });

function hostUidOfCall() { const e = callStore.get(currentCallId); return e && e.data ? e.data.hostUid : null; }
function updateMini() {
    if (!room) return;
    const hostUid = hostUidOfCall();
    let id = lastSpeaker;
    const exists = (x) => x && (x === room.localParticipant.identity || room.remoteParticipants.has(x));
    if (!exists(id)) id = hostUid || room.localParticipant.identity;
    const p = id === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(id);
    const e = callStore.get(currentCallId);
    const name = p ? (p.name || 'Anonymous') + (p.isLocal ? ' (you)' : '') : (e && e.data && id === hostUid ? e.data.hostName : 'Participant');
    miniName.textContent = name;
    if (miniAvatar.dataset.uid !== id) { miniAvatar.dataset.uid = id; bindAvatar(miniAvatar, id); }
}
function showMini(on) { mini.classList.toggle('hidden', !on); if (on) updateMini(); }

function minimizeCall() {
    if (!room) return;
    closeLayers(); closeCtx(); toggleSettings(false);
    if (fsKey) exitFullscreen();
    minimized = true;
    overlay.classList.add('hidden');
    showMini(true);
}
function restoreCall() {
    minimized = false;
    showMini(false);
    overlay.classList.remove('hidden');
    scheduleLayout();
}
minimizeBtn.addEventListener('click', minimizeCall);

/* ==========================================================================
   Backend: calls/{id}, calls/{id}/participants/{uid}, rooms/{room}
   ========================================================================== */
const roomRef = () => doc(db, 'rooms', ROOM_NAME);
const partRef = (callId, uid = auth.currentUser.uid) => doc(db, 'calls', callId, 'participants', uid);

function isFreshPart(p) {
    const at = tsMs(p.lastSeen);
    return (at === null ? serverNow() : at) > serverNow() - STALE_MS;
}
function freshParts(entry) { return entry ? entry.parts.filter(isFreshPart) : []; }

/* Atomic start-or-join: only one active call per room, ever. */
async function startOrJoinTxn(joinId) {
    const user = auth.currentUser;
    return runTransaction(db, async (tx) => {
        const rSnap = await tx.get(roomRef());
        const activeId = rSnap.exists() ? rSnap.data().activeCallId : null;
        let activeOk = false;
        if (activeId) {
            const cSnap = await tx.get(doc(db, 'calls', activeId));
            activeOk = cSnap.exists() && cSnap.data().status === 'active';
        }
        if (joinId) return activeOk && activeId === joinId ? { callId: activeId } : { ended: true };
        if (activeOk) return { callId: activeId };

        const callRef = doc(collection(db, 'calls'));
        const msgRef = doc(collection(db, 'messages'));
        tx.set(callRef, {
            roomId: ROOM_NAME, hostUid: user.uid, hostName: displayName(), status: 'active',
            startedAt: serverTimestamp(), endedAt: null, durationMs: null, roster: [], messageId: msgRef.id
        });
        tx.set(msgRef, {
            type: 'call', callId: callRef.id, uid: user.uid, displayName: displayName(),
            profilePic: (profileCache.get(user.uid) || {}).src || '', text: '', imageUrl: null, videoUrl: null,
            createdAt: serverTimestamp()
        });
        tx.set(roomRef(), { activeCallId: callRef.id, updatedAt: serverTimestamp() }, { merge: true });
        return { callId: callRef.id };
    });
}

async function endCall(callId) {
    await runTransaction(db, async (tx) => {
        const cRef = doc(db, 'calls', callId);
        const cSnap = await tx.get(cRef);
        const rSnap = await tx.get(roomRef());
        if (!cSnap.exists() || cSnap.data().status !== 'active') return;
        const started = tsMs(cSnap.data().startedAt);
        tx.update(cRef, {
            status: 'ended', endedAt: serverTimestamp(),
            durationMs: started ? Math.max(0, serverNow() - started) : 0
        });
        if (rSnap.exists() && rSnap.data().activeCallId === callId) tx.update(roomRef(), { activeCallId: null, updatedAt: serverTimestamp() });
    });
}

async function maybeEndCall(callId) {
    const snap = await getDocs(collection(db, 'calls', callId, 'participants'));
    const fresh = snap.docs.filter((d) => isFreshPart(d.data()));
    if (!fresh.length) await endCall(callId);
}

/* Self-healing: any client ends a call that has no live participants. */
function checkStale(id) {
    const e = callStore.get(id);
    if (!e || !e.data || e.data.status !== 'active' || !e.partsLoaded) return;
    const started = tsMs(e.data.startedAt);
    if (!started || serverNow() - started < END_GRACE_MS) return;
    if (freshParts(e).length === 0) endCall(id).catch(() => {});
}
setInterval(() => { if (activeCallId) checkStale(activeCallId); renderParticipantsOnly(); }, 15000);

function watchCall(id) {
    if (!id || watchers.has(id)) return;
    const w = { doc: null, parts: null };
    watchers.set(id, w);
    const entry = { data: null, parts: [], partsLoaded: false };
    callStore.set(id, entry);
    w.doc = onSnapshot(doc(db, 'calls', id), (snap) => {
        entry.data = snap.exists() ? { id, ...snap.data() } : { id, status: 'ended', missing: true, roster: [] };
        if (entry.data.status === 'active') {
            if (!w.parts) {
                w.parts = onSnapshot(collection(db, 'calls', id, 'participants'), (ps) => {
                    entry.parts = ps.docs.map((d) => ({ ...d.data(), uid: d.id }));
                    entry.partsLoaded = true;
                    onCallChanged(id);
                    checkStale(id);
                }, (err) => console.error('Participants error:', err));
            }
        } else if (w.parts) { w.parts(); w.parts = null; entry.parts = []; }
        onCallChanged(id);
    }, (err) => console.error('Call error:', err));
}

function activeCallEntry() {
    const e = activeCallId && callStore.get(activeCallId);
    return e && e.data && e.data.status === 'active' ? e : null;
}

function onCallChanged(id) {
    renderSlots(id);
    updateCallButton();
    if (id === currentCallId) {
        const e = callStore.get(id);
        if (room && e && e.data && e.data.status !== 'active') { toast('The call has ended.'); cleanup(); return; }
        endBtn.classList.toggle('hidden', !(e && e.data && e.data.hostUid === (auth.currentUser && auth.currentUser.uid)));
        updateMini();
    }
}

/* ---------- Room listener ---------- */
let roomUnsub = null;
onAuthStateChanged(auth, (user) => {
    if (roomUnsub) { roomUnsub(); roomUnsub = null; }
    if (!user) { activeCallId = null; updateCallButton(); return; }
    syncClock(user);
    resolveProfile(user.uid);
    roomUnsub = onSnapshot(roomRef(), (snap) => {
        activeCallId = snap.exists() ? snap.data().activeCallId || null : null;
        if (activeCallId) watchCall(activeCallId);
        updateCallButton();
    }, (err) => console.error('Room error:', err));
});

/* ==========================================================================
   Sidebar button
   ========================================================================== */
function updateCallButton() {
    if (!callButton || !callButtonLabel) return;
    let text;
    if (room) text = 'Ongoing Call';
    else if (activeCallEntry()) text = 'Join Call';
    else text = 'Start Call';
    callButtonLabel.textContent = text;
    callButton.setAttribute('aria-label', text);
    callButton.classList.toggle('in-call', !!room);
    callButton.disabled = joining;
}
if (callButton) {
    callButton.addEventListener('click', () => {
        if (room) restoreCall();
        else joinCall(null);
    });
}

/* ==========================================================================
   Chat widget (rendered into .call-widget-slot elements created by general.js)
   ========================================================================== */
function callDurationMs(d) {
    if (!d) return 0;
    if (d.status !== 'active') {
        if (typeof d.durationMs === 'number') return d.durationMs;
        const s = tsMs(d.startedAt), e = tsMs(d.endedAt);
        return s && e ? e - s : 0;
    }
    const s = tsMs(d.startedAt);
    return s ? Math.max(0, serverNow() - s) : 0;
}

function renderWidget(slot) {
    const id = slot.dataset.callId;
    if (!id) return;
    watchCall(id);
    const entry = callStore.get(id);
    const d = entry && entry.data;
    if (!d) {
        if (!slot.firstChild) slot.appendChild(el('div', 'call-widget loading', 'Loading call…'));
        return;
    }
    const ended = d.status !== 'active';
    const mine = !!room && currentCallId === id;
    const parts = ended ? (d.roster || []).map((uid) => ({ uid })) : freshParts(entry).sort((a, b) => (tsMs(a.joinedAt) || 0) - (tsMs(b.joinedAt) || 0));
    const sig = [d.status, mine, d.hostUid, parts.map((p) => `${p.uid}${p.camera ? '+' : ''}`).join(',')].join('|');
    if (slot.dataset.sig === sig) return;
    slot.dataset.sig = sig;
    slot.innerHTML = '';

    const w = el('div', `call-widget${ended ? ' ended' : ''}`);
    w.dataset.callId = id;

    const head = el('div', 'cw-head');
    head.appendChild(icon(ended ? 'phone-slash' : 'phone', 'cw-icon'));
    head.appendChild(el('span', 'cw-status', ended ? 'Call Ended' : 'Call in Progress'));
    const timer = el('span', 'cw-timer', formatDuration(callDurationMs(d)));
    timer.dataset.timerFor = id;
    head.appendChild(timer);
    if (!ended && mine) {
        head.appendChild(el('span', 'cw-badge', 'Ongoing Call'));
    } else {
        const join = el('button', 'cw-join', 'Join Call');
        join.type = 'button';
        join.disabled = ended || joining;
        if (!ended) join.addEventListener('click', () => joinCall(id));
        head.appendChild(join);
    }
    w.appendChild(head);

    const row = el('div', 'cw-row');
    const host = el('div', 'cw-host');
    host.appendChild(makeAvatar(d.hostUid, 'cw-host-avatar'));
    const hostText = el('span', 'cw-host-text');
    hostText.append(el('b', '', d.hostName || 'Someone'), document.createTextNode(' started a call'));
    host.appendChild(hostText);
    row.appendChild(host);

    if (parts.length) {
        const group = el('div', 'cw-people');
        const stack = el('div', 'cw-avatars');
        parts.slice(0, 4).forEach((p) => {
            const a = makeAvatar(p.uid, 'cw-avatar');
            if (p.camera) a.classList.add('cam');
            stack.appendChild(a);
        });
        if (parts.length > 4) stack.appendChild(el('span', 'cw-more', `+${parts.length - 4}`));
        group.appendChild(stack);
        if (!ended) group.appendChild(el('span', 'cw-count', String(parts.length)));
        tip(group, ended ? 'People who joined this call' : `${parts.length} in call`);
        row.appendChild(group);
    }
    w.appendChild(row);
    slot.appendChild(w);
}

function renderSlots(id) {
    document.querySelectorAll(`.call-widget-slot[data-call-id="${CSS.escape(id)}"]`).forEach(renderWidget);
}
function renderAllSlots() { document.querySelectorAll('.call-widget-slot').forEach(renderWidget); }
function renderParticipantsOnly() { renderAllSlots(); }

const messageBoxEl = document.getElementById('message-box');
if (messageBoxEl) {
    new MutationObserver((muts) => {
        for (const m of muts) {
            m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                if (n.matches && n.matches('.call-widget-slot')) renderWidget(n);
                n.querySelectorAll && n.querySelectorAll('.call-widget-slot').forEach(renderWidget);
            });
        }
    }).observe(messageBoxEl, { childList: true, subtree: true });
    renderAllSlots();
}

/* One global ticker. Elapsed time is always derived from the stored start timestamp. */
setInterval(() => {
    document.querySelectorAll('[data-timer-for]').forEach((n) => {
        const e = callStore.get(n.dataset.timerFor);
        n.textContent = formatDuration(callDurationMs(e && e.data));
    });
    if (room && currentCallId) {
        const e = callStore.get(currentCallId);
        const t = formatDuration(callDurationMs(e && e.data));
        headerTimer.textContent = t;
        miniTimer.textContent = t;
    }
}, 1000);

/* ==========================================================================
   Join / leave
   ========================================================================== */
function setLoading(text) {
    loadingEl.classList.toggle('hidden', !text);
    loadingText.textContent = text || '';
}

async function fetchToken() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const idToken = await user.getIdToken();
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ room: ROOM_NAME, name: displayName() })
    });
    if (!res.ok) throw new Error(`Token request failed (${res.status})`);
    return res.json();
}

async function registerParticipant(callId) {
    const user = auth.currentUser;
    await setDoc(partRef(callId), {
        uid: user.uid, name: displayName(), camera: false, mic: false,
        joinedAt: serverTimestamp(), lastSeen: serverTimestamp()
    });
    await updateDoc(doc(db, 'calls', callId), { roster: arrayUnion(user.uid) });
}
function publishLocalState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
        if (!room || !currentCallId) return;
        const lp = room.localParticipant;
        setDoc(partRef(currentCallId), { camera: lp.isCameraEnabled, mic: lp.isMicrophoneEnabled, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
    }, 250);
}

function wireRoom(r) {
    r.on(RoomEvent.ParticipantConnected, (p) => { ensureTile(p); syncTile(p); updateMini(); })
        .on(RoomEvent.ParticipantDisconnected, (p) => { removeParticipantTiles(p); updateMini(); })
        .on(RoomEvent.TrackSubscribed, (t, _pub, p) => { attachTrack(t, p); syncTile(p); })
        .on(RoomEvent.TrackUnsubscribed, (t, _pub, p) => { detachTrack(t, p); syncTile(p); })
        .on(RoomEvent.LocalTrackPublished, (pub, p) => {
            if (pub.track) { attachTrack(pub.track, p); watchEnded(pub); }
            syncTile(p); syncControls();
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub, p) => {
            if (pub.track) detachTrack(pub.track, p);
            if (pub.source === Track.Source.Camera) { const t = tiles.get(p.identity); if (t) t.classList.remove('has-video'); }
            syncTile(p); syncControls();
        })
        .on(RoomEvent.TrackMuted, (_pub, p) => { syncTile(p); syncControls(); })
        .on(RoomEvent.TrackUnmuted, (_pub, p) => { syncTile(p); syncControls(); })
        .on(RoomEvent.MediaDevicesChanged, () => { if (!settingsPanel.classList.contains('hidden')) refreshDevices(); })
        .on(RoomEvent.MediaDevicesError, (err) => toast(/video|camera/i.test(String(err && err.message)) ? camErrorText(err) : micErrorText(err)))
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            const ids = new Set(speakers.map((s) => s.identity));
            tiles.forEach((tile, key) => tile.classList.toggle('speaking', ids.has(key)));
            if (speakers.length) { lastSpeaker = speakers[0].identity; updateMini(); }
        })
        .on(RoomEvent.Reconnecting, () => setLoading('Reconnecting…'))
        .on(RoomEvent.Reconnected, () => { setLoading(null); if (currentCallId) registerParticipant(currentCallId).catch(() => {}); })
        .on(RoomEvent.Disconnected, () => { if (currentCallId) toast('Disconnected from the call.'); cleanup(); });
}

async function joinCall(joinId) {
    if (room || joining) return;
    if (!auth.currentUser) return;
    joining = true;
    updateCallButton();
    restoreCall();
    setLoading('Connecting…');
    try {
        const res = await startOrJoinTxn(joinId);
        if (res.ended) { toast('This call has already ended.'); cleanup(); return; }
        currentCallId = res.callId;
        watchCall(res.callId);

        const { token, url } = await fetchToken();
        const r = new Room({
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: {
                deviceId: settings.mic ? { ideal: settings.mic } : undefined,
                noiseSuppression: settings.noiseSuppression,
                echoCancellation: settings.echoCancellation,
                autoGainControl: settings.autoGainControl
            },
            videoCaptureDefaults: cameraOptions(),
            audioOutput: settings.speaker ? { deviceId: settings.speaker } : undefined
        });
        room = r;
        wireRoom(r);
        await r.connect(url, token);
        if (room !== r) { r.disconnect(); return; }

        ensureTile(r.localParticipant);
        r.remoteParticipants.forEach((p) => { ensureTile(p); syncTile(p); });
        await registerParticipant(res.callId);
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
            if (currentCallId) setDoc(partRef(currentCallId), { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
        }, HEARTBEAT_MS);

        setLoading(null);
        updateCallButton();
        onCallChanged(res.callId);

        if (!settings.joinMuted) {
            try { await r.localParticipant.setMicrophoneEnabled(true); }
            catch (err) { console.error('Microphone error:', err); toast(`${micErrorText(err)} You can still listen.`); }
        }
        syncControls();
    } catch (err) {
        console.error('Call error:', err);
        toast('Could not join the call.');
        cleanup();
    } finally {
        joining = false;
        updateCallButton();
    }
}

async function leaveRecord(callId) {
    try { await deleteDoc(partRef(callId)); await maybeEndCall(callId); }
    catch (err) { console.error('Could not leave call record:', err); }
}

function cleanup() {
    const id = currentCallId;
    const r = room;
    room = null;
    currentCallId = null;
    try { if (r) r.disconnect(); } catch { /* ignore */ }

    clearInterval(heartbeat); heartbeat = null;
    clearTimeout(stateTimer);
    deafened = false; micWasOn = false; lastSpeaker = null; minimized = false;
    if (fsElement()) exitFullscreen();
    fsKey = null; pinnedKey = null;
    stopMicTest(); stopPreview();
    closeCtx(); toggleSettings(false);
    if (pendingConfirm) pendingConfirm(false);
    setCamState('');
    setLoading(null);

    tiles.forEach((t) => t.querySelectorAll('video').forEach((v) => { v.srcObject = null; }));
    tiles.clear(); tileInfo.clear();
    stage.innerHTML = '';
    audioBox.innerHTML = '';
    overlay.classList.add('hidden');
    showMini(false);
    ui.unpinBtn.classList.add('hidden');
    endBtn.classList.add('hidden');
    [micBtn, deafenBtn, camBtn].forEach((b) => b.setAttribute('aria-pressed', 'false'));

    if (id) leaveRecord(id);
    updateCallButton();
    renderAllSlots();
}

window.addEventListener('pagehide', () => {
    if (room && currentCallId && auth.currentUser) deleteDoc(partRef(currentCallId)).catch(() => {});
    if (room) room.disconnect();
});

updateCallButton();