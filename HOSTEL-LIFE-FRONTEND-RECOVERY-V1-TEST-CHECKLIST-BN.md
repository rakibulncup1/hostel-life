# Hostel Life — Frontend Recovery V1 Test Checklist

প্রথমে production data-তে না করে স্বাভাবিক test workflow-এ ছোট করে যাচাই করো। কোনো test market entry/deposit/meal value পরিবর্তন করলে test data সম্পর্কে সচেতন থাকো।

## A. Late Request

- [ ] সাধারণ সদস্য, primary manager এবং assistant manager থেকে late request form খুলে warning box পড়া যায়।
- [ ] warning-এ স্পষ্ট যে submit করার পর request edit বা নতুন correction request করা যাবে না।
- [ ] pending late request-এর history খুললে approval-waiting message দেখা যায়; edit/correction action নেই।
- [ ] approved late request history খুললে disabled/locked text দেখা যায়; edit/correction action নেই।
- [ ] approved ordinary (non-late) normal request-এর বিদ্যমান edit/correction flow অক্ষত আছে।

## B. Dashboard Late Request Card

- [ ] late request নেই হলে card দেখা যায় না।
- [ ] অনুমোদিত late/correction থাকলে card আজকের/প্রাসঙ্গিক target date-এর label দেখায়।
- [ ] Breakfast/Lunch/Dinner-এ আগের meal-এর তুলনায় delta দেখায়: বৃদ্ধি `+` সবুজ, হ্রাস `−` লাল।
- [ ] এমন সদস্যের পূর্বের meal row না থাকলে তার requested meal পুরোটা positive delta হিসেবে ধরা হয়।
- [ ] card ক্লিক করলে member-wise আগের মান → requested value → delta এবং উপলভ্য কারণ দেখা যায়।
- [ ] card-এর last-sync আছে; একবার online-এ দেখা card offline-এ cached copy থেকে আসে।
- [ ] finalization deadline পার হলে card আর দেখায় না।
- [ ] Khala-কে মিল গোনার সময় main meal card-এর সঙ্গে delta সমন্বয় করার red reminder দেখা যায়।

## C. হিসাব ইতিহাস

- [ ] non-primary account-এ default “সবার হিসাব” থাকে এবং একই hostel-এর transaction দেখা যায়।
- [ ] “শুধু আমার” নির্বাচন করলে নিজের হিসাব থাকে; আবার “সবার হিসাব” করলে পুরো তালিকা ফিরে আসে।
- [ ] Deposit / Market Deposit / Other Expense card দিয়ে second-level filter কাজ করে।
- [ ] primary manager-এর existing member filter ও list আচরণ অক্ষত থাকে।
- [ ] manager-এর হিসাব row-তে আলাদা “সম্পাদনা” button নেই; row-তে click বা Enter/Space করলে বিস্তারিত modal খোলে।
- [ ] Deposit/Other Expense-এর মতো edit-যোগ্য হিসাবের detail modal থেকে “সম্পাদনা করুন” করলে আগের edit modal খোলে; market deposit/adjustment সরাসরি edit করার action দেখায় না।
- [ ] PDF/Print ও Refresh buttons desktop-এ শিরোনামের পাশে সুন্দরভাবে থাকে।

## D. Icon, balances, Khala Money

- [ ] Admin Entry-তে Final Meal Correction-এর icon primary manager-এ দেখা যায়।
- [ ] assistant manager-এ icon দেখা যায়, কিন্তু Final Meal Correction নিষ্ক্রিয়ই থাকে।
- [ ] Dashboard ও account balance-এ “বর্তমান বকেয়া” label/value লাল, “বর্তমান অবশিষ্ট” সবুজ/primary।
- [ ] ordinary member-এর Khala Money page-এ সুন্দর personal summary ও all-member history দেখা যায়।
- [ ] ordinary member-এর Khala history-তে delete/edit action নেই।

## E. Market (এখনও যাচাই প্রয়োজন)

- [ ] সাধারণ account দিয়ে test market entry করা হলে success message এবং history row আসে।
- [ ] primary/assistant manager-এ অনুমোদিত market entry flow কাজ করে।
- [ ] manager Market History থেকে একটি existing valid entry খুলে edit/save করলে items, total ও history refresh হয়।
- [ ] ব্যর্থ হলে error message, browser Console এবং Network response সংরক্ষণ করো। প্রয়োজন হলে `supabase/READ_ONLY_MARKET_DIAGNOSTIC_V2.sql` চালিয়ে CSV পাঠাও।

## টেস্ট রিপোর্টের সীমা

এটি manual checklist; এই archive তৈরির সময় উপরের live interactions test করা হয়নি। সবগুলো box টিক না দেওয়া পর্যন্ত package-কে fully verified বলা যাবে না।
