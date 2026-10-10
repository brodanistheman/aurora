import {
    doc, collection, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/* ==========================================================================
   Group calls: voice / video rooms, mesh WebRTC, signalled through Firestore.

   calls/{callId}                       host, members[], video, status, lastActive
   calls/{callId}/participants/{uid}    who is in the room right now
   calls/{callId}/signals/{id}          offers / answers / ICE candidates, addressed to one uid

   The person who joins LATER always sends the offers, so two people joining at
   the same moment never collide. Everyone connects directly to everyone else,
   so keep rooms small (MAX_PARTICIPANTS).

   The UI is an inline bar docked above the messages (#call-bar), not a modal.
   ========================================================================== */

const RTC_CONFIG = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
        // Add a TURN server here for users behind strict NATs:
        // { urls: 'turn:your.turn.host:3478', username: '...', credential: '...' }
    ]
};

const MAX_PARTICIPANTS = 6;      // people in the room at once (mesh gets heavy past this)
const MAX_MEMBERS = 8;           // people who can be invited to one call
const RING_TIMEOUT_MS = 40000;   // host gives up if nobody joins
const HEARTBEAT_MS = 20000;
const FRESH_MS = 60000;          // a participant seen within this window is considered present
const STALE_CALL_MS = 90000;     // ignore calls nobody has touched for this long
const NOTE_MS = 2500;
const MAX_PIC_CHARS = 200000;
const MIC_GAIN = 2.0;            // software boost applied to your microphone
const SPEAKING_THRESHOLD = 0.02;

const els = {};
let ctx = null;
let session = null;              // the room this tab is in
let incoming = null;             // a call ringing for this user
let incomingUnsub = null;
let noteTimer = null;
let ringTimer = null;
let audioCtx = null;
const dismissed = new Set();
const originalTitle = document.title;

/* ---------- helpers ---------- */

const me = () => (ctx && ctx.auth.currentUser ? ctx.auth.currentUser.uid : null);

function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function safePic(pic) {
    return typeof pic === 'string' && pic.length <= MAX_PIC_CHARS ? pic : '';
}

function serializeCandidate(c) {
    return {
        candidate: c.candidate,
        sdpMid: c.sdpMid ?? null,
        sdpMLineIndex: c.sdpMLineIndex ?? null,
        usernameFragment: c.usernameFragment ?? null
    };
}

function mediaErrorMessage(err) {
    switch (err && err.name) {
        case 'NotAllowedError':
            return 'Microphone or camera access was blocked. Allow it in your browser settings and try again.';
        case 'NotFoundError':
            return 'No microphone was found on this device.';
        case 'NotReadableError':
            return 'Your microphone or camera is being used by another app.';
        default:
            return 'Could not start the call. Check your microphone and try again.';
    }
}

function getAudioCtx() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function levelOf(analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
    }
    return Math.sqrt(sum / buf.length);
}

/* ---------- local media (with mic boost) ---------- */

async function getMedia(video) {
    const audio = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    };
    if (!video) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
        return await navigator.mediaDevices.getUserMedia({ audio, video: { facingMode: 'user' } });
    } catch (err) {
        if (err && err.name === 'NotAllowedError') throw err;
        return navigator.mediaDevices.getUserMedia({ audio, video: false }); // no camera
    }
}

async function buildLocalMedia(video) {
    const raw = await getMedia(video);
    const media = { raw, send: raw, nodes: [], analyser: null, dest: null };

    try {
        const ac = getAudioCtx();
        if (ac.state !== 'running') await ac.resume();
        if (ac.state === 'running' && raw.getAudioTracks().length) {
            const src = ac.createMediaStreamSource(new MediaStream(raw.getAudioTracks()));
            const gain = ac.createGain();
            gain.gain.value = MIC_GAIN;
            const comp = ac.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.knee.value = 12;
            comp.ratio.value = 4;
            const dest = ac.createMediaStreamDestination();
            const analyser = ac.createAnalyser();
            analyser.fftSize = 512;

            src.connect(gain);
            gain.connect(comp);
            comp.connect(dest);
            comp.connect(analyser);

            media.send = new MediaStream([...dest.stream.getAudioTracks(), ...raw.getVideoTracks()]);
            media.nodes = [src, gain, comp, dest, analyser];
            media.analyser = analyser;
            media.dest = dest;
        }
    } catch (err) {
        console.warn('Mic boost unavailable, sending the raw microphone:', err);
    }
    return media;
}

function stopLocalMedia(media) {
    media.raw.getTracks().forEach((t) => t.stop());
    if (media.dest) media.dest.stream.getTracks().forEach((t) => t.stop());
    media.nodes.forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
}

/* ---------- ring tone ---------- */

function startRing() {
    stopRing();
    const beep = () => {
        try {
            const ac = getAudioCtx();
            if (ac.state === 'suspended') ac.resume();
            const t = ac.currentTime;
            [440, 480].forEach((freq, i) => {
                const osc = ac.createOscillator();
                const gain = ac.createGain();
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, t + i * 0.22);
                gain.gain.exponentialRampToValueAtTime(0.06, t + i * 0.22 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
                osc.connect(gain).connect(ac.destination);
                osc.start(t + i * 0.22);
                osc.stop(t + i * 0.22 + 0.22);
            });
        } catch { /* autoplay may be blocked until the user interacts */ }
    };
    beep();
    ringTimer = setInterval(beep, 2200);
    document.title = 'Incoming call · Aurora';
}

function stopRing() {
    if (ringTimer) clearInterval(ringTimer);
    ringTimer = null;
    document.title = originalTitle;
}

/* ---------- inline call bar ---------- */

function cacheElements() {
    els.bar = document.getElementById('call-bar');
    els.grid = document.getElementById('call-grid');
    els.avatar = document.getElementById('call-avatar');
    els.name = document.getElementById('call-name');
    els.status = document.getElementById('call-status');
    els.accept = document.getElementById('call-accept');
    els.mute = document.getElementById('call-mute');
    els.camera = document.getElementById('call-camera');
    els.hangup = document.getElementById('call-hangup');
}

function setHidden(el, hidden) {
    if (el) el.classList.toggle('hidden', hidden);
}

function paint({ mode, name, text, pic = '', video = false }) {
    clearTimeout(noteTimer);
    noteTimer = null;

    els.bar.classList.remove('hidden');
    els.bar.dataset.mode = mode;
    els.bar.dataset.video = String(!!video);

    if (mode !== 'call') ctx.setAvatar(els.avatar, pic);
    els.name.textContent = name;
    els.status.textContent = text;

    const hasCamera = !!(session && session.media && session.media.send.getVideoTracks().length);
    setHidden(els.avatar, mode === 'call');
    setHidden(els.grid, mode !== 'call');
    setHidden(els.accept, mode !== 'incoming');
    setHidden(els.mute, mode !== 'call');
    setHidden(els.camera, !(mode === 'call' && hasCamera));
    setHidden(els.hangup, mode === 'note');

    const label = mode === 'incoming' ? 'Decline' : 'Leave call';
    els.hangup.title = label;
    els.hangup.setAttribute('aria-label', label);
}

function updateHeader(s) {
    if (session !== s) return;
    const peers = [...s.peers.values()];
    const name = peers.length
        ? peers.map((p) => p.info.displayName || 'Anonymous').join(', ')
        : (s.label || 'Call');

    let text;
    if (s.startedAt) text = `${formatDuration(Date.now() - s.startedAt)} · ${peers.length + 1} in call`;
    else if (peers.length) text = 'Connecting…';
    else text = s.hostUid === me() ? 'Ringing…' : 'Joining…';

    paint({ mode: 'call', name, text, video: s.video });
}

function renderIncoming() {
    if (!incoming) return;
    const d = incoming.data;
    const group = (d.members || []).length > 2;
    const kind = d.video ? 'video call' : 'voice call';
    paint({
        mode: 'incoming',
        name: d.hostName || 'Anonymous',
        text: group ? `Group ${kind} · ${d.members.length} invited` : `Incoming ${kind}`,
        pic: d.hostPic,
        video: false
    });
}

function hideBar() {
    clearTimeout(noteTimer);
    noteTimer = null;
    if (els.bar) {
        els.bar.classList.add('hidden');
        els.bar.dataset.mode = '';
    }
}

function showNote(label, note) {
    paint({ mode: 'note', name: label || 'Call', text: note });
    noteTimer = setTimeout(() => {
        noteTimer = null;
        if (!session && !incoming) hideBar();
    }, NOTE_MS);
}

/* ---------- participant tiles ---------- */

function addTile(info, isLocal) {
    const tile = document.createElement('div');
    tile.className = `call-tile${isLocal ? ' is-local' : ''}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // sound comes from the separate <audio> element

    const avatar = document.createElement('img');
    avatar.className = 'call-tile-avatar';
    avatar.alt = '';
    ctx.setAvatar(avatar, info.profilePic);

    const name = document.createElement('span');
    name.className = 'call-tile-name';
    name.textContent = isLocal ? 'You' : (info.displayName || 'Anonymous');

    const state = document.createElement('span');
    state.className = 'call-tile-state';

    tile.append(video, avatar, name, state);
    els.grid.appendChild(tile);
    return { tile, video, avatar, name, state };
}

function setTileState(ui, text) {
    ui.state.textContent = text || '';
}

/* ---------- session ---------- */

function newSession(id, data, label) {
    return {
        id,
        callRef: doc(ctx.db, 'calls', id),
        meRef: null,
        hostUid: data.hostUid,
        hostName: data.hostName,
        video: !!data.video,
        members: data.members || [],
        label: label || data.hostName || 'Call',
        participants: new Map(),
        peers: new Map(),
        media: null,
        localUi: null,
        joined: false,
        created: false,
        joinedAt: 0,
        startedAt: 0,
        unsubs: [],
        heartbeat: null,
        levelTimer: null,
        durationTimer: null,
        aloneTimeout: null
    };
}

async function runSession(s, createData) {
    const user = ctx.auth.currentUser;
    if (!user || session) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
        alert('Calling is not supported in this browser.');
        return;
    }

    session = s;
    document.body.classList.add('in-call');
    updateHeader(s);

    try {
        s.media = await buildLocalMedia(s.video);
    } catch (err) {
        if (session === s) {
            teardownSession(s, null);
            alert(mediaErrorMessage(err));
        }
        return;
    }
    if (session !== s) {
        stopLocalMedia(s.media);
        return;
    }
    updateHeader(s);

    try {
        // Host creates the call only once the microphone is ready
        if (createData) {
            await setDoc(s.callRef, createData);
            s.created = true;
            if (session !== s) {
                updateDoc(s.callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
                return;
            }
        }

        const partsRef = collection(s.callRef, 'participants');
        const existing = await getDocs(partsRef);
        const present = existing.docs.filter((d) => {
            if (d.id === user.uid) return false;
            const seen = d.data().lastSeen && d.data().lastSeen.toMillis ? d.data().lastSeen.toMillis() : 0;
            return Date.now() - seen < FRESH_MS * 2;
        });
        if (present.length >= MAX_PARTICIPANTS) {
            teardownSession(s, 'Call is full');
            return;
        }

        s.meRef = doc(partsRef, user.uid);
        const profile = ctx.getProfile();
        await setDoc(s.meRef, {
            uid: user.uid,
            displayName: profile.displayName,
            profilePic: safePic(profile.profilePic),
            joinedAt: serverTimestamp(),
            lastSeen: serverTimestamp()
        });
        s.joined = true;

        if (session !== s) {
            deleteDoc(s.meRef).catch(() => {});
            return;
        }

        const meSnap = await getDoc(s.meRef);
        s.joinedAt = meSnap.data({ serverTimestamps: 'estimate' }).joinedAt.toMillis();

        s.localUi = addTile({ profilePic: profile.profilePic }, true);
        const camTracks = s.media.raw.getVideoTracks();
        if (camTracks.length) {
            s.localUi.video.srcObject = new MediaStream(camTracks);
            s.localUi.tile.classList.add('has-video');
        }

        watchSignals(s);
        watchParticipants(s);
        watchCallDoc(s);

        s.heartbeat = setInterval(() => {
            updateDoc(s.meRef, { lastSeen: serverTimestamp() }).catch(() => {});
            updateDoc(s.callRef, { lastActive: serverTimestamp() }).catch(() => {});
        }, HEARTBEAT_MS);

        s.levelTimer = setInterval(() => tickLevels(s), 150);

        if (s.hostUid === user.uid) {
            s.aloneTimeout = setTimeout(() => {
                if (session === s && s.peers.size === 0) leaveCall('No answer');
            }, RING_TIMEOUT_MS);
        }

        updateHeader(s);
    } catch (err) {
        console.error('Error joining call:', err);
        if (session === s) {
            const wasJoined = s.joined;
            teardownSession(s, 'Could not join call');
            if (wasJoined && s.meRef) deleteDoc(s.meRef).catch(() => {});
            if (s.created) updateDoc(s.callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
        }
    }
}

function tickLevels(s) {
    if (session !== s) return;
    if (s.media && s.media.analyser && s.localUi) {
        const on = s.media.send.getAudioTracks().some((t) => t.enabled);
        s.localUi.tile.classList.toggle('speaking', on && levelOf(s.media.analyser) > SPEAKING_THRESHOLD);
    }
    s.peers.forEach((p) => {
        if (p.analyser) p.ui.tile.classList.toggle('speaking', levelOf(p.analyser) > SPEAKING_THRESHOLD);
    });
}

function teardownSession(s, note) {
    if (session === s) session = null;

    clearInterval(s.heartbeat);
    clearInterval(s.levelTimer);
    clearInterval(s.durationTimer);
    clearTimeout(s.aloneTimeout);
    s.unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
    s.unsubs = [];

    s.peers.forEach((p) => closePeer(p));
    s.peers.clear();
    if (s.media) stopLocalMedia(s.media);

    els.grid.innerHTML = '';
    document.body.classList.remove('in-call');
    els.mute.setAttribute('aria-pressed', 'false');
    els.camera.setAttribute('aria-pressed', 'false');
    els.mute.firstElementChild.className = 'fa-solid fa-microphone';
    els.camera.firstElementChild.className = 'fa-solid fa-video';

    if (incoming) {
        renderIncoming();
        return;
    }
    if (note) showNote(s.label, note);
    else hideBar();
}

export async function leaveCall(note = 'Call ended') {
    const s = session;
    if (!s) return;
    const joined = s.joined;
    const created = s.created;
    teardownSession(s, note);

    if (!joined) {
        if (created) updateDoc(s.callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
        return;
    }

    try {
        const snap = await getDocs(collection(s.callRef, 'participants'));
        const others = snap.docs.filter((d) => d.id !== me());
        // Still a participant here, so this write is allowed
        if (others.length === 0) {
            await updateDoc(s.callRef, { status: 'ended', endedAt: serverTimestamp() });
        }
    } catch { /* someone else may have ended it first */ }

    try { await deleteDoc(s.meRef); } catch { /* ignore */ }
}

export function endActiveCall() {
    if (incoming) declineIncoming();
    return leaveCall('Call ended');
}

/* ---------- peers ---------- */

function ensurePeer(s, uid, info) {
    let peer = s.peers.get(uid);
    if (peer) return peer;

    const safeInfo = info || s.participants.get(uid) || { displayName: 'Participant' };
    peer = {
        uid,
        info: safeInfo,
        pc: null,
        remoteStream: null,
        remoteSet: false,
        pendingIn: [],
        analyser: null,
        dropTimeout: null,
        ui: addTile(safeInfo, false),
        audio: document.createElement('audio')
    };
    peer.audio.autoplay = true;
    peer.ui.tile.appendChild(peer.audio);
    setTileState(peer.ui, 'Connecting…');
    s.peers.set(uid, peer);
    updateHeader(s);
    return peer;
}

function resetPeerConnection(peer) {
    clearTimeout(peer.dropTimeout);
    if (peer.pc) {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        try { peer.pc.close(); } catch { /* ignore */ }
    }
    peer.pc = null;
    peer.remoteSet = false;
    peer.pendingIn = [];
    peer.analyser = null;
}

function closePeer(peer) {
    resetPeerConnection(peer);
    peer.audio.srcObject = null;
    peer.ui.video.srcObject = null;
    peer.ui.tile.remove();
}

function removePeer(s, uid) {
    const peer = s.peers.get(uid);
    if (!peer) return;
    closePeer(peer);
    s.peers.delete(uid);
    updateHeader(s);
}

function markConnected(s) {
    clearTimeout(s.aloneTimeout);
    if (s.startedAt) return;
    s.startedAt = Date.now();
    s.durationTimer = setInterval(() => updateHeader(s), 1000);
    updateHeader(s);
}

function buildPc(s, peer) {
    resetPeerConnection(peer);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peer.pc = pc;
    peer.remoteStream = new MediaStream();

    s.media.send.getTracks().forEach((track) => pc.addTrack(track, s.media.send));

    pc.ontrack = (event) => {
        const tracks = event.streams[0] ? event.streams[0].getTracks() : [event.track];
        tracks.forEach((track) => {
            if (!peer.remoteStream.getTracks().includes(track)) peer.remoteStream.addTrack(track);

            if (track.kind === 'audio' && !peer.analyser) {
                try {
                    const ac = getAudioCtx();
                    const analyser = ac.createAnalyser();
                    analyser.fftSize = 512;
                    ac.createMediaStreamSource(peer.remoteStream).connect(analyser);
                    peer.analyser = analyser;
                } catch { /* speaking indicator is optional */ }
            }
        });

        peer.audio.srcObject = peer.remoteStream;
        peer.audio.play().catch(() => {});
        if (peer.remoteStream.getVideoTracks().length) {
            peer.ui.video.srcObject = peer.remoteStream;
            peer.ui.video.play().catch(() => {});
            peer.ui.tile.classList.add('has-video');
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) sendSignal(s, peer.uid, 'candidate', serializeCandidate(event.candidate));
    };

    pc.onconnectionstatechange = () => {
        if (session !== s || peer.pc !== pc) return;
        const st = pc.connectionState;
        if (st === 'connected') {
            clearTimeout(peer.dropTimeout);
            setTileState(peer.ui, '');
            markConnected(s);
        } else if (st === 'connecting') {
            setTileState(peer.ui, 'Connecting…');
        } else if (st === 'disconnected') {
            setTileState(peer.ui, 'Reconnecting…');
            clearTimeout(peer.dropTimeout);
            peer.dropTimeout = setTimeout(() => {
                if (session === s && peer.pc === pc && pc.connectionState !== 'connected') {
                    setTileState(peer.ui, 'Connection lost');
                }
            }, 8000);
        } else if (st === 'failed') {
            setTileState(peer.ui, 'Connection failed');
        }
    };

    return pc;
}

/* ---------- signalling ---------- */

async function sendSignal(s, to, kind, payload) {
    try {
        await addDoc(collection(s.callRef, 'signals'), {
            from: me(),
            to,
            kind,
            payload,
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error(`Error sending ${kind} signal:`, err);
    }
}

async function offerTo(s, peer) {
    const pc = buildPc(s, peer);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (session !== s || peer.pc !== pc) return;
        await sendSignal(s, peer.uid, 'offer', { type: offer.type, sdp: offer.sdp });
    } catch (err) {
        console.error('Error creating offer:', err);
        setTileState(peer.ui, 'Connection failed');
    }
}

function addRemoteCandidate(peer, data) {
    const init = {
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
        usernameFragment: data.usernameFragment
    };
    if (!peer.pc || !peer.remoteSet) {
        peer.pendingIn.push(init);
        return;
    }
    peer.pc.addIceCandidate(init).catch((err) => console.warn('addIceCandidate failed:', err));
}

function flushCandidates(peer) {
    peer.pendingIn.splice(0).forEach((init) => {
        peer.pc.addIceCandidate(init).catch((err) => console.warn('addIceCandidate failed:', err));
    });
}

async function handleSignal(s, snap) {
    const sig = snap.data();
    deleteDoc(snap.ref).catch(() => {});

    const created = sig.createdAt && sig.createdAt.toMillis ? sig.createdAt.toMillis() : Date.now();
    if (created < s.joinedAt - 1000) return;   // left over from an earlier session
    if (sig.from === me()) return;

    try {
        if (sig.kind === 'offer') {
            const peer = ensurePeer(s, sig.from, s.participants.get(sig.from));
            const pendingCandidates = peer.pendingIn.slice(); // candidates that raced ahead of the offer
            const pc = buildPc(s, peer);
            peer.pendingIn = pendingCandidates;
            await pc.setRemoteDescription({ type: sig.payload.type, sdp: sig.payload.sdp });
            peer.remoteSet = true;
            flushCandidates(peer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (session !== s || peer.pc !== pc) return;
            await sendSignal(s, sig.from, 'answer', { type: answer.type, sdp: answer.sdp });
        } else if (sig.kind === 'answer') {
            const peer = s.peers.get(sig.from);
            if (!peer || !peer.pc || peer.remoteSet) return;
            await peer.pc.setRemoteDescription({ type: sig.payload.type, sdp: sig.payload.sdp });
            peer.remoteSet = true;
            flushCandidates(peer);
        } else if (sig.kind === 'candidate') {
            const peer = ensurePeer(s, sig.from, s.participants.get(sig.from));
            addRemoteCandidate(peer, sig.payload);
        }
    } catch (err) {
        console.error(`Error handling ${sig.kind}:`, err);
    }
}

function watchSignals(s) {
    const q = query(collection(s.callRef, 'signals'), where('to', '==', me()));
    s.unsubs.push(onSnapshot(q, (snap) => {
        if (session !== s) return;
        snap.docChanges().forEach((change) => {
            if (change.type === 'added') handleSignal(s, change.doc);
        });
    }, (err) => console.error('Signal listener error:', err)));
}

function watchParticipants(s) {
    s.unsubs.push(onSnapshot(collection(s.callRef, 'participants'), (snap) => {
        if (session !== s) return;

        snap.docChanges().forEach((change) => {
            const uid = change.doc.id;
            if (uid === me()) return;
            const d = change.doc.data({ serverTimestamps: 'estimate' });

            if (change.type === 'removed') {
                s.participants.delete(uid);
                removePeer(s, uid);
                return;
            }

            s.participants.set(uid, d);
            const existing = s.peers.get(uid);
            if (existing) {
                existing.info = d;
                existing.ui.name.textContent = d.displayName || 'Anonymous';
                ctx.setAvatar(existing.ui.avatar, d.profilePic);
            }
            if (change.type !== 'added' || existing) return;

            const theirs = d.joinedAt && d.joinedAt.toMillis ? d.joinedAt.toMillis() : null;
            if (theirs === null) return;

            // Whoever joined later is the one who makes the offer
            const theyAreEarlier = theirs < s.joinedAt || (theirs === s.joinedAt && uid < me());
            if (theyAreEarlier) {
                const seen = d.lastSeen && d.lastSeen.toMillis ? d.lastSeen.toMillis() : 0;
                if (seen < s.joinedAt - FRESH_MS) return; // left behind by a crashed tab
                offerTo(s, ensurePeer(s, uid, d));
            } else {
                ensurePeer(s, uid, d); // they will send us an offer
            }
        });

        updateHeader(s);
    }, (err) => console.error('Participant listener error:', err)));
}

function watchCallDoc(s) {
    s.unsubs.push(onSnapshot(s.callRef, (snap) => {
        const d = snap.data();
        if (!d || session !== s) return;
        s.members = d.members || s.members;
        if (d.status === 'ended') leaveCall('Call ended');
    }, (err) => console.error('Call listener error:', err)));
}

/* ---------- starting and inviting ---------- */

async function createCall(users, video, label) {
    const user = ctx && ctx.auth.currentUser;
    if (!user || session || incoming) return;

    const uids = [...new Set(users.map((u) => u.uid).filter((id) => id && id !== user.uid))]
        .slice(0, MAX_MEMBERS - 1);
    if (!uids.length) return;

    const profile = ctx.getProfile();
    const callRef = doc(collection(ctx.db, 'calls'));
    const data = {
        hostUid: user.uid,
        hostName: profile.displayName,
        hostPic: safePic(profile.profilePic),
        members: [user.uid, ...uids],
        video: !!video,
        status: 'active',
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
    };

    const s = newSession(callRef.id, data, label);
    await runSession(s, data);
}

export function startCall(peer, video = false) {
    if (!peer || !peer.uid) return;
    return createCall([peer], video, peer.displayName || 'Call');
}

export function startGroupCall(users, video = false) {
    return createCall(users, video, 'Group call');
}

export async function inviteToCall(peer) {
    const s = session;
    if (!s || !s.joined || !peer || !peer.uid) return;
    if (s.members.includes(peer.uid)) return;
    if (s.members.length >= MAX_MEMBERS) {
        alert(`A call can have at most ${MAX_MEMBERS} people invited.`);
        return;
    }
    try {
        await updateDoc(s.callRef, { members: arrayUnion(peer.uid) });
        s.members = [...s.members, peer.uid];
    } catch (err) {
        console.error('Error inviting to call:', err);
    }
}

export function isInCall() {
    return !!session;
}

/* ---------- receiving ---------- */

function clearIncoming() {
    if (!incoming) return;
    incoming = null;
    stopRing();
    if (!session) hideBar();
}

function declineIncoming() {
    if (!incoming) return;
    dismissed.add(incoming.id);
    clearIncoming();
}

function acceptIncoming() {
    const inc = incoming;
    if (!inc || session) return;
    clearIncoming();
    runSession(newSession(inc.id, inc.data, inc.data.hostName), null);
}

function isLive(d) {
    if (d.status !== 'active') return false;
    const last = d.lastActive && d.lastActive.toMillis ? d.lastActive.toMillis() : Date.now();
    return Date.now() - last < STALE_CALL_MS;
}

function considerCall(id, d) {
    const live = isLive(d);

    if (incoming && incoming.id === id) {
        if (!live) clearIncoming();
        else incoming.data = d;
        return;
    }

    if (!live) {
        // Clean up calls whose participants all vanished (best effort)
        if (d.status === 'active') {
            updateDoc(doc(ctx.db, 'calls', id), { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
        }
        return;
    }
    if (d.hostUid === me() || dismissed.has(id) || session || incoming) return;

    incoming = { id, data: d };
    renderIncoming();
    startRing();
}

function listenForIncoming(uid) {
    if (incomingUnsub) incomingUnsub();

    // Needs a composite index: calls → members (Arrays) + status (Ascending)
    const q = query(
        collection(ctx.db, 'calls'),
        where('members', 'array-contains', uid),
        where('status', '==', 'active')
    );

    incomingUnsub = onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            const id = change.doc.id;
            if (change.type === 'removed') {
                if (incoming && incoming.id === id) clearIncoming();
                return;
            }
            considerCall(id, change.doc.data());
        });
    }, (err) => console.error('Incoming call listener error:', err));
}

/* ---------- controls ---------- */

function toggleMute() {
    const s = session;
    if (!s || !s.media) return;
    const tracks = s.media.send.getAudioTracks();
    if (!tracks.length) return;
    const muted = tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = !muted; });
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.title = muted ? 'Unmute' : 'Mute';
    els.mute.setAttribute('aria-label', els.mute.title);
    els.mute.firstElementChild.className = muted ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone';
    if (s.localUi) setTileState(s.localUi, muted ? 'Muted' : '');
}

function toggleCamera() {
    const s = session;
    if (!s || !s.media) return;
    const tracks = s.media.send.getVideoTracks();
    if (!tracks.length) return;
    const off = tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = !off; });
    els.camera.setAttribute('aria-pressed', String(off));
    els.camera.title = off ? 'Turn camera on' : 'Turn camera off';
    els.camera.setAttribute('aria-label', els.camera.title);
    els.camera.firstElementChild.className = off ? 'fa-solid fa-video-slash' : 'fa-solid fa-video';
}

/* ---------- init ---------- */

export function initCalls(context) {
    ctx = context;
    cacheElements();
    if (!els.bar) return;

    els.accept.addEventListener('click', acceptIncoming);
    els.hangup.addEventListener('click', () => {
        if (incoming && !session) declineIncoming();
        else leaveCall('Call ended');
    });
    els.mute.addEventListener('click', toggleMute);
    els.camera.addEventListener('click', toggleCamera);

    window.addEventListener('beforeunload', () => {
        const s = session;
        if (!s || !s.joined) return;
        if (s.peers.size === 0) updateDoc(s.callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
        deleteDoc(s.meRef).catch(() => {});
    });

    const user = ctx.auth.currentUser;
    if (user) listenForIncoming(user.uid);
}
