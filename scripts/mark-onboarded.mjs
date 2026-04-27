import { supabase } from "./admin.mjs";

const { data: usersList } = await supabase.auth.admin.listUsers();

for (const user of usersList.users) {
  const meta = user.user_metadata || {};
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...meta, onboarded: true },
  });
  if (error) {
    console.error(`Failed for ${user.email}:`, error.message);
  } else {
    console.log(`✓ Marked ${user.email} as onboarded`);
  }
}
