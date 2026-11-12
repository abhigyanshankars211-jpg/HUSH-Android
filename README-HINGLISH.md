# HUSH Android project (Capacitor)

Ye Android app banane ka source project hai; ye APK file nahi hai. APK compile karne ke liye Windows/Mac/Linux computer par Android Studio + Android SDK + Node.js chahiye.

## Build steps
1. ZIP extract karein.
2. Folder mein terminal/Command Prompt kholein.
3. `npm install` run karein.
4. `npx cap add android` run karein (sirf pehli baar).
5. `npx cap sync android` run karein.
6. `npx cap open android` run karein.
7. Android Studio mein Gradle sync complete hone dein.
8. Test APK: Build > Build Bundle(s) / APK(s) > Build APK(s).
9. Phone mein install karke login, Pic Wall, chats aur groups test karein.

## Important
- Existing Supabase project/config is retained in `www/config.js`; no new Supabase project or SQL reset is required for this wrapper.
- Keep `config.js` publishable/anon key only. Never place service_role/secret keys in the app.
- Camera/gallery plugins are included as dependencies, but the current website code still needs native plugin integration before claiming native camera/gallery features.
- Push notifications, deep links, background messaging and production release signing are not configured yet.
- Before Play Store release, complete privacy policy, Data safety, content moderation/reporting, account deletion, permission declarations and Google Play testing requirements. Account delete is in Profile on the secure branch, after `supabase/secure_additive.sql` is applied.
- This app loads Supabase JS from jsDelivr; internet is required for app data and authentication.
- The included service worker caches the app shell only; it does not make chats or Supabase data available offline.
