# New Client Setup

Checklist for standing up a fresh deployment of this codebase for a new MRA Systems client. Each client gets their own Supabase project and its own hosting — this is not a shared multi-tenant setup.

## 1. Create the Supabase project

Create a new project in the [Supabase dashboard](https://supabase.com/dashboard) for the client.

## 2. Apply the database schema

From the repo root:

```
supabase link --project-ref <new-project-ref>
supabase db push
```

This runs every file in `supabase/migrations/` against the new project, in order. As of this writing, `business_settings` seeds as a genuinely blank row (no business name/phone/address pre-filled) — this matters: it's what makes the onboarding wizard actually fire for the client's first admin in step 6 below.

## 3. Create the first admin account

There's no self-serve signup — this step is manual, every time:

1. In the Supabase dashboard, go to **Authentication → Users** and create the admin's user (email + password).
2. Copy that user's UUID.
3. Run this in the SQL Editor, replacing the placeholders:

```sql
insert into public.profiles (id, username, full_name, role, location, active, email)
values (
  'PASTE_AUTH_USER_UUID_HERE',
  'admin',
  'System Administrator',
  'admin',
  'All',
  true,
  'PASTE_ADMIN_EMAIL_HERE'
);
```

## 4. Point the app at the new project

Edit `app/supabase-config.js`:

```js
window.LUMODA_SUPABASE = {
  url: 'https://<new-project-ref>.supabase.co',
  anonKey: '<new-project-anon-key>'
};
```

The anon key is safe in frontend code — RLS is what actually protects the data. Never put a `service_role` key here.

## 5. Deploy

Deploy the `app/` folder (not the repo root) to hosting for this client — e.g. a new Netlify site pointed at `app/` as the publish directory.

## 6. First login

Log in as the admin created in step 3. The business-setup wizard should appear automatically (since `onboarding_completed` starts `false` for a blank business row) — walk through it to set the client's real business name, phone, address, currency, and branding. Staff accounts are created afterward from inside the app (Admin → Create Staff Account); each new staff member sees the feature tour automatically on their first login.

## Known gaps for a new client

- **Receipts/invoices still print Lumoda-specific content.** The receipt and invoice templates in `app/js/invoices.js` hardcode Lumoda's shop taglines ("The cook's helper — Dealers in All Kinds of Kitchen Accessories"), the "MAA LUCY'S PLACE" sub-brand badge, and both branch addresses as fixed text — none of it is pulled from `business_settings`. Until this is genericized in a future pass, a new client's receipts need those lines hand-edited in code.
- **No self-serve admin signup.** Step 3 above is a manual, per-client task — there is currently no in-app or automated way to create the first admin account.
