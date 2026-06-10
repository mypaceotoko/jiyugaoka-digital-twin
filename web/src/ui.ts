import type { CameraMode } from "./cameras";
import type { TimeOfDay } from "./environment";

const MODE_LABELS: Record<CameraMode, string> = {
  aerial: "📷 俯瞰",
  ground: "🚶 地上",
  cinematic: "🎬 シネマ",
};
const MODE_ORDER: CameraMode[] = ["aerial", "ground", "cinematic"];

const TIME_LABELS: Record<TimeOfDay, string> = {
  day: "☀️ 昼",
  dusk: "🌇 夕方",
  night: "🌙 夜",
};
const TIME_ORDER: TimeOfDay[] = ["day", "dusk", "night"];

export interface UiCallbacks {
  onMode(mode: CameraMode): void;
  onTime(time: TimeOfDay): void;
  onJoystick(x: number, y: number): void;
  onMonitor(on: boolean): void;
}

export function setupUi(cb: UiCallbacks): void {
  const modeBtn = document.getElementById("btn-mode") as HTMLButtonElement;
  const timeBtn = document.getElementById("btn-time") as HTMLButtonElement;
  const joystickEl = document.getElementById("joystick") as HTMLDivElement;
  const knob = joystickEl.querySelector(".knob") as HTMLDivElement;

  let modeIdx = 0;
  modeBtn.addEventListener("click", () => {
    modeIdx = (modeIdx + 1) % MODE_ORDER.length;
    const mode = MODE_ORDER[modeIdx];
    modeBtn.textContent = MODE_LABELS[mode];
    joystickEl.classList.toggle("visible", mode === "ground");
    cb.onMode(mode);
  });

  const monitorBtn = document.getElementById("btn-monitor") as HTMLButtonElement;
  let monitorOn = false;
  monitorBtn.addEventListener("click", () => {
    monitorOn = !monitorOn;
    monitorBtn.textContent = monitorOn ? "🛰 監視 ON" : "🛰 監視 OFF";
    cb.onMonitor(monitorOn);
  });

  let timeIdx = 0;
  timeBtn.addEventListener("click", () => {
    timeIdx = (timeIdx + 1) % TIME_ORDER.length;
    const time = TIME_ORDER[timeIdx];
    timeBtn.textContent = TIME_LABELS[time];
    cb.onTime(time);
  });

  // --- virtual joystick ---
  const MAX = 38;
  let activeId: number | null = null;
  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const handle = (e: PointerEvent) => {
    const rect = joystickEl.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > MAX) {
      dx *= MAX / len;
      dy *= MAX / len;
    }
    setKnob(dx, dy);
    cb.onJoystick(dx / MAX, dy / MAX);
  };
  joystickEl.addEventListener("pointerdown", (e) => {
    activeId = e.pointerId;
    joystickEl.setPointerCapture(e.pointerId);
    handle(e);
  });
  joystickEl.addEventListener("pointermove", (e) => {
    if (e.pointerId === activeId) handle(e);
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    setKnob(0, 0);
    cb.onJoystick(0, 0);
  };
  joystickEl.addEventListener("pointerup", release);
  joystickEl.addEventListener("pointercancel", release);

  // --- credits modal ---
  const modal = document.getElementById("credits-modal") as HTMLDivElement;
  document.getElementById("credits-btn")!.addEventListener("click", () => modal.classList.add("open"));
  document.getElementById("credits-close")!.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
}

export function hideLoading(): void {
  document.getElementById("loading")!.classList.add("hidden");
}

export function showLoadingError(message: string): void {
  const msg = document.getElementById("loading-msg");
  if (msg) msg.textContent = message;
}
