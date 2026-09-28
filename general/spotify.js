import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const CLIENT_ID = "2780876e7ed14364a5775ecf43646f50";
const REDIRECT_URI = `${window.location.origin}/aurora/general/`;
const SCOPES = "user-read-currently-playing";
const POLL_MS = 15000;
const STALE_MS = 60000;

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const CURRENT_PLAYING_ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing";
const LS = { verifier: "spotify_verifier", token: "spotify_token" };

function randomString(len = 64) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function sha256Base64Url(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startSpotifyLogin() {
    const verifier = randomString();
    localStorage.setItem(LS.verifier, verifier);
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge_method: "S256",
        code_challenge: await sha256Base64Url(verifier)
    });
    window.location.href = `${AUTH_ENDPOINT}?${params}`;
}

function saveToken(json, previous = {}) {
    const token = {
        access_token: json.access_token,
        refresh_token: json.refresh_token || previous.refresh_token,
        expires_at: Date.now() + (json.expires_in - 60) * 1000
    };
    localStorage.setItem(LS.token, JSON.stringify(token));
    return token;
}

function loadToken() {
    try { return JSON.parse(localStorage.getItem(LS.token)); } catch { return null; }
}

async function tokenRequest(body) {
    const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, ...body })
    });
    if (!res.ok) throw new Error(`Spotify token error ${res.status}`);
    return res.json();
}

export async function handleSpotifyCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return false;

    const verifier = localStorage.getItem(LS.verifier);
    window.history.replaceState({}, "", window.location.pathname);
    if (!verifier) return false;

    try {
        const json = await tokenRequest({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier
        });
        saveToken(json);
        localStorage.removeItem(LS.verifier);
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

async function getAccessToken() {
    const token = loadToken();
    if (!token) return null;
    if (Date.now() < token.expires_at) return token.access_token;
    try {
        const json = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token });
        return saveToken(json, token).access_token;
    } catch (err) {
        console.error(err);
        localStorage.removeItem(LS.token);
        return null;
    }
}

export const isSpotifyLinked = () => !!loadToken();

export async function getCurrentlyPlaying(accessToken) {
    const response = await fetch(CURRENT_PLAYING_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 204 || response.status > 400) return "Nothing is currently playing.";

    const data = await response.json();
    if (!data.item) return "Nothing is currently playing.";
    const songName = data.item.name;
    const artistName = (data.item.artists || []).map((a) => a.name).join(", ");
    return `Now Playing: ${songName} by ${artistName}`;
}

async function fetchNowPlaying() {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;

    const res = await fetch(CURRENT_PLAYING_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 204 || res.status >= 400) return null;

    const data = await res.json();
    const item = data.item;
    if (!item || !data.is_playing) return null;

    const artists = item.artists
        ? item.artists.map((a) => a.name).join(", ")
        : (item.show && item.show.publisher) || "";
    const images = (item.album && item.album.images) || (item.images) || [];
    const cover = (images[1] || images[0] || {}).url || "";

    return {
        title: item.name,
        artist: artists,
        cover,
        url: (item.external_urls && item.external_urls.spotify) || ""
    };
}

let syncTimer = null;

export function startNowPlayingSync(db, uid) {
    stopNowPlayingSync();
    const ref = doc(db, "status", uid);

    const tick = async () => {
        if (document.hidden || !isSpotifyLinked()) return;
        try {
            const np = await fetchNowPlaying();
            await setDoc(ref, {
                nowPlaying: np ? { ...np, updatedMs: Date.now() } : null,
                lastChanged: serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.warn("Spotify sync failed:", err);
        }
    };

    tick();
    syncTimer = setInterval(tick, POLL_MS);
}

export function stopNowPlayingSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
}

export async function unlinkSpotify(db, uid) {
    stopNowPlayingSync();
    localStorage.removeItem(LS.token);
    try { await setDoc(doc(db, "status", uid), { nowPlaying: null }, { merge: true }); } catch {}
}

export function setupSpotifyButton(button, db, uid) {
    if (!button) return;
    const label = button.querySelector("span");
    const render = () => { if (label) label.textContent = isSpotifyLinked() ? "Spotify linked (unlink)" : "Link Spotify"; };
    render();

    button.addEventListener("click", async () => {
        if (isSpotifyLinked()) {
            await unlinkSpotify(db, uid);
            render();
        } else {
            startSpotifyLogin();
        }
    });
}

let popoverEl = null;

function closePopover() {
    if (popoverEl) popoverEl.remove();
    popoverEl = null;
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

export async function showSpotifyPopover(db, uid, anchor) {
    if (popoverEl && popoverEl.dataset.uid === uid) { closePopover(); return; }
    closePopover();
    if (!uid) return;

    let status = null;
    try {
        const snap = await getDoc(doc(db, "status", uid));
        status = snap.exists() ? snap.data() : null;
    } catch (err) {
        console.warn(err);
    }

    const np = status && status.nowPlaying;
    const fresh = np && Date.now() - (np.updatedMs || 0) < STALE_MS && status.status !== "offline";
    const name = esc((status && status.displayName) || "User");
    const safeCover = np && /^https:\/\//.test(np.cover || "") ? np.cover : "";
    const safeUrl = np && /^https:\/\//.test(np.url || "") ? np.url : "";

    const el = document.createElement("div");
    el.className = "spotify-popover";
    el.dataset.uid = uid;
    el.innerHTML = fresh
        ? `<div class="sp-head"><svg width="14" height="14" viewBox="0 0 16 16" fill="#1db954"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/></svg>${name} is listening to</div>
           <div class="sp-body">
             ${safeCover ? `<img class="sp-cover" src="${esc(safeCover)}" alt="Album cover">` : ""}
             <div class="sp-text">
               <div class="sp-title" title="${esc(np.title)}">${esc(np.title)}</div>
               <div class="sp-artist">${esc(np.artist)}</div>
               ${safeUrl ? `<a class="sp-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Open in Spotify</a>` : ""}
             </div>
           </div>`
        : `<div class="sp-head">${name}</div><div class="sp-empty">Not listening to anything right now.</div>`;

    document.body.appendChild(el);
    popoverEl = el;

    const rect = anchor.getBoundingClientRect();
    const m = 10;
    let left = rect.right + m;
    if (left + el.offsetWidth > window.innerWidth - m) left = Math.max(m, rect.left - el.offsetWidth - m);
    let top = Math.min(rect.top, window.innerHeight - el.offsetHeight - m);
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(m, top)}px`;
}

document.addEventListener("mousedown", (e) => {
    if (popoverEl && !popoverEl.contains(e.target) && !e.target.closest(".chat-profile-pic")) closePopover();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
window.addEventListener("resize", closePopover);

const style = document.createElement("style");
style.textContent = `
.chat-profile-pic { cursor: pointer; }
.spotify-btn { display:flex; align-items:center; justify-content:center; gap:8px; background:#1db954 !important; border-color:#1db954 !important; color:#fff !important; }
.spotify-btn:hover { background:#17a34a !important; }
.spotify-popover { position:fixed; z-index:10001; width:260px; padding:12px; background:#181818; color:#fff; border:1px solid rgba(255,255,255,.1); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.45); font-size:13px; }
.sp-head { display:flex; align-items:center; gap:6px; margin-bottom:10px; color:#b3b3b3; font-size:12px; }
.sp-body { display:flex; gap:10px; align-items:center; }
.sp-cover { width:64px; height:64px; border-radius:6px; object-fit:cover; flex:none; }
.sp-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
.sp-title { font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sp-artist { color:#b3b3b3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sp-link { margin-top:4px; color:#1db954; text-decoration:none; font-size:12px; }
.sp-link:hover { text-decoration:underline; }
.sp-empty { color:#b3b3b3; }
`;
document.head.appendChild(style);
