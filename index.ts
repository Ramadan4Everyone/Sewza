// SEWZA push sender (Supabase Edge Function).
//   action "payment"  — called by the app (signed-in user): "₦20,000 payment recorded from Sarah."
//   action "tick"     — called every 15 minutes by pg_cron: delivery / owing / weekly / due-today alerts + announcements.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sewza.app";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Payload = { title: string; body: string; tag: string; type: string; url?: string };
type Prefs = { types: Record<string, boolean>; reminder_time: string; timezone: string };

const money = (n: number) => "₦" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const wants = (p: Prefs, type: string) => p.types?.[type] !== false; // default: every alert is on
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const safeEq = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

/* ---------- date helpers (all in the user's own time zone) ---------- */
function localNow(tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  } catch {
    return localNow("Africa/Lagos");
  }
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = Number(g("hour")) % 24;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: hour * 60 + Number(g("minute")) };
}
const toUTC = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
const addDays = (d: string, n: number) => new Date(toUTC(d) + n * 86400000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toUTC(d)).getUTCDay(); // 0 = Sunday
const weekKey = (d: string) => addDays(d, -((weekday(d) + 6) % 7)); // the Monday of that week

/* ---------- sending ---------- */
async function sendToUser(userId: string, payload: Payload): Promise<number> {
  const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth_key").eq("user_id", userId);
  if (!subs?.length) return 0;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        JSON.stringify({ url: "./index.html", ...payload }),
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); // phone uninstalled / revoked
      else console.warn("push failed", code);
    }
  }));
  return sent;
}

// Returns true only the first time a key is seen, so an alert is never sent twice.
async function claim(userId: string, key: string): Promise<boolean> {
  const { data, error } = await admin.from("push_log").upsert({ user_id: userId, key }, { onConflict: "user_id,key", ignoreDuplicates: true }).select("key");
  return !error && !!data && data.length > 0;
}

async function getPrefs(userIds: string[]): Promise<Map<string, Prefs>> {
  const map = new Map<string, Prefs>();
  for (const ids of chunk(userIds, 100)) {
    const { data } = await admin.from("push_prefs").select("user_id,types,reminder_time,timezone").in("user_id", ids);
    (data ?? []).forEach((r) => map.set(r.user_id, { types: r.types ?? {}, reminder_time: r.reminder_time, timezone: r.timezone }));
  }
  userIds.forEach((id) => { if (!map.has(id)) map.set(id, { types: {}, reminder_time: "08:00", timezone: "Africa/Lagos" }); });
  return map;
}

/* ---------- scheduled alerts for one user ---------- */
async function runUser(userId: string, prefs: Prefs) {
  const now = localNow(prefs.timezone);
  const [h, m] = prefs.reminder_time.split(":").map(Number);
  const due = h * 60 + m;
  if (now.minutes < due || now.minutes > due + 180) return; // only inside the 3 hours after their chosen time

  const { data: rows } = await admin.from("customers").select("id,name,gender,delivery_date,order_price,amount_paid,order_status").eq("user_id", userId);
  const all = rows ?? [];
  const active = all.filter((c) => c.order_status !== "Delivered" && c.order_status !== "Cancelled");
  const today = now.date, tomorrow = addDays(today, 1), wk = weekKey(today);

  // 📅 Delivery due today
  if (wants(prefs, "delivery_today")) {
    const n = active.filter((c) => c.delivery_date === today).length;
    if (n > 0 && await claim(userId, `today:${today}`)) {
      await sendToUser(userId, {
        type: "delivery_today", tag: `today-${today}`, title: "📅 Delivery due today",
        body: `Reminder: ${n} customer order${n === 1 ? " is" : "s are"} scheduled for delivery today.`,
      });
    }
  }

  // 🔔 Delivery reminder (due tomorrow)
  if (wants(prefs, "delivery_reminder")) {
    const list = active.filter((c) => c.delivery_date === tomorrow);
    if (list.length > 3) {
      if (await claim(userId, `tmrw:${tomorrow}`)) {
        await sendToUser(userId, { type: "delivery_reminder", tag: `tmrw-${tomorrow}`, title: "🔔 Delivery reminder", body: `${list.length} customer outfits are due tomorrow.` });
      }
    } else {
      for (const c of list) {
        if (await claim(userId, `tmrw:${c.id}:${tomorrow}`)) {
          await sendToUser(userId, { type: "delivery_reminder", tag: `tmrw-${c.id}`, title: "🔔 Delivery reminder", body: `Your customer ${c.name}'s outfit is due tomorrow.` });
        }
      }
    }
  }

  // 👕 Order reminder (Mondays: unfinished orders due this week)
  if (wants(prefs, "order_reminder") && weekday(today) === 1) {
    const end = addDays(today, 6);
    const n = active.filter((c) => c.delivery_date && c.delivery_date >= today && c.delivery_date <= end).length;
    if (n > 0 && await claim(userId, `week:${wk}`)) {
      await sendToUser(userId, {
        type: "order_reminder", tag: `week-${wk}`, title: "👕 Order reminder",
        body: `You have ${n} unfinished order${n === 1 ? "" : "s"} due this week.`,
      });
    }
  }

  // ⚠️ Outstanding payment (at most once a week per customer)
  if (wants(prefs, "outstanding_payment")) {
    const owing = all
      .filter((c) => c.order_status !== "Cancelled")
      .map((c) => ({ ...c, bal: Number(c.order_price ?? 0) - Number(c.amount_paid ?? 0) }))
      .filter((c) => c.bal > 0 && (c.order_status === "Delivered" || (c.delivery_date && c.delivery_date <= today)));
    const { data: seen } = await admin.from("push_log").select("key").eq("user_id", userId).like("key", `owe:%:${wk}`);
    const already = new Set((seen ?? []).map((r) => r.key as string));
    const pending = owing.filter((c) => !already.has(`owe:${c.id}:${wk}`));
    if (pending.length > 3) {
      if (await claim(userId, `owe-sum:${wk}`)) {
        for (const c of pending) await claim(userId, `owe:${c.id}:${wk}`);
        const total = pending.reduce((n, c) => n + c.bal, 0);
        await sendToUser(userId, { type: "outstanding_payment", tag: `owe-${wk}`, title: "⚠️ Outstanding payments", body: `${pending.length} customers still owe you ${money(total)} in total.` });
      }
    } else {
      for (const c of pending) {
        if (await claim(userId, `owe:${c.id}:${wk}`)) {
          const her = c.gender === "Female" ? "her" : c.gender === "Male" ? "his" : "their";
          await sendToUser(userId, { type: "outstanding_payment", tag: `owe-${c.id}`, title: "⚠️ Outstanding payment", body: `${c.name} still owes ${money(c.bal)} for ${her} order.` });
        }
      }
    }
  }
}

async function sendAnnouncements() {
  const { data: items } = await admin.from("announcements").select("id,title,body").eq("published", true).is("sent_at", null).order("created_at").limit(5);
  for (const a of items ?? []) {
    // Claim atomically so two overlapping runs cannot send the same announcement twice.
    const { data: claimed } = await admin.from("announcements").update({ sent_at: new Date().toISOString() }).eq("id", a.id).is("sent_at", null).select("id");
    if (!claimed?.length) continue;
    const { data: subs } = await admin.from("push_subscriptions").select("user_id");
    const users = [...new Set((subs ?? []).map((s) => s.user_id as string))];
    const prefs = await getPrefs(users);
    const title = a.title.startsWith("📢") ? a.title : `📢 ${a.title}`;
    for (const group of chunk(users.filter((u) => wants(prefs.get(u)!, "announcements")), 25)) {
      await Promise.all(group.map((u) => sendToUser(u, { type: "announcement", tag: `ann-${a.id}`, title, body: a.body })));
    }
  }
}

async function tick() {
  const { data: subs } = await admin.from("push_subscriptions").select("user_id");
  const users = [...new Set((subs ?? []).map((s) => s.user_id as string))];
  const prefs = await getPrefs(users);
  for (const group of chunk(users, 10)) {
    await Promise.all(group.map((u) => runUser(u, prefs.get(u)!).catch((e) => console.warn("user run failed", u, e))));
  }
  await sendAnnouncements();
  await admin.from("push_log").delete().lt("sent_at", new Date(Date.now() - 60 * 86400000).toISOString()); // tidy up
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }

  try {
    if (body.action === "tick") {
      if (!safeEq(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return json({ error: "forbidden" }, 403);
      await tick();
      return json({ ok: true });
    }

    if (body.action === "payment") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      const amount = Number(body.amount);
      const name = String(body.customer ?? "").trim().slice(0, 80);
      if (!Number.isFinite(amount) || amount <= 0 || !name) return json({ error: "bad request" }, 400);
      const prefs = (await getPrefs([user.id])).get(user.id)!;
      if (wants(prefs, "payment_received")) {
        await sendToUser(user.id, { type: "payment_received", tag: `pay-${Date.now()}`, title: "💰 Payment received", body: `${money(amount)} payment recorded from ${name}.` });
      }
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
