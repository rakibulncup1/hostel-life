import { supabase } from '../lib/supabase';

const BUCKET = 'hostel_documents';
const TARGET_FILE_SIZE = 190 * 1024;
const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 1280;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('ছবিটি পড়া যায়নি। অন্য একটি ছবি চেষ্টা করুন।'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('ছবিটি compress করা যায়নি।'));
      else resolve(blob);
    }, 'image/jpeg', quality);
  });
}

async function compressProfileImage(file) {
  if (file.size <= TARGET_FILE_SIZE && file.type === 'image/jpeg') return file;

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('ছবি প্রস্তুত করার জন্য browser canvas পাওয়া যায়নি।');

  // JPEG has no alpha channel. Use white so transparent PNG/WebP avatars do not become black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.88;
  let blob = await canvasToBlob(canvas, quality);
  for (let attempt = 0; attempt < 8 && blob.size > TARGET_FILE_SIZE; attempt += 1) {
    quality -= 0.08;
    if (quality < 0.28) break;
    blob = await canvasToBlob(canvas, quality);
  }

  if (blob.size > TARGET_FILE_SIZE) {
    let smallerCanvas = canvas;
    for (let pass = 0; pass < 3 && blob.size > TARGET_FILE_SIZE; pass += 1) {
      const nextCanvas = document.createElement('canvas');
      nextCanvas.width = Math.max(320, Math.round(smallerCanvas.width * 0.82));
      nextCanvas.height = Math.max(320, Math.round(smallerCanvas.height * 0.82));
      const nextContext = nextCanvas.getContext('2d', { alpha: false });
      nextContext.fillStyle = '#ffffff';
      nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
      nextContext.imageSmoothingEnabled = true;
      nextContext.imageSmoothingQuality = 'high';
      nextContext.drawImage(smallerCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
      smallerCanvas = nextCanvas;
      blob = await canvasToBlob(smallerCanvas, Math.max(0.55, quality));
    }
  }

  if (blob.size > TARGET_FILE_SIZE) {
    throw new Error('ছবিটি ১৯০ KB-এর মধ্যে নামানো যায়নি। একটু কম resolution-এর ছবি চেষ্টা করুন।');
  }

  return new File([blob], 'profile-avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}

function assertSupabase() {
  if (!supabase) throw new Error('Supabase configuration পাওয়া যাচ্ছে না।');
}

export async function updateMyProfile({ fullName, phone = null, avatarUrl = null }) {
  assertSupabase();
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_full_name: fullName,
    p_phone: phone || null,
    p_avatar_url: avatarUrl || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function uploadProfileAvatar(userId, file) {
  assertSupabase();
  if (!userId) throw new Error('ব্যবহারকারীর পরিচয় পাওয়া যায়নি।');
  if (!(file instanceof File)) throw new Error('একটি ছবি নির্বাচন করুন।');
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('শুধু JPG, PNG বা WEBP ছবি ব্যবহার করুন।');
  if (file.size > MAX_INPUT_FILE_SIZE) throw new Error('ছবির মূল ফাইল ১০ MB-এর বেশি হতে পারবে না।');

  const compressed = await compressProfileImage(file);
  const path = `${userId}/profile-avatar`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    upsert: true,
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('ছবির লিংক তৈরি করা যায়নি।');
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function changePassword(newPassword) {
  assertSupabase();
  if (!newPassword || newPassword.length < 8) {
    throw new Error('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।');
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
