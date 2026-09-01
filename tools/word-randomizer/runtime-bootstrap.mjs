const runtime = new URLSearchParams(location.search).get("firebase");
const stagingHost = location.hostname === "the-mandarin-room-staging.web.app" ||
  location.hostname === "the-mandarin-room-staging.firebaseapp.com";

if (runtime === "staging" || stagingHost) {
  await import("./staging-runtime-config.mjs");
}

await import(location.pathname.endsWith("/join.html") ? "./student.mjs?v=student-ui-2" : "./app.mjs?v=staging-cache-1");
