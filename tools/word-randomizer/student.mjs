import { canUseAiVoice, speakMandarin, playTeacherVoice } from "../../js/audio.js";
import { cacheSafeAudioUrl, getTeacherVoice } from "../../js/teacher-voice-cloud.js";
import { FirebaseLiveSessionTransport } from "./firebase-live-transport.mjs";
import { fitSingleLineText, scheduleSingleLineFit } from "./card-layout.mjs";

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const state = { client: null, snapshot: null, groupId: null, current: null, teacherVoiceUrl: "", voiceMode: "auto", voiceRequest: 0, drawing: false };
const transport = new FirebaseLiveSessionTransport();

function groupFor(snapshot) {
  const groups = Object.values(snapshot.groups || {});
  return snapshot.groups?.[snapshot.assignedGroupId] || snapshot.groups?.[state.groupId] || groups[0] || null;
}

function renderCard(item, display) {
  const card = $("#student-result-card"); $("#student-waiting").hidden = Boolean(item);
  if (!item) { card.className = "result-card waiting"; ["#student-image", "#student-chinese", "#student-pinyin", "#student-english", "#student-voice-actions"].forEach((selector) => { $(selector).hidden = true; }); return; }
  const enabled = new Set(display); const image = $("#student-image"); const showImage = enabled.has("image") && Boolean(item.image); image.hidden = !showImage; if (showImage) { image.src = item.image; image.alt = item.english ? `${item.english} illustration` : "Vocabulary illustration"; }
  [["#student-chinese", "chinese"], ["#student-pinyin", "pinyin"], ["#student-english", "english"]].forEach(([selector, key]) => { const node = $(selector); node.hidden = !enabled.has(key); node.textContent = item[key] || ""; });
  const count = Number(showImage) + ["chinese", "pinyin", "english"].filter((key) => enabled.has(key)).length; card.className = `result-card content-${Math.max(1, count)}${showImage ? " has-image" : ""}`; scheduleSingleLineFit($("#student-chinese")); if (count === 1 && !showImage) { scheduleSingleLineFit($("#student-pinyin"), { minimumSize: 18 }); scheduleSingleLineFit($("#student-english"), { minimumSize: 18 }); } $("#student-voice-actions").hidden = false;
}

async function loadTeacherVoice(item) {
  const request = ++state.voiceRequest; state.teacherVoiceUrl = item?.teacherAudioUrl || ""; $("#student-play-teacher").hidden = !state.teacherVoiceUrl;
  if (!item?.setId || !item?.id) return;
  try { const metadata = await getTeacherVoice(item.setId, item.id); if (request !== state.voiceRequest) return; state.teacherVoiceUrl = cacheSafeAudioUrl(metadata) || state.teacherVoiceUrl; $("#student-play-teacher").hidden = !state.teacherVoiceUrl; } catch (error) { console.warn("[Student Teacher Voice]", error); }
}

function render(snapshot) {
  state.snapshot = snapshot; const group = groupFor(snapshot); if (!group) return; state.groupId = group.id; state.voiceMode = snapshot.voiceMode || "auto";
  $("#student-connection").textContent = snapshot.status === "active" ? "Live · connected" : "Session ended"; $("#student-connection").classList.toggle("offline", snapshot.status !== "active");
  $("#student-group").textContent = group.name; $("#student-draw-number").textContent = `Draw ${group.drawNumber}`;
  state.current = group.currentItem || null; renderCard(state.current, snapshot.display || ["image", "chinese", "pinyin"]); if (state.current) loadTeacherVoice(state.current);
  const authorised = snapshot.status === "active" && group.controller?.type === "student" && group.controller.deviceId === state.client.deviceId && !group.isComplete;
  $("#student-draw").hidden = !authorised; $("#student-draw").disabled = state.drawing;
  $("#student-session-message").textContent = snapshot.status !== "active" ? "The teacher has ended this session." : group.isComplete ? "All words have been drawn." : authorised ? "You have control for the next draw." : "Waiting for the teacher…";
}

function showError(error) { console.error("[Student Live Session]", error); $("#student-session-message").textContent = error?.message || "Connection interrupted. Reconnecting…"; state.drawing = false; if (state.snapshot) render(state.snapshot); }

async function enterSession(client) {
  state.client = client; state.groupId = client.credentials.groupId || "class"; $("#student-join").hidden = true; $("#student-session").hidden = false;
  client.watch(render, showError); window.setInterval(() => { if (document.visibilityState === "visible") client.heartbeat().catch(showError); }, 120000);
}

async function join() {
  const code = $("#student-code").value.trim().toUpperCase(); const name = $("#student-name").value.trim() || "Student iPad"; $("#student-join-error").textContent = ""; $("#student-join-button").disabled = true;
  try { await enterSession(await transport.join(code, { name })); }
  catch (error) { $("#student-join-error").textContent = error?.message || "Could not join this class."; $("#student-join-button").disabled = false; }
}

$("#student-join-button").addEventListener("click", join);
$("#student-code").addEventListener("input", () => { $("#student-code").value = $("#student-code").value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5); });
$("#student-draw").addEventListener("click", async () => { const group = groupFor(state.snapshot); if (!group || state.drawing) return; state.drawing = true; render(state.snapshot); try { await state.client.draw(group.id, { expectedVersion: group.version, controlEpoch: group.controller.epoch }); } catch (error) { showError(error); } finally { state.drawing = false; if (state.snapshot) render(state.snapshot); } });
$("#student-play-teacher").addEventListener("click", () => { if (!state.teacherVoiceUrl) return; playTeacherVoice(state.teacherVoiceUrl, { onStart: () => { $("#student-audio-status").textContent = "Playing Teacher Voice…"; }, onEnd: () => { $("#student-audio-status").textContent = ""; }, onError: () => { $("#student-audio-status").textContent = "Teacher Voice could not be played."; } }); });
$("#student-play-voice").addEventListener("click", () => {
  if (!state.current) return; const fallback = () => { if (state.teacherVoiceUrl) $("#student-play-teacher").click(); else $("#student-audio-status").textContent = "AI Voice is unavailable on this device."; };
  if (state.voiceMode === "teacher") { fallback(); return; } if (!canUseAiVoice()) { fallback(); return; }
  speakMandarin(state.current.chinese, { onStart: () => { $("#student-audio-status").textContent = "Playing AI Voice…"; }, onEnd: () => { $("#student-audio-status").textContent = ""; }, onUnavailable: fallback, onError: state.voiceMode === "auto" ? fallback : () => { $("#student-audio-status").textContent = "AI Voice is unavailable."; } });
});

const requestedCode = String(params.get("code") || "").toUpperCase();
if (requestedCode) {
  $("#student-code").value = requestedCode;
  const resumed = await transport.resumeByCode(requestedCode); if (resumed) enterSession(resumed).catch(showError);
}
window.addEventListener("resize", () => {
  fitSingleLineText($("#student-chinese"));
  if ($("#student-result-card").classList.contains("content-1")) {
    fitSingleLineText($("#student-pinyin"), { minimumSize: 18 });
    fitSingleLineText($("#student-english"), { minimumSize: 18 });
  }
});
