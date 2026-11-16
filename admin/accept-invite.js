(function () {
  const el = {
    subtitle: document.getElementById("modeSubtitle"),
    error: document.getElementById("formError"),
    form: document.getElementById("acceptForm"),
    emailDisplay: document.getElementById("emailDisplay"),
    nameInput: document.getElementById("nameInput"),
    passwordInput: document.getElementById("passwordInput"),
    submitBtn: document.getElementById("submitBtn"),
  };

  const token = new URLSearchParams(window.location.search).get("token");

  function showError(message) {
    el.subtitle.textContent = "";
    el.error.textContent = message;
    el.error.classList.remove("hidden");
  }

  (async function init() {
    if (!token) {
      showError("ลิงก์ไม่ถูกต้อง: ไม่พบโทเค็น");
      return;
    }
    try {
      const { invite } = await AdminAPI.getInvite(token);
      el.emailDisplay.value = invite.email;
      el.subtitle.textContent = `คำเชิญสำหรับ ${invite.email} (${roleLabel(invite.role)})`;
      el.form.style.display = "block";
    } catch (err) {
      const messages = {
        invite_not_found: "ไม่พบคำเชิญนี้",
        invite_already_used: "ลิงก์นี้ถูกใช้ไปแล้ว",
        invite_expired: "ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่",
      };
      showError(messages[err.message] || "เกิดข้อผิดพลาด");
    }
  })();

  function roleLabel(role) {
    return { owner: "เจ้าของร้าน", admin: "แอดมิน", staff: "พนักงาน" }[role] || role;
  }

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.error.classList.add("hidden");
    el.submitBtn.disabled = true;
    el.submitBtn.textContent = "กำลังสร้างบัญชี...";

    try {
      const result = await AdminAPI.acceptInvite(token, {
        name: el.nameInput.value.trim() || undefined,
        password: el.passwordInput.value,
      });
      AdminAPI.setToken(result.token);
      window.location.href = "index.html";
    } catch (err) {
      el.error.textContent = err.message || "สร้างบัญชีไม่สำเร็จ";
      el.error.classList.remove("hidden");
      el.submitBtn.disabled = false;
      el.submitBtn.textContent = "สร้างบัญชี";
    }
  });
})();
