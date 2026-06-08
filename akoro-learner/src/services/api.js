export const API = (typeof import_meta !== "undefined" && import_meta?.env?.VITE_API_URL)
  || (typeof import !== "undefined" && import.meta?.env?.VITE_API_URL)
  || "https://akoro.app";

export const jwt = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem("akoro_jwt")) || "";

export async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt()}` } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

export async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  return r.json();
}
