import { doc, getDoc, updateDoc, query, collection, where, getDocs } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const CACHE_PREFIX = "aurora_account_";
const SEQID_PREFIX = "aurora_seqid_";
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

const inFlight = new Map();

function cacheKey(uid) {
    return `${CACHE_PREFIX}${uid}`;
}

function readCache(uid) {
    try {
        const raw = localStorage.getItem(cacheKey(uid));
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeCache(uid, data) {
    try {
        localStorage.setItem(cacheKey(uid), JSON.stringify({ data, cachedAt: Date.now() }));
    } catch {}
}

export function getCachedAccount(uid) {
    const entry = readCache(uid);
    return entry ? entry.data : null;
}

export function setCachedAccount(uid, data) {
    writeCache(uid, data);
}

export function invalidateAccount(uid) {
    try {
        localStorage.removeItem(cacheKey(uid));
    } catch {}
}

async function fetchAccountFresh(db, uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    writeCache(uid, data);
    if (data.sequentialId !== undefined && data.sequentialId !== null) {
        try {
            localStorage.setItem(`${SEQID_PREFIX}${data.sequentialId}`, uid);
        } catch {}
    }
    return data;
}

export async function loadAccount(db, uid, { maxAgeMs = DEFAULT_MAX_AGE_MS, onFresh } = {}) {
    const entry = readCache(uid);
    const isFresh = entry && Date.now() - entry.cachedAt < maxAgeMs;

    if (entry && !isFresh) {
        const pending = inFlight.get(uid) || fetchAccountFresh(db, uid).finally(() => inFlight.delete(uid));
        inFlight.set(uid, pending);
        pending.then((data) => {
            if (data && onFresh) onFresh(data);
        }).catch(() => {});
    }

    if (entry) {
        return { data: entry.data, fromCache: true };
    }

    if (inFlight.has(uid)) {
        const data = await inFlight.get(uid);
        return { data, fromCache: false };
    }

    const pending = fetchAccountFresh(db, uid).finally(() => inFlight.delete(uid));
    inFlight.set(uid, pending);
    const data = await pending;
    return { data, fromCache: false };
}

export async function updateAccount(db, uid, patch) {
    await updateDoc(doc(db, "users", uid), patch);
    const current = getCachedAccount(uid) || {};
    const merged = { ...current, ...patch };
    writeCache(uid, merged);
    return merged;
}

export async function resolveUidBySequentialId(db, sequentialId) {
    try {
        const cachedUid = localStorage.getItem(`${SEQID_PREFIX}${sequentialId}`);
        if (cachedUid) return cachedUid;
    } catch {}

    const q = query(collection(db, "users"), where("sequentialId", "==", Number(sequentialId)));
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    writeCache(docSnap.id, docSnap.data());
    try {
        localStorage.setItem(`${SEQID_PREFIX}${sequentialId}`, docSnap.id);
    } catch {}
    return docSnap.id;
}
