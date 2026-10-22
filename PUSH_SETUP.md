# SEWZA phone notifications — one-time setup

The app side is finished. Notifications that arrive while SEWZA is closed need a small sender on your
Supabase project. Do these five steps once (about 15 minutes). Until step 1 is done, the
**Phone notifications** switch in Help shows "not available yet" and nothing else in SEWZA changes.

## 1. Create your VAPID keys
On any computer with Node.js:

    npx web-push generate-vapid-keys

You get a **Public Key** and a **Private Key**.
- Paste the **public** key into `push-config.js` (`vapidPublicKey: '...'`).
- Keep the **private** key secret. It only goes into Supabase (step 3). Never put it in the app files.

## 2. Create the tables
Supabase → SQL Editor → paste all of `SUPABASE_PUSH_MIGRATION.sql` → Run.
(It adds new tables only; your customers, payments and groups are untouched.)

## 3. Deploy the sender function
Install the Supabase CLI, then from this folder:

    supabase login
    supabase link --project-ref agzumrttzqjxcpewdbyg
    supabase secrets set VAPID_PUBLIC_KEY="<public key>" VAPID_PRIVATE_KEY="<private key>" \
        VAPID_SUBJECT="mailto:you@yourdomain.com" CRON_SECRET="<any long random text>"
    supabase functions deploy sewza-push --no-verify-jwt

## 4. Publish the updated app
Upload the files to your host as usual. Users get the new version automatically.

## 5. Turn on the schedule
Supabase → SQL Editor: run the commented block at the bottom of `SUPABASE_PUSH_MIGRATION.sql`
after replacing `YOUR_CRON_SECRET` with the same `CRON_SECRET` as in step 3.
It runs every 15 minutes.

## What users receive
| Alert | When |
|---|---|
| 🔔 Delivery reminder | Day before a delivery: "Your customer Ahmed's outfit is due tomorrow." |
| 📅 Delivery due today | Morning of delivery: "Reminder: 2 customer orders are scheduled for delivery today." |
| 👕 Order reminder | Mondays: "You have 3 unfinished orders due this week." |
| 💰 Payment received | Right after a payment is recorded: "₦20,000 payment recorded from Sarah." |
| ⚠️ Outstanding payment | Past-due or delivered orders with a balance, at most once a week per customer: "Sarah still owes ₦35,000 for her order." |
| 📢 Announcement | When you add one (below). |

Daily alerts are sent at the user's **Reminder time** (Help → Ringing & emergency alerts, default 08:00),
in their own time zone, within a 3-hour window. Delivered and Cancelled orders are never reminded.
Each user can switch notifications off completely, or switch off individual types, in Help → Phone notifications.

## Sending an announcement
Supabase → SQL Editor:

    insert into public.announcements (title, body)
    values ('SEWZA announcement', 'A new feature is now available: Customer Work Gallery.');

It goes out within 15 minutes to everyone who has announcements switched on.

## Notes
- Android (Chrome) and desktop browsers work in the browser or the installed app.
- iPhone (iOS 16.4+) only supports notifications from the installed app: tap **Install**, open SEWZA from the Home Screen, then switch on.
- If SEWZA is open on screen when an alert arrives, it appears as an in-app message instead of a phone banner.
- Signing out removes that phone from the sender's list, so it stops receiving the previous account's alerts.
