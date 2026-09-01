import { vocabularySets } from "./vocabulary-data.js";
import { getFirebaseServices } from "./firebase.js";

const COLLECTION = "vocabularySets";
const clone = (value) => JSON.parse(JSON.stringify(value));

export function resolveVocabularyCachePolicy(runtimeLocation = typeof location === "undefined" ? null : location) {
  const search = String(runtimeLocation?.search || "");
  const hostname = String(runtimeLocation?.hostname || "").toLowerCase();
  const staging = new URLSearchParams(search).get("firebase") === "staging" ||
    hostname === "the-mandarin-room-staging.web.app" ||
    hostname === "the-mandarin-room-staging.firebaseapp.com";
  return Object.freeze({
    staging,
    storageKey: staging ? "mandarin-room-vocabulary-staging-v1" : "mandarin-room-vocabulary-v2",
    useBundledFallback: !staging
  });
}

const cachePolicy = resolveVocabularyCachePolicy();
const STORAGE_KEY = cachePolicy.storageKey;
const defaultLocalSets = () => cachePolicy.useBundledFallback ? clone(vocabularySets) : [];

function localSets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return defaultLocalSets();
    let changed = false;
    const cleaned = saved.map((set) => ({ ...set, items: set.items.map((item) => {
      if (item.alignment === undefined && item.segments === undefined) return item;
      const cleanItem = { ...item };
      delete cleanItem.alignment;
      delete cleanItem.segments;
      changed = true;
      return cleanItem;
    }) }));
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch (_) {
    return defaultLocalSets();
  }
}

function publicSet(data) {
  return clone({
    id: data.id,
    yearLevel: data.yearLevel,
    title: data.title,
    chineseTitle: data.chineseTitle || "",
    description: data.description || "",
    coverImage: data.coverImage || null,
    coverImageStoragePath: data.coverImageStoragePath || null,
    coverImageGenerated: data.coverImageGenerated === true,
    items: Array.isArray(data.items) ? data.items : []
  });
}

function mergeCloudSets(cloudSets) {
  const merged = new Map(localSets().map((set) => [set.id, set]));
  cloudSets.forEach((set) => { if (set.deleted === true) merged.delete(set.id); else merged.set(set.id, publicSet(set)); });
  return [...merged.values()];
}

function cacheSet(nextSet, originalId = null) {
  const sets = localSets();
  const index = originalId ? sets.findIndex((set) => set.id === originalId) : sets.findIndex((set) => set.id === nextSet.id);
  if (index >= 0) sets[index] = clone(nextSet); else sets.push(clone(nextSet));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}

export async function getSets() {
  try {
    const services = await getFirebaseServices();
    const ref = services.firestoreSdk.query(services.firestoreSdk.collection(services.db, COLLECTION), services.firestoreSdk.where("published", "==", true));
    const snapshot = await services.firestoreSdk.getDocs(ref);
    return mergeCloudSets(snapshot.docs.map((doc) => doc.data()));
  } catch (error) {
    console.warn("[Vocabulary Cloud] Using local vocabulary fallback.", error);
    return localSets();
  }
}

export async function getSet(id) {
  if (!id) return null;
  try {
    const services = await getFirebaseServices();
    const snapshot = await services.firestoreSdk.getDoc(services.firestoreSdk.doc(services.db, COLLECTION, id));
    if (snapshot.exists() && snapshot.data().deleted === true) return null;
    if (snapshot.exists() && snapshot.data().published === true) return publicSet(snapshot.data());
  } catch (error) {
    console.warn(`[Vocabulary Cloud] Using local fallback for ${id}.`, error);
  }
  return localSets().find((set) => set.id === id) || null;
}

export async function saveSet(nextSet, originalId = null) {
  const services = await getFirebaseServices();
  if (!services.auth.currentUser) throw new Error("Sign in with an authorised teacher account before saving.");
  const duplicate = (await getSets()).some((set) => set.id === nextSet.id && set.id !== originalId);
  if (duplicate) throw new Error("That stable ID is already in use.");
  const cleanSet = publicSet(nextSet);
  const payload = { ...cleanSet, published: true, updatedAt: services.firestoreSdk.serverTimestamp(), updatedBy: services.auth.currentUser.uid };
  await services.firestoreSdk.setDoc(services.firestoreSdk.doc(services.db, COLLECTION, cleanSet.id), payload);
  if (originalId && originalId !== cleanSet.id) await services.firestoreSdk.deleteDoc(services.firestoreSdk.doc(services.db, COLLECTION, originalId));
  cacheSet(cleanSet, originalId);
  return cleanSet;
}

export async function deleteSet(id) {
  const services = await getFirebaseServices();
  if (!services.auth.currentUser) throw new Error("Sign in with an authorised teacher account before deleting.");
  await services.firestoreSdk.setDoc(services.firestoreSdk.doc(services.db, COLLECTION, id), { id, deleted: true, published: true, updatedAt: services.firestoreSdk.serverTimestamp(), updatedBy: services.auth.currentUser.uid });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(localSets().filter((set) => set.id !== id)));
}

export async function watchSets(onChange, onError = () => {}) {
  const services = await getFirebaseServices();
  const ref = services.firestoreSdk.query(services.firestoreSdk.collection(services.db, COLLECTION), services.firestoreSdk.where("published", "==", true));
  return services.firestoreSdk.onSnapshot(ref, (snapshot) => onChange(mergeCloudSets(snapshot.docs.map((doc) => doc.data()))), onError);
}

export async function watchSet(id, onChange, onError = () => {}) {
  const services = await getFirebaseServices();
  const ref = services.firestoreSdk.doc(services.db, COLLECTION, id);
  return services.firestoreSdk.onSnapshot(ref, (snapshot) => {
    if (snapshot.exists() && snapshot.data().deleted === true) { onChange(null); return; }
    if (snapshot.exists() && snapshot.data().published === true) onChange(publicSet(snapshot.data()));
  }, onError);
}
