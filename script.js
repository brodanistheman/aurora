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
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (email && password) {
            try {
                let userCredential;
                try {
                    userCredential = await signInWithEmailAndPassword(auth, email, password);
                } catch (signInError) {
                    userCredential = await createUserWithEmailAndPassword(auth, email, password);
                }
                localStorage.setItem('optic_user', userCredential.user.email);
                window.location.href = 'chat/';
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}
