/* ---- The focus timer (a real, working timer so the page holds up to a glance) ---- */
(function timer() {
  const clock = document.getElementById("clock");
  const phase = document.getElementById("phase");
  const ring = document.getElementById("ring");
  const startBtn = document.getElementById("start");
  const CIRC = 2 * Math.PI * 86;
  ring.style.strokeDasharray = CIRC;

  let total = 25 * 60, left = total, running = false, tick = null;

  function render() {
    const m = String(Math.floor(left / 60)).padStart(2, "0");
    const s = String(left % 60).padStart(2, "0");
    clock.textContent = `${m}:${s}`;
    ring.style.strokeDashoffset = CIRC * (1 - left / total);
    document.title = running ? `${m}:${s} — StudyLoop` : "StudyLoop — Focus Timer & Revision Hub";
  }
  function stop() { running = false; clearInterval(tick); startBtn.textContent = "Start"; }
  function start() {
    if (running) { stop(); return; }
    running = true; startBtn.textContent = "Pause";
    tick = setInterval(() => {
      left--;
      if (left <= 0) { left = 0; render(); stop(); phase.textContent = "Done — take a break"; return; }
      render();
    }, 1000);
  }

  startBtn.onclick = start;
  document.getElementById("reset").onclick = () => { stop(); left = total; phase.textContent = total <= 300 ? "Break" : "Focus"; render(); };
  document.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      stop();
      total = left = Number(c.dataset.min) * 60;
      phase.textContent = total <= 300 ? "Break" : "Focus";
      render();
    };
  });
  render();
})();

/* ---- Hidden entrance ---- */
(function gate() {
  const scrim = document.getElementById("pad");
  const pad = scrim.querySelector(".pad");
  const dots = [...document.getElementById("dots").children];
  const msg = document.getElementById("padMsg");
  let code = "";
  let busy = false;

  const open = () => { scrim.hidden = false; code = ""; paint(); msg.textContent = "Enter code"; msg.classList.remove("err"); };
  const close = () => { scrim.hidden = true; code = ""; paint(); };

  function paint() {
    dots.forEach((d, i) => d.classList.toggle("filled", i < code.length));
  }

  async function submit() {
    busy = true;
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { location.reload(); return; }
      pad.classList.add("shake");
      setTimeout(() => pad.classList.remove("shake"), 350);
      msg.classList.add("err");
      if (res.status === 429) msg.textContent = `Too many tries. Wait ${data.wait || 15} min.`;
      else if (data.left > 0) msg.textContent = `Wrong code — ${data.left} ${data.left === 1 ? "try" : "tries"} left`;
      else msg.textContent = "Too many tries. Locked for 15 min.";
      code = "";
      paint();
    } catch {
      msg.classList.add("err");
      msg.textContent = "Connection problem. Try again.";
      code = "";
      paint();
    } finally {
      busy = false;
    }
  }

  function push(n) {
    if (busy || code.length >= 4) return;
    code += n;
    paint();
    if (code.length === 4) setTimeout(submit, 120);
  }

  document.querySelectorAll(".keys [data-k]").forEach((b) => (b.onclick = () => push(b.dataset.k)));
  document.getElementById("padDel").onclick = () => { if (!busy) { code = code.slice(0, -1); paint(); } };
  document.getElementById("padCancel").onclick = close;
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

  document.addEventListener("keydown", (e) => {
    if (scrim.hidden) return;
    if (e.key >= "0" && e.key <= "9") push(e.key);
    else if (e.key === "Backspace") { code = code.slice(0, -1); paint(); }
    else if (e.key === "Escape") close();
  });

  // The way in: double-click the dot in the footer, or press the ` key anywhere.
  document.getElementById("unlock").addEventListener("dblclick", open);
  document.addEventListener("keydown", (e) => {
    if (e.key === "`" && scrim.hidden) { e.preventDefault(); open(); }
  });
})();
