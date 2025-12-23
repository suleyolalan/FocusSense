// js/auth-login.js
import { auth } from "./firebaseConfig.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

// DOM
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg || "";
  errorEl.style.color = "#ef4444";
}

function showSuccess(msg) {
  errorEl.textContent = msg || "";
  errorEl.style.color = "#10b981";
}

// Giriş Yap
loginBtn.addEventListener("click", async () => {
  showError("");
  
  const email = emailEl.value.trim();
  const password = passEl.value;
  
  if (!email || !password) {
    showError("E-posta ve şifre gerekli!");
    return;
  }
  
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    localStorage.setItem("fs_email", cred.user.email);
    showSuccess("Giriş başarılı! Yönlendiriliyorsunuz...");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 500);
  } catch (e) {
    console.error("Login error:", e);
    
    if (e.code === "auth/user-not-found") {
      showError("Kullanıcı bulunamadı. Kayıt olun.");
    } else if (e.code === "auth/wrong-password") {
      showError("Yanlış şifre!");
    } else if (e.code === "auth/invalid-email") {
      showError("Geçersiz e-posta adresi!");
    } else {
      showError("Giriş hatası: " + e.message);
    }
  }
});

// Kayıt Ol
registerBtn.addEventListener("click", async () => {
  showError("");
  
  const email = emailEl.value.trim();
  const password = passEl.value;
  
  if (!email || !password) {
    showError("E-posta ve şifre gerekli!");
    return;
  }
  
  if (password.length < 6) {
    showError("Şifre en az 6 karakter olmalı!");
    return;
  }
  
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    localStorage.setItem("fs_email", cred.user.email);
    showSuccess("Kayıt başarılı! Yönlendiriliyorsunuz...");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 500);
  } catch (e) {
    console.error("Register error:", e);
    
    if (e.code === "auth/email-already-in-use") {
      showError("Bu e-posta zaten kayıtlı! Giriş yapın.");
    } else if (e.code === "auth/weak-password") {
      showError("Şifre çok zayıf! En az 6 karakter kullanın.");
    } else if (e.code === "auth/invalid-email") {
      showError("Geçersiz e-posta adresi!");
    } else {
      showError("Kayıt hatası: " + e.message);
    }
  }
});

