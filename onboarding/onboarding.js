import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, runTransaction, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const submitButton = document.getElementById('submit-button');

let isSignUpMode = false;

if (loginTab && signupTab && submitButton) {
    loginTab.addEventListener('click', () => {
        isSignUpMode = false;
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        submitButton.textContent = 'Log In';
    });

    signupTab.addEventListener('click', () => {
        isSignUpMode = true;
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        submitButton.textContent = 'Sign Up';
    });
}

if (authForm) {
    authForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (email && password) {
            try {
                if (isSignUpMode) {
                    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                    const user = userCredential.user;
                    const userDocRef = doc(db, "users", user.uid);

                    const ipResponse = await fetch('https://api.ipify.org?format=json');
                    const ipData = await ipResponse.json();
                    const userIp = ipData.ip;

                    const counterRef = doc(db, "metadata", "userRegistry");
                    const sequentialId = await runTransaction(db, async (transaction) => {
                        const counterDoc = await transaction.get(counterRef);
                        let newId = 1;
                        if (counterDoc.exists()) {
                            newId = counterDoc.data().totalUsers + 1;
                        }
                        transaction.set(counterRef, { totalUsers: newId });
                        return newId;
                    });

                    await setDoc(userDocRef, {
                        email: email,
                        sequentialId: sequentialId,
                        ipAddress: userIp,
                        createdAt: new Date()
                    });
                } else {
                    const userCredential = await signInWithEmailAndPassword(auth, email, password);
                    const user = userCredential.user;
                    const userDocRef = doc(db, "users", user.uid);
                    const userSnapshot = await getDoc(userDocRef);

                    if (!userSnapshot.exists()) {
                        throw new Error("User profile not found in database.");
                    }
                }

                localStorage.setItem('aurora_user', email);
                window.location.href = '../general/';
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}