(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const TOKEN = params.get("token");

  const screens = {
    loading: document.getElementById("loading"),
    error: document.getElementById("error"),
    wheel: document.getElementById("wheel-screen"),
    result: document.getElementById("result-screen"),
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function showError(msg) {
    document.getElementById("errorText").textContent = msg;
    showScreen("error");
  }

  // رسم گردونه
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const SIZE = canvas.width;
  const R = SIZE / 2;

  let PRIZES = [];
  let N = 0;
  let ARC = 0;
  let currentRotation = 0;
  let spinning = false;
  let userData = null;

  const COLORS = [
    "#00ff41", "#0a5c1e", "#00c853", "#0a3d1a",
    "#39ff14", "#0f8a2e", "#7fff00", "#0a5c1e",
    "#00ff41"
  ];

  function drawWheel(rotationDeg) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate((rotationDeg * Math.PI) / 180);

    for (let i = 0; i < N; i++) {
      const start = i * ARC - Math.PI / 2;
      const end = start + ARC;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R - 6, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // متن
      ctx.save();
      ctx.rotate(start + ARC / 2);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      const lines = PRIZES[i].label.split("|");
      const isJackpot = PRIZES[i].is_jackpot;

      ctx.fillStyle = isJackpot ? "#ffd700" : "#001100";
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 3;
      ctx.font = isJackpot ? "bold 22px Tahoma" : "bold 18px Tahoma";

      if (lines.length > 1) {
        ctx.fillText(lines[0], R - 30, -12);
        ctx.font = "bold 16px Tahoma";
        ctx.fillText(lines[1], R - 30, 12);
      } else {
        ctx.fillText(lines[0], R - 30, 0);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // دریافت جوایز از سرور
  async function loadPrizes() {
    const res = await fetch("/api/prizes");
    PRIZES = await res.json();
    N = PRIZES.length;
    ARC = (2 * Math.PI) / N;
    drawWheel(0);
  }

  // دریافت اطلاعات کاربر
  async function loadUser() {
    if (!TOKEN) return showError("توکن نامعتبر");
    const res = await fetch(`/api/user?token=${TOKEN}`);
    const data = await res.json();
    if (!res.ok) return showError(data.error || "خطا");
    userData = data;
    updateStats();
  }

  function updateStats() {
    document.getElementById("spinsAvailable").textContent = userData.spins_available;
    document.getElementById("spinsUsed").textContent = userData.spins_used;
  }

  // چرخش
  async function spin() {
    if (spinning) return;
    spinning = true;
    document.getElementById("spinBtn").disabled = true;
    document.getElementById("statusText").textContent = "در حال چرخش...";

    let result;
    try {
      const res = await fetch("/api/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      });
      result = await res.json();
      if (!res.ok) throw new Error(result.error || "خطا");
    } catch (e) {
      showError(e.message);
      return;
    }

    // انیمیشن چرخش
    const winnerIndex = result.wheel_index;
    const ARC_DEG = 360 / N;
    let targetBase = (360 - (winnerIndex + 0.5) * ARC_DEG) % 360;
    if (targetBase < 0) targetBase += 360;

    const currentMod = ((currentRotation % 360) + 360) % 360;
    const delta = (targetBase - currentMod + 360) % 360;
    const targetRotation = currentRotation + 6 * 360 + delta;

    const start = currentRotation;
    const duration = 4500;
    const startTime = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);

    function animate(now) {
      const t = Math.min((now - startTime) / duration, 1);
      currentRotation = start + (targetRotation - start) * ease(t);
      drawWheel(currentRotation);
      if (t < 1) requestAnimationFrame(animate);
      else {
        currentRotation = targetRotation % 360;
        showResult(result);
      }
    }
    requestAnimationFrame(animate);
  }

  // نمایش رسید
  function showResult(r) {
    showScreen("result");

    const emoji = document.getElementById("receiptEmoji");
    const title = document.getElementById("receiptTitle");
    const subtitle = document.getElementById("receiptSubtitle");
    const priceRow = document.getElementById("priceRow");
    const discountRow = document.getElementById("discountRow");
    const codeRow = document.getElementById("codeRow");

    if (r.is_respin) {
      emoji.textContent = "🔄";
      title.textContent = "شانس دوباره!";
      title.style.color = "#00ff41";
      subtitle.textContent = "یه شانس اضافه گرفتی، دوباره بچرخون!";
      priceRow.style.display = "none";
      discountRow.style.display = "none";
      codeRow.style.display = "none";
      document.getElementById("receipt").querySelector(".note").textContent = "";
    } else if (r.is_empty) {
      emoji.textContent = "😅";
      title.textContent = "پوچ!";
      title.style.color = "#888";
      subtitle.textContent = "این بار شانس نیاوردی، دفعه بعد بهتره!";
      priceRow.style.display = "none";
      discountRow.style.display = "none";
      codeRow.style.display = "none";
      document.getElementById("receipt").querySelector(".note").textContent = "";
    } else {
      emoji.textContent = r.is_jackpot ? "🏆" : "🎉";
      const lines = r.label.split("|");
      title.textContent = lines[0];
      title.style.color = "#00ff41";
      subtitle.textContent = lines[1] || "";

      if (r.full_price > 0) {
        priceRow.style.display = "flex";
        document.getElementById("fullPrice").textContent = r.full_price + " تومان";
      } else priceRow.style.display = "none";

      if (r.discount_price > 0) {
        discountRow.style.display = "flex";
        document.getElementById("discPrice").textContent = r.discount_price + " تومان";
      } else if (r.discount_percent === 100) {
        discountRow.style.display = "flex";
        document.getElementById("discPrice").textContent = "رایگان 🎁";
      } else discountRow.style.display = "none";

      if (r.discount_code) {
        codeRow.style.display = "flex";
        document.getElementById("discCode").textContent = r.discount_code;
      }
      document.getElementById("receipt").querySelector(".note").textContent = "📸 از این صفحه اسکرین‌شات بگیر و به ادمین بفرست";
    }

    const now = new Date();
    document.getElementById("receiptTime").textContent = now.toLocaleString("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });

    userData.spins_available = r.spins_available;
    userData.spins_used = r.spins_used;
    document.getElementById("backBtn").onclick = () => {
      if (r.spins_available > 0 && userData.spins_used < 10) {
        updateStats();
        document.getElementById("spinBtn").disabled = false;
        document.getElementById("statusText").textContent = "دکمه وسط رو بزن";
        showScreen("wheel");
        spinning = false;
      } else {
        window.Telegram?.WebApp?.close();
        document.getElementById("statusText").textContent = "شانس تمام شد یا به سقف رسیدی";
      }
    };
  }

  // شروع
  document.getElementById("spinBtn").onclick = spin;
  document.body.addEventListener("click", e => {
    if (e.target.id === "spinBtn") spin();
  });

  (async function init() {
    try {
      await loadPrizes();
      await loadUser();
      showScreen("wheel");
    } catch (e) {
      showError("خطا در بارگذاری");
    }
  })();
})();
