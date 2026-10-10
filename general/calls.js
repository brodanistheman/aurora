import {
    doc, collection, addDoc, setDoc, updateDoc, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/* ==========================================================================
   Calling: 1:1 voice / video over WebRTC, signalled through Firestore.

   calls/{callId}                       call state, offer, answer
   calls/{callId}/callerCandidates/*    ICE candidates from the caller
   calls/{callId}/calleeCandidates/*    ICE candidates from the callee

   The UI is an inline bar docked at the top of the chat column (#call-bar).
   Nothing here opens a modal or overlay.
   ========================================================================== */

const RTC_CONFIG = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
        // For users behind strict NATs add a TURN server here:
        // { urls: 'turn:your.turn.host:3478', username: '...', credential: '...' }
    ]
};

const RING_TIMEOUT_MS = 40000;   // caller gives up
const STALE_CALL_MS = 45000;     // callee ignores older ringing calls
const NOTE_MS = 2500;            // how long "Call ended" stays visible
const MAX_PIC_CHARS = 200000;    // keep call docs small

const els = {};
let ctx = null;
let call = null;        // the call this tab is currently in
let incoming = null;    // a ringing call waiting for this user
let incomingUnsub = null;
let noteTimer = null;
let ringTimer = null;
let audioCtx = null;
const originalTitle = document.title;

/* ---------- helpers ---------- */

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

async function getMedia(video) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!video) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
        return await navigator.mediaDevices.getUserMedia({ audio, video: { facingMode: 'user' } });
    } catch (err) {
        if (err && err.name === 'NotAllowedError') throw err;
        // No camera available: fall back to audio only.
        return navigator.mediaDevices.getUserMedia({ audio, video: false });
    }
}

/* ---------- ring tone ---------- */

function startRing() {
    stopRing();
    const beep = () => {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const t = audioCtx.currentTime;
            [440, 480].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, t + i * 0.22);
                gain.gain.exponentialRampToValueAtTime(0.06, t + i * 0.22 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
                osc.connect(gain).connect(audioCtx.destination);
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
    els.videos = document.getElementById('call-videos');
    els.remoteVideo = document.getElementById('remote-video');
    els.localVideo = document.getElementById('local-video');
    els.remoteAudio = document.getElementById('remote-audio');
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

function paint({ mode, peer, text, video = false, state = null }) {
    clearTimeout(noteTimer);
    noteTimer = null;

    els.bar.classList.remove('hidden');
    els.bar.dataset.mode = mode;

    ctx.setAvatar(els.avatar, peer && peer.profilePic);
    els.name.textContent = (peer && peer.displayName) || 'Anonymous';
    els.status.textContent = text;

    const live = mode === 'outgoing' || mode === 'connecting' || mode === 'active';
    setHidden(els.accept, mode !== 'incoming');
    setHidden(els.hangup, mode === 'note');
    setHidden(els.mute, mode !== 'active');

    const hasCamera = !!(state && state.localStream && state.localStream.getVideoTracks().length);
    setHidden(els.camera, !(mode === 'active' && hasCamera));
    setHidden(els.videos, !(live && video));

    els.hangup.title = mode === 'incoming' ? 'Decline' : (mode === 'outgoing' ? 'Cancel call' : 'End call');
    els.hangup.setAttribute('aria-label', els.hangup.title);
    els.accept.title = video ? 'Accept video call' : 'Accept call';
    els.accept.setAttribute('aria-label', els.accept.title);
}

function renderCall() {
    if (!call) return;
    const text = {
        outgoing: 'Calling…',
        connecting: 'Connecting…',
        active: formatDuration(Date.now() - (call.startedAt || Date.now()))
    }[call.phase];
    paint({ mode: call.phase, peer: call.peer, text, video: call.video, state: call });
    if (call.localStream) els.localVideo.srcObject = call.localStream;
}

function renderIncoming() {
    if (!incoming) return;
    const d = incoming.data;
    paint({
        mode: 'incoming',
        peer: { displayName: d.callerName, profilePic: d.callerPic },
        text: d.video ? 'Incoming video call' : 'Incoming voice call',
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

function showNote(peer, note) {
    paint({ mode: 'note', peer, text: note });
    noteTimer = setTimeout(() => {
        noteTimer = null;
        if (!call && !incoming) hideBar();
    }, NOTE_MS);
}

/* ---------- call state ---------- */

function newCallState(id, role, peer, video) {
    return {
        id, role, peer, video,
        phase: role === 'caller' ? 'outgoing' : 'connecting',
        pc: null,
        localStream: null,
        remoteStream: null,
        unsubs: [],
        pendingOut: [],
        pendingIn: [],
        docReady: false,
        remoteSet: false,
        answerSet: false,
        startedAt: 0,
        timerId: null,
        ringTimeout: null,
        dropTimeout: null
    };
}

function teardown(state, note) {
    if (call === state) call = null;

    clearTimeout(state.ringTimeout);
    clearTimeout(state.dropTimeout);
    clearInterval(state.timerId);
    state.unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
    state.unsubs = [];

    if (state.pc) {
        state.pc.onicecandidate = null;
        state.pc.ontrack = null;
        state.pc.onconnectionstatechange = null;
        try { state.pc.close(); } catch { /* ignore */ }
    }
    if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());

    els.remoteAudio.srcObject = null;
    els.remoteVideo.srcObject = null;
    els.localVideo.srcObject = null;
    document.body.classList.remove('in-call');
    els.mute.setAttribute('aria-pressed', 'false');
    els.camera.setAttribute('aria-pressed', 'false');
    els.mute.firstElementChild.className = 'fa-solid fa-microphone';
    els.camera.firstElementChild.className = 'fa-solid fa-video';

    if (incoming) return;
    if (note) showNote(state.peer, note);
    else hideBar();
}

function setPhase(state, phase) {
    state.phase = phase;
    if (call === state) renderCall();
}

function goActive(state) {
    if (call !== state || state.phase === 'active') return;
    clearTimeout(state.ringTimeout);
    state.startedAt = Date.now();
    state.phase = 'active';
    renderCall();
    state.timerId = setInterval(() => {
        if (call === state) els.status.textContent = formatDuration(Date.now() - state.startedAt);
    }, 1000);
}

/* ---------- WebRTC plumbing ---------- */

async function pushCandidate(state, candidate) {
    const sub = state.role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    try {
        await addDoc(collection(ctx.db, 'calls', state.id, sub), serializeCandidate(candidate));
    } catch (err) {
        console.error('Error sending ICE candidate:', err);
    }
}

function sendCandidate(state, candidate) {
    if (!state.docReady) {
        state.pendingOut.push(candidate);
        return;
    }
    pushCandidate(state, candidate);
}

function addRemoteCandidate(state, data) {
    const init = {
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
        usernameFragment: data.usernameFragment
    };
    if (!state.remoteSet) {
        state.pendingIn.push(init);
        return;
    }
    state.pc.addIceCandidate(init).catch((err) => console.warn('addIceCandidate failed:', err));
}

async function applyRemoteDescription(state, desc) {
    await state.pc.setRemoteDescription({ type: desc.type, sdp: desc.sdp });
    state.remoteSet = true;
    const queued = state.pendingIn.splice(0);
    queued.forEach((init) => {
        state.pc.addIceCandidate(init).catch((err) => console.warn('addIceCandidate failed:', err));
    });
}

function attachRemote(state) {
    els.remoteAudio.srcObject = state.remoteStream;
    els.remoteVideo.srcObject = state.remoteStream;
    els.remoteAudio.play().catch(() => {});
    els.remoteVideo.play().catch(() => {});
}

function createPeer(state) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.pc = pc;
    state.remoteStream = new MediaStream();

    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));

    pc.ontrack = (event) => {
        const incomingTracks = event.streams[0] ? event.streams[0].getTracks() : [event.track];
        incomingTracks.forEach((track) => {
            if (!state.remoteStream.getTracks().includes(track)) state.remoteStream.addTrack(track);
        });
        attachRemote(state);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) sendCandidate(state, event.candidate);
    };

    pc.onconnectionstatechange = () => {
        if (call !== state) return;
        const s = pc.connectionState;
        if (s === 'connected') {
            clearTimeout(state.dropTimeout);
            goActive(state);
        } else if (s === 'disconnected') {
            clearTimeout(state.dropTimeout);
            state.dropTimeout = setTimeout(() => {
                if (call === state && pc.connectionState !== 'connected') endCall('ended', 'Connection lost');
            }, 8000);
        } else if (s === 'failed') {
            endCall('ended', 'Connection failed');
        }
    };

    return pc;
}

function watchCallDoc(state, callRef) {
    state.unsubs.push(onSnapshot(callRef, async (snap) => {
        if (call !== state) return;
        const d = snap.data();
        if (!d) return;

        if (state.role === 'caller' && d.answer && !state.answerSet) {
            state.answerSet = true;
            try {
                await applyRemoteDescription(state, d.answer);
                if (call === state && state.phase === 'outgoing') {
                    clearTimeout(state.ringTimeout);
                    setPhase(state, 'connecting');
                }
            } catch (err) {
                console.error('Error applying answer:', err);
                endCall('ended', 'Connection failed');
            }
        }

        if (d.status === 'declined') teardown(state, 'Call declined');
        else if (d.status === 'missed') teardown(state, 'No answer');
        else if (d.status === 'ended') teardown(state, 'Call ended');
    }, (err) => console.error('Call listener error:', err)));
}

function watchCandidates(state, callRef, sub) {
    state.unsubs.push(onSnapshot(collection(callRef, sub), (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === 'added' && call === state) addRemoteCandidate(state, change.doc.data());
        });
    }, (err) => console.error('Candidate listener error:', err)));
}

/* ---------- starting a call ---------- */

export async function startCall(peer, video = false) {
    const user = ctx && ctx.auth.currentUser;
    if (!user || call || incoming || !peer || !peer.uid || peer.uid === user.uid) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
        alert('Calling is not supported in this browser.');
        return;
    }

    const callRef = doc(collection(ctx.db, 'calls'));
    const state = newCallState(callRef.id, 'caller', peer, video);
    call = state;
    document.body.classList.add('in-call');
    renderCall();

    try {
        state.localStream = await getMedia(video);
    } catch (err) {
        if (call === state) {
            teardown(state, null);
            alert(mediaErrorMessage(err));
        }
        return;
    }

    // Cancelled while the permission prompt was open
    if (call !== state) {
        state.localStream.getTracks().forEach((t) => t.stop());
        return;
    }
    state.video = video && state.localStream.getVideoTracks().length > 0;
    renderCall();

    try {
        const pc = createPeer(state);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (call !== state) return;

        const profile = ctx.getProfile();
        await setDoc(callRef, {
            callerUid: user.uid,
            callerName: profile.displayName,
            callerPic: safePic(profile.profilePic),
            calleeUid: peer.uid,
            calleeName: peer.displayName || 'Anonymous',
            video: state.video,
            offer: { type: offer.type, sdp: offer.sdp },
            status: 'ringing',
            createdAt: serverTimestamp()
        });
        state.docReady = true;

        // Cancelled while the document was being written
        if (call !== state) {
            updateDoc(callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
            return;
        }

        state.pendingOut.splice(0).forEach((c) => pushCandidate(state, c));
        watchCallDoc(state, callRef);
        watchCandidates(state, callRef, 'calleeCandidates');

        state.ringTimeout = setTimeout(() => {
            if (call === state && state.phase === 'outgoing') endCall('missed', 'No answer');
        }, RING_TIMEOUT_MS);
    } catch (err) {
        console.error('Error starting call:', err);
        if (call === state) {
            teardown(state, 'Could not start call');
            if (state.docReady) {
                updateDoc(callRef, { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
            }
        }
    }
}

/* ---------- receiving a call ---------- */

function clearIncoming() {
    if (!incoming) return;
    clearTimeout(incoming.timer);
    incoming = null;
    stopRing();
    if (!call) hideBar();
}

async function declineById(id) {
    try {
        await updateDoc(doc(ctx.db, 'calls', id), { status: 'declined', endedAt: serverTimestamp() });
    } catch { /* already finished */ }
}

function declineIncoming() {
    if (!incoming) return;
    const id = incoming.id;
    clearIncoming();
    declineById(id);
}

async function acceptIncoming() {
    const inc = incoming;
    if (!inc || call) return;
    clearIncoming();

    const d = inc.data;
    const peer = { uid: d.callerUid, displayName: d.callerName, profilePic: d.callerPic };
    const state = newCallState(inc.id, 'callee', peer, !!d.video);
    state.docReady = true;
    call = state;
    document.body.classList.add('in-call');
    renderCall();

    const callRef = doc(ctx.db, 'calls', inc.id);

    try {
        state.localStream = await getMedia(state.video);
    } catch (err) {
        if (call === state) {
            teardown(state, null);
            alert(mediaErrorMessage(err));
        }
        declineById(inc.id);
        return;
    }

    if (call !== state) {
        state.localStream.getTracks().forEach((t) => t.stop());
        return;
    }
    renderCall();

    try {
        const pc = createPeer(state);
        await applyRemoteDescription(state, d.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (call !== state) return;

        await updateDoc(callRef, {
            status: 'active',
            answer: { type: answer.type, sdp: answer.sdp }
        });
        state.answerSet = true;
        if (call !== state) return;

        watchCallDoc(state, callRef);
        watchCandidates(state, callRef, 'callerCandidates');
    } catch (err) {
        console.error('Error accepting call:', err);
        if (call === state) teardown(state, 'Call is no longer available');
    }
}

function listenForIncoming(uid) {
    if (incomingUnsub) incomingUnsub();

    const q = query(
        collection(ctx.db, 'calls'),
        where('calleeUid', '==', uid),
        where('status', '==', 'ringing')
    );

    incomingUnsub = onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            const id = change.doc.id;

            if (change.type === 'removed') {
                if (incoming && incoming.id === id) clearIncoming();
                return;
            }
            if (change.type !== 'added') return;

            const data = change.doc.data();
            const created = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
            const age = Date.now() - created;
            if (age > STALE_CALL_MS) return;

            if (call || incoming) {
                declineById(id); // busy
                return;
            }

            incoming = { id, data };
            incoming.timer = setTimeout(() => {
                if (incoming && incoming.id === id) clearIncoming();
            }, Math.max(1000, STALE_CALL_MS - age));

            renderIncoming();
            startRing();
        });
    }, (err) => console.error('Incoming call listener error:', err));
}

/* ---------- controls ---------- */

export async function endCall(status = 'ended', note = null) {
    const state = call;
    if (!state) return;

    const id = state.id;
    const wasWritten = state.docReady;
    const finalNote = note || (state.phase === 'outgoing' ? 'Call cancelled' : 'Call ended');
    teardown(state, finalNote);

    if (!wasWritten) return;
    try {
        await updateDoc(doc(ctx.db, 'calls', id), { status, endedAt: serverTimestamp() });
    } catch { /* the other side may have ended it first */ }
}

export function endActiveCall() {
    if (incoming) declineIncoming();
    return endCall('ended');
}

function toggleMute() {
    if (!call || !call.localStream) return;
    const tracks = call.localStream.getAudioTracks();
    if (!tracks.length) return;
    const muted = tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = !muted; });
    els.mute.setAttribute('aria-pressed', String(muted));
    els.mute.title = muted ? 'Unmute' : 'Mute';
    els.mute.setAttribute('aria-label', els.mute.title);
    els.mute.firstElementChild.className = muted ? 'fa-solid fa-microphone-slash' : 'fa-solid fa-microphone';
}

function toggleCamera() {
    if (!call || !call.localStream) return;
    const tracks = call.localStream.getVideoTracks();
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
        if (incoming && !call) declineIncoming();
        else endCall('ended');
    });
    els.mute.addEventListener('click', toggleMute);
    els.camera.addEventListener('click', toggleCamera);

    window.addEventListener('beforeunload', () => {
        if (call && call.docReady) {
            updateDoc(doc(ctx.db, 'calls', call.id), { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
        }
    });

    const user = ctx.auth.currentUser;
    if (user) listenForIncoming(user.uid);
}
