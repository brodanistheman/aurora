import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCsCfJXk0dg9Q4TYtDF0qW6dyb2vPjMoSM",
    authDomain: "optic-11418.firebaseapp.com",
    projectId: "optic-11418",
    storageBucket: "optic-11418.firebasestorage.app",
    messagingSenderId: "1026781816164",
    appId: "1:1026781816164:web:16f12b12269ea384888671",
    measurementId: "G-SVHF42ZBQS"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const loginForm = document.getElementById('login-form');
const identityInput = document.getElementById('identity-input');
const passwordInput = document.getElementById('password-input');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let identity = identityInput.value.trim();
        const password = passwordInput.value.trim();

        if (identity && password) {
            if (!identity.includes('@')) {
                identity = `${identity.toLowerCase()}@optic.local`;
            }

            try {
                let userCredential;
                try {
                    userCredential = await signInWithEmailAndPassword(auth, identity, password);
                } catch (signInError) {
                    userCredential = await createUserWithEmailAndPassword(auth, identity, password);
                }
                localStorage.setItem('optic_user', identity);
                window.location.href = '../chat/';
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}
