# Hostel Life — Module 01, বড় UI batch 02 (পরীক্ষামূলক)

এই ZIP আগের Module 01 Progress-এর ওপর তৈরি। আগের সব সোর্স ও SQL রেফারেন্স রাখা হয়েছে; কোনো SQL কার্যকর করা হয়নি।

## নতুন সংশোধন
- Issue ১৪: Late Request কার্ডে একাধিক দীর্ঘ সতর্কতা সংক্ষিপ্ত, অর্থ অপরিবর্তিত; সম্পূর্ণ বিস্তারিত modal-এ আগের মতো আছে।
- Issue ১৭: ছোট স্ক্রিনে Market entry serial-কে একই input সারিতে জায়গা দেওয়া হয়েছে, আলাদা খালি row বাদ।
- Issue ২০: Assistant avatar-এর শুরুর অক্ষর স্ক্রিন রিডারে দুবার না পড়ার জন্য decorative করা হয়েছে; নামের টেক্সট অপরিবর্তিত। ভিজ্যুয়াল ডুপ্লিকেশন আসলেই হলে live screenshot প্রয়োজন।
- Issue ১/৮: mobile menu/manager heading আরো সংক্ষিপ্ত, responsive font/spacing।
- Issue ৯: super admin mobile header/stat card overflow containment।
- Issue ২৫: Late Request modal-এ internal flex-scroll, touch scrolling এবং viewport containment।
- Issue ১৮: keyboard focus outline এবং reduced-motion accessibility।
- Header: action buttons explicit type=button, unintended form submission রোধ।

## সতর্কতা
- ২৫টির সব সমস্যার সমাধান নয়; Permissions, storage retention, notification triggers, account security এবং SQL-নির্ভর মাস পরিবর্তন backend migration ছাড়া সমাধান হবে না।
- ২৯/২৯ automated unit tests পাস হয়েছে। Production build এখানে dependency না থাকায় চালানো যায়নি (vite: not found), npm install অনলাইনে সফল হয়নি।
- Live Supabase/mobile device এবং browser PDF print পরীক্ষা হয়নি।
- Production-এ ডেপ্লয় করার আগে আলাদা branch এবং backup দিয়ে mobile + desktop পরীক্ষা করুন।
