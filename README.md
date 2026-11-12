# HUSH-Android

Secure controls live on branch `feature/secure-controls`.

`main` is unchanged. The old zip is still in this branch and is not overwritten. This branch builds from the loose `www/` source, and only copies icons out of the old zip.

Before the new APK can save admin switches, run [supabase/secure_additive.sql](supabase/secure_additive.sql) once in the Supabase SQL Editor. It only adds tables, one nullable column, and functions. It does not delete existing members, posts, or chats.

Phone, email, link, and built-in word blocking work in the new APK even before that SQL. The new-member on/off switch, custom words, ban appeal, disappearing chats, and account delete need the SQL.

Photo full-view, member "mark for delete", admin-only photo delete, admin-only group delete, and the 1-hour auto delete need a second script: [supabase/wall_cleanup.sql](supabase/wall_cleanup.sql). Run it once in the SQL Editor. It does not wipe members or chats. Photos older than 1 hour are removed the next time someone opens the new app.
