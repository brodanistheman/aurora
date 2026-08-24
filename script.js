import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

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
const usernameInput = document.getElementById('username-input');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();

        if (username) {
            try {
                localStorage.setItem('optic_username', username);
                await signInAnonymously(auth);
                window.location.href = 'chat/';
            } catch (error) {
                console.error("Authentication error:", error);
            }
        }
    });
}
