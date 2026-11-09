Hostel Life — Run44 Manager Dining & Auth UI Patch

ভিত্তি: বর্তমানে বাস্তবায়িত Run43। এটি পূর্ণ প্রজেক্ট ZIP নয়; কেবল নির্বাচিত বদলানো ফাইল আছে।

প্রয়োগ:
1. বর্তমান Run43 project folder-এর backup নিন।
2. ZIP extract করুন। ভেতরের `Hostel Life/` folder-এর ফাইলগুলো একই relative path-এ আপনার বর্তমান project-এ merge/replace করুন।
3. ZIP-এ নেই এমন ফাইল delete বা replace করবেন না।
4. কোনো SQL/Migration চালাতে হবে না।
5. Manager account দিয়ে Dining-এর My Meal, Market Entry, Deposit, Other Expense, Admin Entry এবং Login/Registration desktop ও mobile-এ পরীক্ষা করুন।

এই patch কোনো production database, Edge Function, permission বা business logic পরিবর্তন করে না।
