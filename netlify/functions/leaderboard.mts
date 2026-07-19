import { getStore } from "@netlify/blobs";

// Global top-10 leaderboard, stored in Netlify Blobs.
// GET  /api/leaderboard          -> [{name, distance, coffees, date}, ...]
// POST /api/leaderboard {name, distance, coffees} -> updated top list

const MAX_ENTRIES = 10;
const MAX_DISTANCE = 200000; // sanity cap; ~2 hours of perfect play

export default async (req: Request) => {
  const store = getStore("leaderboard");
  const headers = { "Cache-Control": "no-store" };

  if (req.method === "GET") {
    const data = (await store.get("top", { type: "json" })) ?? [];
    return Response.json(data, { headers });
  }

  // Admin reset: DELETE with the secret key from the site's env vars.
  // The key never appears in the public source — set it in Netlify UI:
  // Site configuration -> Environment variables -> LEADERBOARD_RESET_KEY
  if (req.method === "DELETE") {
    const expected = process.env.LEADERBOARD_RESET_KEY ?? "";
    const given = req.headers.get("x-reset-key") ?? "";
    if (!expected || given !== expected) {
      return new Response("forbidden", { status: 403 });
    }
    await store.setJSON("top", []);
    return Response.json([], { headers });
  }

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    let name = String(body?.name ?? "").trim().slice(0, 16);
    name = name.replace(/[^\p{L}\p{N} _.\-!?]/gu, "");
    if (!name) name = "Anonymous";
    const distance = Math.floor(Number(body?.distance));
    const coffees = Math.floor(Number(body?.coffees));
    if (!Number.isFinite(distance) || distance < 1 || distance > MAX_DISTANCE) {
      return new Response("bad score", { status: 400 });
    }
    const data: any[] = (await store.get("top", { type: "json" })) ?? [];
    data.push({
      name,
      distance,
      coffees: Number.isFinite(coffees) ? Math.min(Math.max(coffees, 0), 99999) : 0,
      date: new Date().toISOString().slice(0, 10),
    });
    data.sort((a, b) => b.distance - a.distance);
    const top = data.slice(0, MAX_ENTRIES);
    await store.setJSON("top", top);
    return Response.json(top, { headers });
  }

  return new Response("method not allowed", { status: 405 });
};

export const config = { path: "/api/leaderboard" };
