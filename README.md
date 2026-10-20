# SEWZA — Supabase Authentication Edition

This version keeps the existing SEWZA workspace and adds a cleaner production-style authentication flow.

## Authentication behavior

- Existing users sign in with email + password.
- New users create an account with:
  - Full name
  - Business name
  - Email
  - Password
- After successful signup, the user enters their workspace immediately.
- A new account starts with an **empty workspace**.
- The business name is used throughout the header/workspace instead of a hard-coded personal name.
- Sessions are restored automatically when the user returns.
- Sign out clears the active local workspace from memory.
- Password visibility toggle is included.
- Password reset is included.
- Friendly authentication errors are shown without exposing technical details.

## IMPORTANT: turn off email confirmation

The requested SEWZA flow is immediate signup → workspace, with no email-confirmation step.

In Supabase:
1. Open your SEWZA project.
2. Go to **Authentication → Providers → Email**.
3. Turn **Confirm email** OFF.
4. Save.

Supabase controls email confirmation on the server, so a frontend cannot safely bypass that setting. With confirmation disabled, `signUp()` returns an active session and SEWZA sends the new user directly into their workspace.

## Security

- The browser uses only the Supabase publishable/anon key.
- Never put a `service_role` or secret key in `supabase-config.js`.
- Keep Row Level Security enabled in the database.
- The `profiles` table is tied to `auth.users`.

## Files

- `supabase-config.js` — Supabase project URL + browser-safe publishable key.
- `supabase-client.js` — creates the Supabase browser client.
- `SUPABASE_SCHEMA.sql` — database tables and RLS policies.
- `app.js` — authentication/session/workspace logic.
- `index.html` — authentication UI.
- `style.css` — responsive authentication animations and existing SEWZA styles.

## Run

Use VS Code Live Server or another local web server. Do not open `index.html` directly with `file://`.

After the Supabase project is configured, test:
1. Sign up with a new email.
2. Confirm that SEWZA opens the workspace immediately.
3. Confirm the workspace is empty.
4. Sign out.
5. Sign in with the same email/password.
6. Confirm the same business name appears.
7. Create a customer.
8. Sign out and sign back in.
9. Confirm the account's data remains associated with that account.

## Important next integration

Authentication is now separated cleanly from the local measurement data. The next development step is to connect customers, measurements, orders and customer photos to Supabase tables/storage with RLS and offline synchronization.

## New in this build — Cloud records + profile

This build now connects the authenticated workspace to Supabase for:
- Customer records
- Order price, amount paid, balance/status fields
- Measurement sets and measurement history
- Customer photos
- Tailor full name, business name and profile picture
- Cloud restore when the user signs back in

### Supabase setup required
1. Run the complete `SUPABASE_SCHEMA.sql` in Supabase SQL Editor. The schema includes the `profiles`, `customers`, `measurements` tables, RLS policies, and the `profile-avatars` / `customer-photos` Storage buckets.
2. Keep RLS enabled.
3. In Authentication → Providers → Email, turn **Confirm email OFF** if you want signup to open the workspace immediately.
4. Put your Supabase project URL and anon/publishable key in `supabase-config.js`.
5. Do **not** put a Supabase service-role/secret key in this frontend.

### Profile
Click the profile/business name at the top-right. You can change the business name, full name and profile picture at any time. The updated profile appears in the top-right instead of the default letter icon.

### Sign out / return
Signing out remembers the last signed-in email on that device. When SEWZA returns to the sign-in screen, the email is already filled in; the user only needs to enter the password.

### Offline behavior
SEWZA still keeps the local workspace in IndexedDB/localStorage. When the browser is online and Supabase is configured, saved customer/order/measurement data is synced to the authenticated user's cloud workspace.

## New in this build — real deletion + stronger offline mode

- Deleting a customer now deletes the customer's Supabase record and measurement history (via the customer relationship), and removes the matching customer photo from Storage when online.
- If a customer is deleted while offline, the deletion is queued locally and is sent to Supabase automatically when the device reconnects.
- Changes made while offline stay in IndexedDB/local storage and are synced automatically when the connection returns.
- Customer photos selected while offline are kept locally and uploaded when the connection returns.
- SEWZA renders the local workspace first, so returning users can get into the app quickly while queued cloud synchronization happens in the background.
- The service worker now caches the SEWZA app shell and the Supabase browser library for better offline reload behavior after the app has been opened online at least once.

### Important offline limitation

Offline mode is designed for an already signed-in user. A brand-new user cannot create an account or authenticate against Supabase with no internet connection. Once signed in on a device, the existing workspace can continue to be used offline and will sync when internet returns.

## v6 changes
- Animated SEWZA logo (inline SVG, works offline) shown while the app opens.
- "Congratulations" appears as soon as the customer is saved on the device; cloud sync continues in the background.
- Compact, responsive receipt preview and a smaller (720px) shareable receipt image.
- Mobile bottom navigation: Dashboard · Customers · **+** · Business · Help, with the + exactly centred.
- Offline: the service worker also caches the Supabase library and fonts, and the signed-in workspace reopens without internet.
- Bump `CACHE_NAME` in `sw.js` if you ever need to force every device to refresh its cached files.

## v7 changes — Calculator + resume where you left off
- **Calculator** in the main navigation (sidebar on desktop, bottom bar on phones). Three tools: a full calculator (keyboard support, history, % that works like a phone calculator), a length converter (inches / cm / feet / yards / metres) and a pricing quote (fabric + sewing + extras + deposit).
- **Resume:** SEWZA remembers the page you were on (including an open customer profile or receipt) and reopens it after a refresh, a closed tab or an app restart.
- **Unfinished forms are kept:** the Add/Edit customer form is saved as you type and restored after a refresh. It is cleared when the customer is saved.
- The workspace no longer jumps back to the dashboard (and no longer clears the form) when the browser tab regains focus.
- On phones the bottom bar is Dashboard · Customers · **+** · Business · Calculator. Help moved to the **?** button in the top bar.
- `CACHE_NAME` in `sw.js` is now `sewza-pwa-v3` so every device picks up the new files.

## v8 changes
- **Dashboard slideshow:** auto-playing (swipe, arrows, dots; pauses on hover) mixing the built-in artwork in `` with your customers' photos and your profile picture. To add your own pictures, copy them into `` and list them in `CUSTOM_SLIDES` in `app.js`, e.g. `{src:'our-team.jpg', title:'Our team', sub:'Lagos studio'}`.
- Only one **Add customer** button on the dashboard.
- **All measurements are optional.** A customer can be saved with just a name.
- **Customer photo is optional**, with a **Remove photo** button (also **Remove picture** for your profile picture).
- A bad connection shows **Internet failed** instead of "Failed to fetch".
- `CACHE_NAME` in `sw.js` is now `sewza-pwa-v4`.

## v9 changes — premium dashboard, onboarding, install prompt
- **Cleaner, calmer dashboard:** a short welcome header, the slideshow, then the numbers, then two tidy columns (recent customers + quick actions, delivery reminders + owing list). Larger, easier-to-read text and generous spacing; on phones everything stacks in one column in the most useful order. All existing numbers, buttons and lists are still there.
- **Slideshow shows SEWZA illustrations only** (six built-in pictures). Customer photos and your profile picture are never shown in it. To add your own illustrations, put the files in `` and list them in `CUSTOM_SLIDES` in `app.js`.
- **Install prompt on the first visit:** a friendly "Install SEWZA" sheet appears once, the first time someone opens the site (Android/desktop Chrome: one tap installs; iPhone: simple Share → Add to Home Screen steps). "Not now" is remembered. The install icon in the top bar and the button in Help stay available. Nothing is shown inside an installed app.
- **Guided tour for new users:** the first time a brand-new account opens its dashboard, a six-step tour explains adding customers, measurements, delivery reminders, payments and the tools. Existing users with saved customers are never interrupted. Replay it any time from **Help → Start the guided tour**.
- **Getting started checklist** on the dashboard (add a customer, save measurements, set a delivery date, record a payment). It ticks itself off and disappears when everything is done, or when you press ×.
- Help now has extra how-to answers (first customer, payments and receipts, installing the app).
- Mobile hardening: iOS no longer zooms into fields, larger touch targets, safe-area spacing, tested from 280px to desktop widths.
- Small real-world polish: browser tab icon, `noscript` message, dashboard counters start at 0.
- New file: `install.js` (install prompt + service worker registration). `CACHE_NAME` in `sw.js` is now `sewza-pwa-v5`.

## v10 additions

- **Gender-aware styles:** the Add customer page asks for gender once. The Style list then shows the common Yoruba/Nigerian and English/Western styles for Male, Female (or both for Other). The old second "Measuring" gender selector is gone; measurement fields follow the single choice.
- **Group orders:** Add customer → *Group order* tab. Uniform groups store name, class, measurements and a photo per person; dress/event groups store name and measurements. Each group has a category, cloth photos, dates and an optional price per person. Saved groups appear in a searchable, filterable gallery.
- Group data is saved on the device (IndexedDB) first and synced to Supabase (`customer_groups` table + `customer-photos` bucket). Run `SUPABASE_GROUPS_MIGRATION.sql` once. Unfinished drafts stay on the device only.

## Work Gallery / Tailor Portfolio (v12)

- **Setup (once):** run `SUPABASE_PORTFOLIO_MIGRATION.sql` in Supabase → SQL Editor. It creates the `tailor_portfolios` table, the public `portfolio-media` photo bucket and the security rules. Safe to run again.
- **Tailor side:** Profile → *Your tailor portfolio*. Add business name, logo, location, WhatsApp number, tagline, about text, specialties, social links and photos of finished work (title, category and note per photo; reorder with First / ← / →). Choose a link name, switch on *Publish my portfolio* and press *Save portfolio*.
- **Share:** *Share on WhatsApp*, *Copy link* and *Preview page* appear once the portfolio is live. The public link looks like `portfolio.html?t=your-link-name`.
- **Customer side:** `portfolio.html` (+ `portfolio.css`, `portfolio.js`) is a standalone page that needs no login. It shows the designs, a filter by category, a full-screen viewer, and "Order on WhatsApp" buttons that open a ready-written message to the tailor.
- Unpublishing hides the page immediately. Photos are resized on the phone before upload; unused photo files are removed automatically after each save.

## v13 — SEWZA rebrand + new opening animation

- **New name and logo:** the app is now **SEWZA** everywhere (page titles, header, login, onboarding tour, receipts, install prompt, portfolio page, manifest, SQL comments). New logo files: `sewza-logo.png` (full logo, login screen), `sewza-mark.png` (the "S" ribbon mark, header / tour / receipts) and `sewza-wordmark.png` (lettering, opening animation). `icon-192.png`, `icon-512.png` and `apple-touch-icon.png` were rebuilt from the new logo (safe for round/maskable Android icons).
- **Nothing is lost for existing users:** `migrate.js` runs first on every page load. It copies everything saved under the old name (customers, drafts, settings, the default colour theme, the offline database and pending sync items) to the new SEWZA names, then removes the old copy once the new one is confirmed. Old backup files (`.json`) still import normally.
- **New opening animation:** woven ivory cloth, drifting gold dust, a gold stitch-ring sewn around the logo by a travelling needle, a gold satin sheen across the logo and lettering, and a running-stitch bar that keeps sewing until the workspace is ready. It is pure CSS (no libraries), respects *reduce motion*, and ends with a small flourish before fading away. Its length is `BOOT_MIN_MS` at the top of `app.js`.
- **Rename details for developers:** the Supabase config global is now `window.SEWZA_SUPABASE_CONFIG` (in `supabase-config.js`), the client bridge is `window.SEWZA_SUPABASE`, the app API is `window.SEWZA`, and the theme id is `sewza`. If you host a separate copy of `supabase-config.js`, update it to the new variable name.
- `CACHE_NAME` in `sw.js` is now `sewza-pwa-v9`; the old caches are removed automatically. Devices open the new version on the second launch after you deploy (the first launch refreshes the cache in the background).
