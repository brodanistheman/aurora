import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

onAuthStateChanged(auth, (user) => {
    if (user) {
        localStorage.setItem('aurora_user', user.email);
        window.location.href = '../general/';
    }
});

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
                    const userId = user.uid;

                    const counterRef = doc(db, "metadata", "userCounter");
                    
                    const registrationOrder = await runTransaction(db, async (transaction) => {
                        const counterSnapshot = await transaction.get(counterRef);
                        
                        let nextOrder = 1;
                        if (counterSnapshot.exists()) {
                            nextOrder = counterSnapshot.data().totalUsers + 1;
                            transaction.update(counterRef, { totalUsers: nextOrder });
                        } else {
                            transaction.set(counterRef, { totalUsers: 1 });
                        }
                        
                        return nextOrder;
                    });

                    await runTransaction(db, async (transaction) => {
                        const userRef = doc(db, "users", userId);
                        transaction.set(userRef, {
                            uid: userId,
                            email: email,
                            registrationOrder: registrationOrder,
                            createdAt: new Date().toISOString()
                        });
                    });
                } else {
                    await signInWithEmailAndPassword(auth, email, password);
                }
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}