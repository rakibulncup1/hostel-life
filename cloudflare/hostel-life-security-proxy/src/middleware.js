// src/middleware.js
export function checkCloudflareProxy(req, res, next) {
    const expectedSecret = process.env.CLOUDFLARE_SECRET_KEY; // ভার্সেলে সেট করা সিক্রেট কি
    const clientSecret = req.headers['x-custom-secret'] || req.headers['cf-secret'];

    // যদি সিক্রেট কি না মিলে, তবে সরাসরি ব্লক করে দিবে
    if (expectedSecret && clientSecret !== expectedSecret) {
        return res.status(403).json({
            error: "Access Denied. Direct access to Vercel deployment is prohibited."
        });
    }

    // ঠিক থাকলে পরবর্তী ধাপে বা রাউটে যেতে দিবে
    if (typeof next === 'function') {
        next();
    }
}