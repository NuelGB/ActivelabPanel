// src/utils/uploadToSupabase.js
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function uploadToSupabase(file, folder) {
  const fileName = `${folder}/${Date.now()}_${file.originalname}`;
  const { error } = await supabase.storage
    .from("activelab-uploads")
    .upload(fileName, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  const { data } = supabase.storage.from("activelab-uploads").getPublicUrl(fileName);
  return data.publicUrl;
}
module.exports = uploadToSupabase;