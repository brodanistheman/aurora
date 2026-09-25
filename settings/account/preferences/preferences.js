import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const toggle = document.getElementById('dark-mode-toggle');

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (toggle) toggle.checked = theme === 'dark';
}

const cachedTheme = localStorage.getItem('aurora_theme');
if (cachedTheme) applyTheme(cachedTheme);

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/aurora/';
        return;
    }

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnapshot = await getDoc(userRef);
        const savedTheme = userSnapshot.exists() ? (userSnapshot.data().theme || 'light') : 'light';
        applyTheme(savedTheme);
        localStorage.setItem('aurora_theme', savedTheme);
    } catch (error) {
        console.error("Failed to load theme preference:", error);
    }

    if (toggle) {
        toggle.addEventListener('change', async () => {
            const newTheme = toggle.checked ? 'dark' : 'light';
            applyTheme(newTheme);
            localStorage.setItem('aurora_theme', newTheme);

            try {
                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, { theme: newTheme });
            } catch (error) {
                console.error("Failed to save theme preference:", error);
            }
        });
    }
});