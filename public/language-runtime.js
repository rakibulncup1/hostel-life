/* Hostel Life bilingual runtime. UI-only translation; user-authored data is not altered. */
(() => {
  'use strict';
  const STORAGE_KEY = 'hostel-life-language-v1';
  const CHANGE_EVENT = 'hostel-life-language-changed';
  const EN = {
    'পরিচিতি': 'About', 'ফিচার': 'Features', 'প্রধান ফিচার': 'Key features', 'অ্যাপের অভিজ্ঞতা': 'App experience',
    'প্রধান নেভিগেশন': 'Main navigation', 'মোবাইল নেভিগেশন': 'Mobile navigation', 'মেনু খুলুন': 'Open menu', 'মেনু বন্ধ করুন': 'Close menu',
    'অ্যাকাউন্ট': 'Account', 'অ্যাকাউন্টে প্রবেশ করুন': 'Sign in', 'প্রবেশ করুন': 'Sign in', 'অ্যাকাউন্ট তৈরি করুন': 'Create account',
    'অ্যাকাউন্ট তৈরি করুন ↗': 'Create account ↗', 'অ্যাকাউন্টে প্রবেশ করুন ↗': 'Sign in ↗', 'রেজিস্ট্রেশন': 'Sign up', 'লগইন': 'Login',
    'ফিচার দেখুন': 'Explore features', 'অ্যাপ ডাউনলোড': 'Download app', 'অ্যাপ ডাউনলোড ↓': 'Download app ↓', 'যোগাযোগ': 'Contact',
    'গোপনীয়তা': 'Privacy', 'গোপনীয়তা নীতি': 'Privacy Policy', 'গোপনীয়তা': 'Privacy', 'গোপনীয়তা নীতি': 'Privacy Policy',
    'ব্যবহারের শর্তাবলী': 'Terms of Service', 'শর্তাবলী': 'Terms', 'সেবার পরিধি': 'Service overview',
    'মেসের দৈনন্দিন ব্যবস্থাপনা': 'Everyday hostel management', 'মেসের প্রতিদিনের কাজ হোক': 'Make everyday hostel tasks',
    'আরও সহজ ও গোছানো।': 'simpler and more organised.', 'দৈনিক মিল, বাজারের খরচ ও সদস্যদের জমার তথ্য রাখুন এক জায়গায়। প্রয়োজন হলে আগের রেকর্ড ও মাসিক হিসাব দেখে নিন।': 'Keep daily meals, market expenses and member deposits in one place. Review previous records and monthly accounts whenever needed.',
    'মিল ও অনুরোধ': 'Meals & requests', 'বাজার ও জমা': 'Market & deposits', 'মাসিক রিপোর্ট': 'Monthly reports',
    'অ্যাপটি দেখুন': 'Explore the app', 'ইন্টারফেসের নমুনা': 'Interface preview', 'নমুনা': 'Sample', 'নমুনা তথ্য': 'Sample data',
    'কোডে তৈরি নমুনা UI': 'Code-built UI preview', 'ড্যাশবোর্ড': 'Dashboard', 'ডাইনিং': 'Dining', 'হিস্টরি': 'History', 'প্রোফাইল': 'Profile',
    'সদস্য': 'Member', 'সদস্যরা': 'Members', 'সকল সদস্য': 'All members', 'সদস্য তালিকা': 'Member list', 'সদস্যের নাম': 'Member name',
    'মেস': 'Hostel', 'মেসের নাম': 'Hostel name', 'মেস ব্যবস্থাপনা': 'Hostel management', 'মেস সেটিংস': 'Hostel settings',
    'ম্যানেজার': 'Manager', 'সহকারী ম্যানেজার': 'Assistant manager', 'ম্যানেজার প্যানেল': 'Manager panel', 'ম্যানেজার টুলস': 'Manager tools',
    'হিসাব ও সদস্য': 'Accounts & members', 'সিস্টেম তথ্য': 'System information', 'লগআউট': 'Sign out', 'ফিরে যান': 'Go back', 'ফিরে যান ←': '← Go back',
    'বন্ধ করুন': 'Close', 'বাতিল': 'Cancel', 'বাতিল করুন': 'Cancel', 'মুছুন': 'Delete', 'সরান': 'Remove', 'সংরক্ষণ করুন': 'Save',
    'সংরক্ষণ': 'Save', 'পরিবর্তন সংরক্ষণ': 'Save changes', 'সংরক্ষণ হচ্ছে...': 'Saving...', 'আপডেট': 'Update', 'এডিট': 'Edit',
    'পরিবর্তন': 'Change', 'পরিবর্তন করুন': 'Change', 'বিস্তারিত': 'Details', 'আরও দেখুন': 'View more', 'দেখুন': 'View', 'খুলুন': 'Open',
    'হ্যাঁ': 'Yes', 'না': 'No', 'ঠিক আছে': 'OK', 'বুঝেছি': 'Got it', 'আবার চেষ্টা করুন': 'Try again', 'আবার চেষ্টা': 'Try again',
    'রিফ্রেশ': 'Refresh', 'লোড হচ্ছে...': 'Loading...', 'লোড হচ্ছে': 'Loading', 'যাচাই হচ্ছে...': 'Verifying...', 'প্রস্তুত হচ্ছে...': 'Preparing...',
    'অনুসন্ধান': 'Search', 'খুঁজুন': 'Search', 'ফিল্টার': 'Filter', 'ফিল্টার মুছুন': 'Clear filters', 'কোনো তথ্য পাওয়া যায়নি': 'No information found',
    'কোনো সদস্য পাওয়া যায়নি': 'No members found', 'কোনো মিল পাওয়া যায়নি।': 'No meals found.', 'কোনো নোটিফিকেশন নেই': 'No notifications',
    'নতুন আপডেট এলে এখানে দেখা যাবে।': 'New updates will appear here.', 'নোটিফিকেশন': 'Notifications', 'সব দেখা': 'Mark all as seen', 'সব ডিলিট': 'Delete all',
    'নোটিফিকেশন লোড হচ্ছে...': 'Loading notifications...', 'রিফ্রেশ করুন': 'Refresh', 'আপনার আপডেট': 'Your updates', 'ম্যানেজারের বার্তা': 'Manager messages',
    'মেসের নোটিশ': 'Hostel notice', 'মেসের ঘোষণা': 'Hostel announcement', 'মেসের বাজার': 'Hostel market', 'মেসের সদস্য': 'Hostel members',
    'নাম': 'Name', 'মোবাইল নম্বর': 'Mobile number', 'ইমেইল': 'Email', 'পাসওয়ার্ড': 'Password', 'বর্তমান পাসওয়ার্ড': 'Current password',
    'নতুন পাসওয়ার্ড': 'New password', 'নতুন পাসওয়ার্ড আবার': 'Confirm new password', 'পাসওয়ার্ড আবার দিন': 'Confirm password',
    'পাসওয়ার্ড ভুলে গেছেন?': 'Forgot password?', 'পাসওয়ার্ড পুনরুদ্ধার': 'Password recovery', 'পাসওয়ার্ড পরিবর্তন': 'Change password',
    'পাসওয়ার্ড পরিবর্তন করুন': 'Change password', 'পাসওয়ার্ড রিসেট': 'Password reset', 'ইমেইল যাচাই': 'Verify email',
    'ইমেইল যাচাই করুন': 'Verify email', 'ইমেইল যাচাই সম্পন্ন হয়েছে': 'Email verified', '৬ সংখ্যার কোড': '6-digit code',
    'ভেরিফিকেশন কোড': 'Verification code', 'কোড আবার পাঠান': 'Resend code', 'নতুন কোড পাঠান': 'Send a new code', 'কোড পাননি?': 'Didn’t receive the code?',
    'নাম লিখুন': 'Enter your name', 'আপনার নাম': 'Your name', 'আপনার ইমেইল': 'Your email', 'যে ইমেইলে অ্যাকাউন্ট আছে': 'Email linked to your account',
    'ঐচ্ছিক': 'Optional', 'নিরাপদ অ্যাকাউন্ট': 'Secure account', 'আবারও স্বাগতম': 'Welcome back', 'নতুন যাত্রা শুরু হোক': 'Let’s get started',
    'অ্যাকাউন্ট সহায়তা': 'Account help', 'আপনার অ্যাকাউন্টে প্রবেশ করুন': 'Sign in to your account', 'একটি অ্যাকাউন্ট তৈরি করুন': 'Create an account',
    'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে নিরাপদে প্রবেশ করুন।': 'Sign in securely with your email and password.',
    'নাম, মোবাইল ও ইমেইল দিয়ে অ্যাকাউন্ট তৈরি করুন।': 'Create an account with your name, mobile number and email.',
    'মিল, বাজার ও হিসাব—এক জায়গায়, স্বচ্ছতা ও আস্থার সঙ্গে।': 'Meals, markets and accounts—in one place, with clarity and confidence.',
    'মিলের হিসাব': 'Meal tracking', 'বাজার ও জমা': 'Markets & deposits', 'মাসিক রিপোর্ট': 'Monthly reports',
    'Inbox-এ না পেলে Spam/Junk বা Promotions ফোল্ডার দেখুন।': 'Check your Spam/Junk or Promotions folder if it is not in your inbox.',
    'নিরাপত্তার কারণে ইমেইল পরিবর্তন করা যাবে না।': 'Email cannot be changed for security reasons.', 'নিরাপত্তা': 'Security', 'সদস্যতা': 'Membership',
    'মেসের তথ্য': 'Hostel information', 'আমার ভূমিকা': 'My role', 'যুক্ত হওয়ার সময়': 'Joined on', 'অভিজ্ঞতা': 'Experience', 'থিম পছন্দ': 'Theme preference',
    'হোস্টেল লাইফ সাপোর্ট': 'Hostel Life Support', 'ব্যক্তিগত তথ্য': 'Personal information', 'প্রোফাইল পরিচিতি': 'Profile overview',
    'ছবির ফরম্যাট: JPG, PNG, WEBP': 'Image formats: JPG, PNG, WEBP', 'প্রোফাইল ছবি পরিবর্তন': 'Change profile photo', 'প্রোফাইল ছবি আপলোড করা যায়নি।': 'Could not upload profile photo.',
    'এখনো মেসে কোনো সদস্যের তথ্য নেই।': 'There is no member information in this hostel yet.', 'কোনো সদস্য পাওয়া যায়নি': 'No members found',
    'জমা': 'Deposit', 'ডিপোজিট': 'Deposit', 'সদস্যের জমা': 'Member deposit', 'সদস্যদের জমা': 'Member deposits', 'খরচ': 'Expense', 'মোট খরচ': 'Total expenses',
    'অন্যান্য খরচ': 'Other expenses', 'মোট বাজার': 'Total market expenses', 'বাজার': 'Market', 'বাজার এন্ট্রি': 'Market entry', 'বাজারকারী': 'Buyer',
    'আইটেম': 'Item', 'পণ্যের নাম': 'Product name', 'পরিমাণ': 'Quantity', 'মোট': 'Total', 'মোট মিল': 'Total meals', 'মিল খরচ': 'Meal cost',
    'ব্রেকফাস্ট': 'Breakfast', 'লাঞ্চ': 'Lunch', 'ডিনার': 'Dinner', 'সকালের মিল': 'Breakfast', 'দুপুরের মিল': 'Lunch', 'রাতের মিল': 'Dinner',
    'আজকের মিল': 'Today’s meals', 'আগামী ৭ দিন': 'Next 7 days', 'আগামী সাত দিনের মিল': 'Meals for the next seven days', 'লেট অনুরোধ': 'Late request',
    'মিল অনুরোধ': 'Meal request', 'সাধারণ অনুরোধ': 'Regular request', 'মিল অনুরোধ · দিন তৈরি': 'Meal request · Create days', 'মিল পরিকল্পনা': 'Meal planning',
    'মিল সংশোধন': 'Meal correction', 'দৈনিক মিল': 'Daily meals', 'দৈনিক তালিকা': 'Daily list', 'দিনভিত্তিক': 'Daily', 'তারিখ': 'Date', 'তারিখ নির্বাচন': 'Select date',
    'তারিখ নেই': 'No date', 'আজ': 'Today', 'আগামীকাল': 'Tomorrow', 'চলমান মাস': 'Current month', 'কাজের মাস': 'Active month', 'বন্ধ মাসসমূহ': 'Closed months',
    'মাসিক হিসাব': 'Monthly accounts', 'মাসিক সারসংক্ষেপ': 'Monthly summary', 'মাসিক প্রতিবেদন': 'Monthly report', 'রিপোর্ট': 'Reports', 'রিপোর্ট ডাউনলোড': 'Download reports',
    'রিপোর্ট ডাউনলোড করুন': 'Download report', 'বিস্তারিত রিপোর্ট': 'Detailed report', 'মাসিক সারসংক্ষেপ · সদস্যভিত্তিক হিসাব': 'Monthly summary · Member-wise accounts',
    'অবস্থা': 'Status', 'সক্রিয়': 'Active', 'নিষ্ক্রিয়': 'Inactive', 'অপেক্ষমাণ': 'Pending', 'অনুমোদিত': 'Approved', 'বাতিল': 'Cancelled',
    'সম্পন্ন': 'Completed', 'পরিকল্পিত': 'Scheduled', 'সংশোধন': 'Correction', 'রেকর্ড': 'Record', 'রেকর্ড সংরক্ষণ': 'Save record', 'মোট রেকর্ড': 'Total records',
    'নোটিশ': 'Notice', 'নোটিশ পাঠান': 'Send notice', 'নোটিশ প্রকাশ করুন': 'Publish notice', 'নোটিশের শিরোনাম দিন': 'Enter a notice title', 'বার্তা': 'Message', 'শিরোনাম': 'Title',
    'মেস নোটিশ': 'Hostel notice', 'জয়েন রিকোয়েস্ট পর্যালোচনা': 'Review join requests', 'সদস্য ব্যবস্থাপনা': 'Member management', 'ডাইনিং ব্যবস্থাপনা': 'Dining management',
    'মিল শিট': 'Meal sheet', 'খালার টাকা': 'Staff allowance', 'খালার পারিশ্রমিক': 'Staff payment', 'পারিশ্রমিকের হিসাব': 'Allowance records',
    'শীর্ষ খাদক': 'Top meal consumers', 'বেশি বাজারকারী': 'Top buyers', 'বেশি ডিপোজিটকারী': 'Top depositors', 'আর্কাইভ': 'Archive', 'অ্যাপ ডাউনলোড': 'Download app',
    'টেলিগ্রাম সংযোগ': 'Telegram connection', 'হেল্প': 'Help', 'কীভাবে ব্যবহার করব': 'How to use', 'মেস সেটিংস': 'Hostel settings', 'বর্তমান মাস শেষ করুন': 'Close current month',
    'নতুন মাস শুরু': 'Start a new month', 'ম্যানেজার পরিবর্তন': 'Change manager', 'সহকারী ম্যানেজার': 'Assistant manager', 'মেস নোটিশ': 'Hostel notice',
    'হিসাবের ধরন': 'Account type', 'জমার পরিমাণ': 'Deposit amount', 'জমার তারিখ': 'Deposit date', 'খরচের রেকর্ড': 'Expense records', 'খরচের রেকর্ড ও সদস্যদের জমা': 'Expense records and member deposits',
    'অগ্রাধিকার তালিকা': 'Priority list', 'এখনো কোনো র‌্যাঙ্কিং নেই': 'There are no rankings yet', 'এই মাসের তথ্য যোগ হলে তালিকা এখানে দেখা যাবে।': 'The list will appear here when this month’s data is available.',
    'সময় মনে রাখুন': 'Keep these times in mind', 'মিল অনুরোধ ও মাস পরিচালনার সময়': 'Meal request and monthly management times', 'সাধারণ মিল অনুরোধ': 'Regular meal request',
    'দৈনিক মিল ফাইনাল': 'Daily meal finalization', 'নতুন মাস চালু': 'Start a new month', 'রাত ১০টা': '10:00 PM', 'রাত ৯টা': '9:00 PM', 'রাত ৮টার পর': 'After 8:00 PM',
    'মিলের আগের দিন এই সময়ের আগে সাধারণ অনুরোধ দিন।': 'Submit regular meal requests before this time on the previous day.',
    'মিলের দিন রাত ৯টায় হিসাব চূড়ান্ত হয়।': 'The meal record is finalized at 9:00 PM on the meal date.',
    'আগের রাত ১০টার পর থেকে মিলের দিন রাত ৯টার আগে; অনুমোদন প্রয়োজন।': 'From 10:00 PM the previous night until 9:00 PM on the meal date; approval is required.',
    'মাস বন্ধের দিন এই সময়ের পর; নতুন মাস শুরু হবে পরের দিন।': 'After this time on the closing date; the new month starts the following day.',
    'বিষয়ভিত্তিক প্রশ্নোত্তর': 'Topic-based help', 'যে বিষয়ে জানতে চান সেটি খুলুন': 'Choose a topic to explore',
    'প্রথমে বিষয় নির্বাচন করুন, তারপর পছন্দের প্রশ্ন খুলে উত্তর দেখুন।': 'Choose a topic, then open a question to view its answer.',
    'সিস্টেম তথ্য': 'System information', 'অতিরিক্ত নিরাপত্তা': 'Additional security', 'সিস্টেম কন্ট্রোল': 'System controls', 'পর্যবেক্ষণ ও পরিচালনা': 'Monitoring & operations',
    'এক নজরে প্ল্যাটফর্ম': 'Platform overview', 'প্ল্যাটফর্মের সামগ্রিক রিপোর্ট': 'Platform summary report', 'অ্যাক্টিভিটি লগ': 'Activity log', 'নিরাপত্তা পর্যবেক্ষণ': 'Security monitoring',
    'সুপার অ্যাডমিন': 'Super Admin', 'Super Admin': 'Super Admin', 'দ্বিতীয় নিরাপত্তা ধাপ': 'Second security step', 'Authenticator': 'Authenticator',
    'কোনো মেস নির্বাচন করা হয়নি': 'No hostel selected', 'প্রথমে মেস নির্বাচন করুন।': 'Select a hostel first.', 'মাস নির্বাচন': 'Select month', 'মেস নির্বাচন': 'Select hostel',
    'শুরুর তারিখ': 'Start date', 'শেষ তারিখ': 'End date', 'কারণ': 'Reason', 'প্রযোজ্য': 'Applicable', 'সীমা': 'Limit', 'সময়': 'Time', 'ধাপ': 'Step',
    'রাত ১০টা → ৯টা': '10:00 PM → 9:00 PM', 'অনুমতি প্রয়োজন': 'Approval required', 'আপনার পছন্দ': 'Your preference', 'থিম': 'Theme', 'সিস্টেম অনুযায়ী': 'System',
    'লাইট': 'Light', 'ডার্ক': 'Dark', 'আকাশি নীল': 'Sky blue', 'রঙের থিম পরিবর্তন': 'Change color theme', 'থিম পরিবর্তন': 'Change theme', 'থিম নির্বাচন': 'Choose theme',
    'ইন্টারনেট সংযোগ প্রয়োজন': 'Internet connection required', 'ইন্টারনেট সংযোগ নেই': 'No internet connection', 'অফলাইন মোড': 'Offline mode', 'অনলাইন': 'Online', 'অফলাইন': 'Offline',
    'ইন্টারনেট সংযোগ চালু করুন।': 'Connect to the internet.', 'এই অংশটি ব্যবহার করতে ইন্টারনেট সংযোগ প্রয়োজন।': 'An internet connection is required to use this section.',
    'আপনার তথ্য': 'Your information', 'নিরাপত্তার কারণে লগআউট': 'Signed out for security reasons', 'আপনার সদস্যতা বর্তমানে নিষ্ক্রিয়': 'Your membership is currently inactive',
    'নতুন মাস শুরু করবেন?': 'Start a new month?', 'হ্যাঁ, নতুন মাস চালু করুন': 'Yes, start the new month', 'মাস শুরু হয়নি': 'Month has not started',
    'নতুন মাস শুরু হলে হিসাব আবার দেখানো হবে।': 'The account summary will appear when the new month starts.', 'কোনো পূর্ববর্তী মাস নেই': 'No previous months',
    'আবার যাচাই করুন': 'Verify again', 'অবস্থা যাচাই করুন': 'Check status', 'ড্যাশবোর্ডে ফিরে যান': 'Return to dashboard', 'ড্যাশবোর্ডে যান': 'Go to dashboard',
    'অ্যাকাউন্ট সেটআপ': 'Account setup', 'শুরু করুন': 'Get started', 'কিভাবে শুরু করবেন?': 'How would you like to start?', 'মেসে যুক্ত হন': 'Join a hostel',
    'নতুন মেস তৈরি করুন': 'Create a new hostel', 'যোগদানের কোড': 'Join code', 'কোড দিয়ে মেসে যুক্ত হন': 'Join a hostel with a code',
    'যুক্ত হওয়ার কোড': 'Join code', 'কোড বসান': 'Enter code', 'মেসের নাম দিন': 'Enter hostel name', 'মেসের নাম': 'Hostel name',
    'আমন্ত্রণ যাচাই হচ্ছে': 'Verifying invitation', 'নিরাপদে আমন্ত্রণের তথ্য প্রস্তুত করা হচ্ছে।': 'Preparing invitation details securely.', 'সদস্য আমন্ত্রণ': 'Member invitation',
    'মেসে যোগ দিন': 'Join a hostel', 'অনুরোধ অপেক্ষমাণ': 'Request pending', 'অনুরোধ অনুমোদিত হয়নি': 'Request not approved', 'অনুরোধ অনুমোদিত': 'Request approved',
    'ম্যানেজারের জন্য বার্তা (ঐচ্ছিক)': 'Message to the manager (optional)', 'যোগদানের অনুরোধ পাঠান': 'Send join request', 'অনুরোধ পাঠানো হচ্ছে...': 'Sending request...',
    'পরে': 'Later', 'অ্যাকাউন্ট পরিবর্তন করুন': 'Switch account', 'অন্য অ্যাকাউন্ট ব্যবহার করুন': 'Use another account',
    'ভাষা': 'Language', 'ভাষা নির্বাচন': 'Choose language', 'ভাষা পরিবর্তন': 'Change language', 'বাংলা': 'বাংলা', 'English': 'English',
    'বাংলা ভাষা': 'Bangla', 'ইংরেজি ভাষা': 'English', 'ভাষা সংরক্ষণ হয়েছে।': 'Language preference saved.',
    'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে নিরাপদে প্রবেশ করুন।': 'Sign in securely with your email and password.',
    'Hostel Life চালাতে JavaScript চালু করতে হবে।': 'JavaScript must be enabled to use Hostel Life.',
    'Hostel Life পরিচিতি': 'About Hostel Life', 'প্রধান কাজের ক্ষেত্র': 'Main areas', 'সহায়ক লিংক': 'Helpful links',
    'নিরাপদ আমন্ত্রণের তথ্য প্রস্তুত করা হচ্ছে।': 'Preparing invitation details securely.', 'মেস তৈরি হয়েছে': 'Hostel created', 'প্রথম মাস চালু হয়ে গেছে।': 'The first month is now active.', 'যাচাইকৃত': 'Verified', 'আপনার অনুরোধ মেসের ম্যানেজার অনুমোদন করলে সদস্যপদ চালু হবে।': 'Your membership will become active after the hostel manager approves your request.',
    'এই লিংক দিয়ে লগইন ছাড়া কোনো মেসের ড্যাশবোর্ড বা ব্যক্তিগত তথ্য দেখা যায় না।': 'This link does not reveal a hostel dashboard or personal information without signing in.',
  };

  const KEY_EN = {
    'common.about': 'About', 'common.login': 'Sign in', 'common.register': 'Create account', 'common.download': 'Download app', 'common.privacy': 'Privacy Policy', 'common.terms': 'Terms of Service',
    'about.nav.features': 'Features', 'about.nav.experience': 'App experience', 'about.hero.eyebrow': 'Everyday hostel management',
    'about.hero.title': 'Make everyday hostel tasks', 'about.hero.description': 'Keep daily meals, market expenses and member deposits in one place. Review previous records and monthly accounts whenever needed.',
    'about.hero.point.meals': 'Meals & requests', 'about.hero.point.market': 'Market & deposits', 'about.hero.point.reports': 'Monthly reports',
    'about.workflow.eyebrow': 'How it works', 'about.workflow.title': 'From account setup to monthly reports in three simple steps',
    'about.workflow.description': 'Move from daily records to monthly summaries in three steps.',
    'about.workflow.step1.title': 'Sign in to your account', 'about.workflow.step1.description': 'Create a new account or sign in to continue.',
    'about.workflow.step2.title': 'Record daily activity', 'about.workflow.step2.description': 'Keep meal requests, market entries and deposits organised.',
    'about.workflow.step3.title': 'Review monthly accounts', 'about.workflow.step3.description': 'Check records and monthly summaries when needed.',
    'about.features.title': 'Tools for everyday hostel management', 'about.features.description': 'A clear view of the daily work and the records behind it.',
    'about.management.report.title': 'A complete monthly report', 'about.management.report.description': 'Review total market expenses, meal rate, remaining balance and member-wise deposits and expenses in one report.',
    'about.contact.title': 'Have a question?', 'about.contact.description': 'Get in touch with Hostel Life support.', 'about.copy.0532dcda03': 'November 15, 2026',
    'about.management.eyebrow': 'Management, reviews & reports',
    'about.management.title': 'Information storage, review and monthly reports',
    'about.management.description': 'Managers review requests, manage daily responsibilities and view monthly accounts.',
    'about.management.requests.title': 'Review and approve meal requests',
    'about.management.requests.description': 'View pending, late and regular requests in separate lists. Approve or request corrections as needed.',
    'about.management.menu.title': 'A role-based management menu',
    'about.management.menu.description': 'Members, reports, archives, notices and management tools are organised in one menu. Available options depend on each user’s role and permissions.',
    'about.management.report.title': 'A complete monthly report',
    'about.management.report.description': 'Review market expenses, meal rate, remaining balance and member-wise deposits and expenses in one report.',
    'about.menu.accounts': 'Accounts & members', 'about.menu.mealSheet': 'Meal sheet',
    'about.menu.management': 'Management', 'about.menu.assistants': 'Assistant managers',
    'about.menu.joinRequests': 'Join requests', 'about.menu.staff': 'Staff allowance',
    'about.run74.topLists': 'Rankings & member insights', 'about.run74.monthClose': 'Close month & start a new one',
    'about.run74.diningAdmin': 'Dining management', 'about.report.mealRate': 'Meal rate',
    'about.report.mealRate.value': '৳ 42.50',
    'about.copy.7cbc8fbb54': '05 · Manager review', 'about.copy.cdb60efa35': 'Request review · Approval status',
    'about.copy.7e4bddf5f8': 'Request review', 'about.copy.ca0e079d07': 'Pending',
    'about.copy.59bc81dac1': 'Late request', 'about.copy.8de1534ba7': 'Correction',
    'about.copy.89846faba0': 'Request', 'about.copy.3328b56617': 'Date', 'about.copy.c9dfad7d50': 'Status',
    'about.copy.4c3a7883c3': 'Meal correction', 'about.copy.593a476024': 'Nov 15',
    'about.copy.e631c39f22': 'Under review', 'about.copy.b750e92d02': 'Regular request',
    'about.copy.134edc8133': 'Nov 16', 'about.copy.03c740f679': 'Completed',
    'about.copy.5c220af0e5': 'Manager panel · UI preview', 'about.copy.a24e5cdbf1': '06 · Hostel management',
    'about.copy.8f3f11b2f7': 'Members · Archive · Manager tools', 'about.copy.7cf184f4c6': 'H',
    'about.copy.80be3f5c5b': 'Hostel Life', 'about.copy.ff5fcd28b4': 'Members',
    'about.copy.0b4ad19350': 'Archive', 'about.copy.9cd37d2f8e': 'Download reports',
    'about.copy.2966486bb2': 'Hostel settings', 'about.copy.9a487d2774': 'Notices',
    'about.copy.3ff222b8bb': 'Management menu · UI preview', 'about.copy.f12bf70428': '07 · Monthly accounts',
    'about.copy.2897f7ddb6': 'Monthly summary · Member-wise accounts',
    'about.copy.3bea83a59f': 'Monthly report', 'about.copy.7938945538': 'Sample accounts · November 2026',
    'about.copy.56d8a9fcde': 'Total market expenses', 'about.copy.e6058a7aa8': 'Remaining balance',
    'about.copy.b0c0645c42': 'Account type', 'about.copy.ed6edb58bf': 'Amount',
    'about.copy.4e1da7bd14': 'Member deposits', 'about.copy.af088d473a': 'Total expenses',
    'about.copy.73313eb0fa': 'Monthly report · UI preview',
    'about.copy.9394758084': 'Hostel Life is software for managing hostel accounts and records. It is not a payment gateway and does not process money transfers.',
    'about.copy.3eec0c8b85': 'Service overview',
    'about.copy.6564582d82': '↗', 'about.copy.9d6efc9496': 'Meal requests',
    'about.copy.1e99fe1208': 'Date and meal planning', 'about.copy.cfdde5cf4d': 'Market entry',
    'about.copy.85125535d3': 'Expense records', 'about.copy.08ae1b68db': '+',
    'about.copy.b88dc5121e': 'Deposit', 'about.copy.007825ecf6': 'Member deposits',
    'about.copy.6e33af89c8': 'Records', 'about.copy.4f174cb968': 'Sample',
    'about.copy.6c69774081': 'Daily list', 'about.copy.5e631839d7': 'people',
    'about.copy.8bd68ff3b2': 'Dining', 'about.copy.cfaab68eab': 'Daily activity',
    'about.copy.cfe4358b28': 'Sample data', 'about.copy.af088d473a': 'Total expenses',
    'about.copy.5e4f779542': 'Deposit records', 'about.copy.2b38160d28': 'Staff allowance records',
    'about.copy.6603a1171b': 'Monthly', 'about.copy.da16b61fca': 'Staff allowance · Monthly accounts',
    'about.copy.56c1ed443d': 'Hostel Life — Make everyday hostel tasks simpler and more organised',
    'about.copy.3c82809109': 'Hostel management', 'about.copy.609ff65848': 'Dashboard',
    'about.copy.ce4fea4852': 'Today’s overview', 'about.copy.5c4bb2f866': 'November 15',
    'about.copy.c8ace1cc38': 'Total members', 'about.copy.ebb2c87311': 'Total meals',
    'about.copy.e450a13c64': 'Market', 'about.copy.b0d12ecc1f': 'Entries',
    'about.copy.802d8cbe02': 'Daily overview at a glance', 'about.copy.e41fc95956': 'Interface preview',
    'about.copy.4afc022833': 'Meals, market & deposits', 'about.copy.cd6be110bb': 'Daily meals',
    'about.copy.dd6628c473': 'Meals, requests & corrections', 'about.copy.4b54e7338e': 'Market & deposits',
    'about.copy.b679fbb0aa': 'Expense records & member deposits', 'about.copy.6dbecd5133': 'Monthly accounts',
    'about.copy.20cbe6e36a': 'Summary & final reports', 'about.copy.4bd56b9ec6': 'Meal planning',
    'about.copy.04ed1ba318': 'By day', 'about.copy.119edfc8c8': 'B',
    'about.copy.39492e4136': 'Breakfast', 'about.copy.7639554285': 'Scheduled',
    'about.copy.0b09af0fdd': 'L', 'about.copy.381bafac1c': 'Lunch',
    'about.copy.4ec207478e': 'D', 'about.copy.86fb40b5ca': 'Dinner',
    'about.copy.0a1b18e1d1': 'Interface preview', 'about.copy.27bb5b4616': 'Meal request · Create days',
    'about.copy.cccf20a166': 'Product name', 'about.copy.ed6edb58bf': 'Quantity',
    'about.copy.af389cee3f': 'Expense', 'about.copy.b8cc84d169': 'Rice',
    'about.copy.943164f9e8': '2 kg', 'about.copy.90b23dc030': 'Lentils',
    'about.copy.3f5968b3b7': '1 kg', 'about.copy.836f5e1280': 'Vegetables',
    'about.copy.1b78270cf3': 'Market entry · Item list', 'about.copy.25e4da8f52': 'Sample member',
    'about.copy.2828b7a1c8': 'Member 01', 'about.copy.4dac2634de': 'Deposit amount',
    'about.copy.ceb628ae58': 'Deposit date', 'about.copy.98e506cf61': 'Ready to save records',
    'about.copy.0232a47481': 'Deposit · Save deposit', 'about.copy.0eb22a4c40': 'Selected month',
    'about.copy.19adb8ceca': 'November 2026', 'about.copy.eec36cd127': 'Total records',
    'about.copy.d7d7d8cf2a': '03 records', 'about.copy.a98bd8c7d8': 'November 5',
    'about.copy.e6a39e5c62': 'November 10', 'about.copy.1604a72863': 'November 14',
    'auth.login.heading': 'Account Login',
    'about.features.eyebrow': 'Everyday management',
    'about.feature.meal.title': 'Plan meals in advance and manage requests',
    'about.feature.meal.description': 'Set meals by date, review requests and make changes when needed.',
    'about.feature.meal.previewMeta': '01 · Meal management',
    'about.feature.market.title': 'Detailed market expense records',
    'about.feature.market.description': 'Record item names, quantities and costs for every market purchase.',
    'about.feature.market.previewMeta': '02 · Market management',
    'about.feature.deposit.title': 'Member deposits and payment records',
    'about.feature.deposit.description': 'Record deposits for each member and review previous payments.',
    'about.feature.deposit.previewMeta': '03 · Deposits',
    'about.feature.allowance.title': 'Separate staff allowance records',
    'about.feature.allowance.description': 'Keep staff allowance details organised by month and date.',
    'about.feature.allowance.previewMeta': '04 · Separate accounts',
    'about.preview.organised': 'Organised in one place',
    'about.sample.market.riceAmount': '৳ 160',
    'about.sample.market.lentilsAmount': '৳ 130',
    'about.sample.market.vegetablesAmount': '৳ 90',
    'about.sample.market.totalAmount': '৳ 380',
    'about.sample.deposit.amount': '৳ 1,000',
    'about.sample.allowance.firstAmount': '৳ 500',
    'about.sample.allowance.secondAmount': '৳ 600',
    'about.sample.allowance.thirdAmount': '৳ 400',
    'about.sample.report.marketAmount': '৳ 12,450',
    'about.sample.report.balanceAmount': '৳ 2,300',
    'about.sample.report.depositAmount': '৳ 15,000',
    'about.sample.report.expenseAmount': '৳ 12,700',
    'about.sample.report.privacyNote': 'Sample data · No personal information',
    'privacy.eyebrow': 'How your information is handled', 'privacy.title': 'Privacy Policy',
    'terms.title': 'Terms of Service', 'legal.lastUpdated': 'Last updated: November 20, 2026',
    'privacy.description': 'Learn what information Hostel Life uses, why it is needed and how long it is retained.',
    'legal.toc.title': 'On this page', 'privacy.intro': 'Hostel Life uses the information needed to operate the service, maintain hostel records and protect accounts. The sections below explain how information is used, who can access it and how long it is retained.',
    'privacy.section.information.title': 'Information we use', 'privacy.section.information.toc': 'Information collected',
    'privacy.section.purpose.title': 'How information is used', 'privacy.section.purpose.toc': 'Use of information',
    'privacy.section.visibility.title': 'Who can see your information', 'privacy.section.visibility.toc': 'Access to information',
    'privacy.section.sharing.title': 'Sharing and connected services', 'privacy.section.sharing.toc': 'Sharing and integrations',
    'privacy.section.security.title': 'Account and information security', 'privacy.section.security.toc': 'Security',
    'privacy.section.retention.title': 'Data retention', 'privacy.section.retention.toc': 'Retention period',
    'privacy.section.control.title': 'Your choices and requests', 'privacy.section.control.toc': 'Your choices',
    'privacy.section.age.title': 'Age requirements and policy updates', 'privacy.section.age.toc': 'Age and updates',
    'privacy.contact.title': 'Need help with your information or account?', 'privacy.contact.description': 'Contact us with questions about your information, account or privacy.',
    'terms.eyebrow': 'Simple rules for using the service', 'terms.title': 'Terms of Service',
    'terms.description': 'Review the rules about accounts, hostel information and other users’ rights before using Hostel Life.',
    'terms.intro': 'Hostel Life helps organise everyday hostel management, meals and account records. These terms focus on providing accurate information, staying within your permissions and respecting other users’ information.',
    'common.copyright.prefix': 'Copyright © ', 'common.copyright.suffix': ' Hostel-Life. All rights reserved.', 'common.credit.prefix': 'Designed & Developed by ',
    'terms.contact.title': 'Questions about these terms or your account?', 'terms.contact.description': 'Contact us for help with the service, your account or any of these rules.',
    'legal.contact.action': 'Contact us ↗', 'common.copyright': 'Copyright © 2026 Hostel-Life. All rights reserved.',
    'about.copy.26b3d0fce4': 'Terms', 'about.copy.2b43d5b58d': 'Privacy Policy',
    'about.copy.3539014022': 'Download app ↓', 'about.copy.3a6ebf18ed': 'Rakibul Islam Samrat',
    'about.copy.7a31e44acc': 'simpler and more organised.', 'about.copy.8eb4692fa0': 'Meal rate',
    'about.copy.9d054cc8cf': 'Terms of Service', 'about.copy.bbfe0f8fd4': 'Contact',
    'about.copy.c5e2f5cbde': 'Privacy', 'about.copy.c954010b41': 'Create an account ↗',
    'about.copy.d7ceca44a3': 'Log in', 'about.copy.da0222b64d': 'Manager tools',
    'about.copy.e769e7322a': 'Today’s meals', 'about.copy.fc486696ad': '↓',
    'about.copy.fe65e16b3b': 'About',
    'about.aria.e79d7a61d1': 'Hostel Life About page', 'about.aria.6d8b0e4619': 'Main navigation',
    'about.aria.faa77e7f6e': 'Account actions', 'about.aria.f33d815f70': 'Open menu',
    'about.aria.45372d8169': 'Mobile navigation', 'about.aria.2e6e642b0c': 'Main tasks',
    'about.aria.7d24268dab': 'Hostel Life app interface preview',
    'about.aria.6363fbae42': 'Dashboard preview: members, today’s meals and daily meal summary',
    'about.aria.55ee1ba77e': 'Dining section preview: meal requests, market entries and deposits',
    'about.aria.b7b79a89ab': 'Meal planning interface preview by day and meal',
    'about.aria.a2eabb0c10': 'Market interface preview showing products, quantities and costs',
    'about.aria.abe358a9ac': 'Member deposit records interface preview',
    'about.aria.a34cf5e263': 'Monthly staff allowance overview interface preview',
    'about.aria.9822312656': 'Manager’s meal request review list interface preview',
    'about.aria.2facb45a45': 'Menu preview for members, reports, archives and manager tools',
    'about.aria.c935d0aa32': 'Monthly summary and member account report preview',
    'about.aria.2ea768efe0': 'Three steps to use Hostel Life', 'about.aria.3eec0c8b85': 'Service scope',
    'about.aria.a48dd68cbe': 'Hostel Life home', 'about.aria.ee53df1e97': 'Helpful links',
    'about.meta.description': 'Hostel Life is a web app for organising daily meals, market expenses, member deposits and monthly accounts in one place.',
    'about.meta.ogTitle': 'Hostel Life — Make everyday hostel management simpler and more organised',
    'about.meta.ogDescription': 'Manage daily meals, market purchases, member deposits and monthly accounts in one place.',
    'about.preview.dashboard': 'Dashboard · Today’s meals',
    'about.closing.title': 'Make everyday hostel management more organised',
    'about.closing.description': 'Manage your hostel’s daily records in one place.',
  };

  const LEGAL_TEXT = {
    'অ্যাকাউন্টের জন্য আপনার নাম, ইমেইল, মোবাইল নম্বর এবং আপনি দিলে প্রোফাইল ছবি ব্যবহার হতে পারে। মেস পরিচালনার জন্য সদস্য তালিকা, ভূমিকা, মিল, বাজার, জমা-খরচ, ব্যালেন্স, হিসাব ইতিহাস, নোটিশ, অনুরোধ, রিপোর্ট এবং সংশ্লিষ্ট ঐতিহাসিক রেকর্ড সংরক্ষিত হয়.': 'For your account, we may use your name, email address, mobile number and profile photo if you provide one. To manage a hostel, we store member lists, roles, meals, market entries, deposits and expenses, balances, account history, notices, requests, reports and related historical records.',
    'অ্যাকাউন্ট সুরক্ষা ও অপব্যবহার প্রতিরোধে লগইন, নিবন্ধন এবং পাসওয়ার্ড পুনরুদ্ধারের চেষ্টায় দেওয়া ইমেইল ঠিকানা, IP address, ঘটনার সময় এবং ব্রাউজার/ডিভাইসের সাধারণ তথ্য নিরাপত্তা রেকর্ড (Security Event) হিসেবে ব্যবহার হতে পারে। IP address থেকে দেশ, শহর বা অঞ্চল নির্ধারণ করে অবস্থান-তথ্য হিসেবে সংরক্ষণ করা হয় না; GPS বা ডিভাইসের সুনির্দিষ্ট অবস্থানও সংগ্রহ করা হয় না.': 'To protect accounts and prevent abuse, an email address, IP address, event time and general browser/device details associated with login, registration and password recovery attempts may be used as security event records. We do not derive or store a country, city or region from an IP address as location data, and we do not collect GPS or precise device location.',
    'অ্যাকাউন্ট ও সদস্যতা পরিচালনা, মিল ও বাজারের হিসাব, জমা-খরচের রেকর্ড, রিপোর্ট, নোটিফিকেশন, সহায়তা এবং অননুমোদিত প্রবেশ বা অপব্যবহার শনাক্ত করতে প্রয়োজনীয় তথ্য ব্যবহার করা হয়। প্রয়োজনের বাইরে ব্যক্তিগত তথ্য সংগ্রহ করা এই সেবার উদ্দেশ্য নয়।': 'Information is used as needed to manage accounts and memberships, meal and market records, deposits and expenses, reports, notifications and support, and to detect unauthorised access or abuse. The service is not intended to collect personal information beyond these needs.',
    'একই মেসের সদস্যরা তাঁদের ভূমিকা ও অনুমতি অনুযায়ী সদস্য তালিকা, মিল, বাজার, জমা-খরচ এবং সংশ্লিষ্ট রেকর্ড দেখতে পারেন। প্রধান ম্যানেজার ও অনুমোদিত সহকারীর দায়িত্ব অনুযায়ী কিছু অতিরিক্ত ব্যবস্থাপনা-সুবিধা থাকতে পারে।': 'Members of the same hostel can view member lists, meals, market entries, deposits, expenses and related records according to their roles and permissions. The main manager and authorised assistants may have additional management capabilities based on their responsibilities.',
    'Hostel Life পরিচালনা, সহায়তা বা নিরাপত্তার প্রয়োজনে অনুমোদিত সীমিত প্রবেশাধিকার ব্যবহার করতে পারে। ব্যক্তিগত তথ্য ও মেসের হিসাব কেবল প্রয়োজনীয় কাজের পরিসরে ব্যবহার করার নীতি অনুসরণ করা হয়।': 'Hostel Life may use limited authorised access when needed to operate, support or secure the service. Personal information and hostel accounts are handled only within the scope required for those purposes.',
    'হোস্টিং, ডেটাবেজ, ইমেইল এবং অ্যাপ সচল রাখার জন্য সংশ্লিষ্ট প্রযুক্তিগত সেবাদাতা প্রয়োজনীয় তথ্য প্রক্রিয়া করতে পারে। এসব সেবাদাতার নিজস্ব গোপনীয়তা ও তথ্য সংরক্ষণ নীতিও প্রযোজ্য হতে পারে। ব্যবহারকারীর তথ্য বিক্রি বা ভাড়া দেওয়া হয় না।': 'Technical providers may process the information needed for hosting, database, email and app operations. Their own privacy and retention policies may also apply. We do not sell or rent user information.',
    'ঐচ্ছিক টেলিগ্রাম সংযোগ চালু করলে আপনার Telegram username ও টেলিগ্রাম চ্যাট আইডি সংযোগ পরিচালনা ও বিজ্ঞপ্তি পাঠানোর জন্য ব্যবহার হতে পারে। বিজ্ঞপ্তির শিরোনাম ও বার্তার লেখা সংযুক্ত টেলিগ্রাম অ্যাকাউন্টে পাঠানো হয়। সংযোগটি যেকোনো সময় বিচ্ছিন্ন করতে পারবেন; বিচ্ছিন্ন করলে নতুন বিজ্ঞপ্তি পাঠানো বন্ধ হবে। Google Sign-In সংযুক্ত নেই; Google অ্যাকাউন্টের তথ্য সংগ্রহ বা ব্যবহার করা হয় না। ভবিষ্যতে Google Sign-In চালু হলে তার আগে এই নীতি হালনাগাদ করা হবে.': 'If you enable the optional Telegram connection, your Telegram username and chat ID may be used to manage the connection and send notifications. Notification titles and message text are sent to the linked Telegram account. You can disconnect at any time; new notifications will stop after disconnection. Google Sign-In is not connected, and Google account information is not collected or used. This policy will be updated before Google Sign-In is introduced in the future.',
    'লগইন, নিবন্ধন ও পাসওয়ার্ড পুনরুদ্ধারের চেষ্টা নিরাপদ রাখতে প্রয়োজনীয় নিরাপত্তা-সংক্রান্ত তথ্য ব্যবহার হতে পারে। নিরাপত্তা রেকর্ডে Password, OTP code বা পূর্ণ পাসওয়ার্ড সংরক্ষণ করা হয় না। আপনার পাসওয়ার্ড বা ইমেইল যাচাইকরণ কোড (OTP) কাউকে দেবেন না এবং সহায়তা চাওয়ার সময়ও এগুলো পাঠাবেন না.': 'Security-related information may be used to protect login, registration and password recovery attempts. Security records do not store passwords, OTP codes or full passwords. Never share your password or email verification code (OTP), including when requesting support.',
    'নিজের পাসওয়ার্ড, OTP এবং ব্যক্তিগত আমন্ত্রণ কোড গোপন রাখুন। শেয়ার করা ডিভাইস থেকে কাজ শেষে লগআউট করুন। ইন্টারনেটভিত্তিক কোনো সেবাই শতভাগ ঝুঁকিমুক্ত নয়; সন্দেহজনক কার্যক্রম দেখলে আমাদের সঙ্গে যোগাযোগ করুন।': 'Keep your password, OTP and personal invitation code confidential. Sign out after using a shared device. No internet service is completely risk-free; contact us if you notice suspicious activity.',
    'নিরাপত্তা ও লগইন-সংক্রান্ত রেকর্ড নির্ধারিত মেয়াদ শেষে পরিষ্কার করা হয়। অ্যাপের সেশন তথ্যে থাকা IP address ও ব্রাউজার/ডিভাইস-সংক্রান্ত তথ্য ৩০ দিনের মেয়াদ পূর্ণ হলে নির্ধারিত দৈনিক নিরাপত্তা cleanup-এ মুছে ফেলা হয়। পাসওয়ার্ড পুনরুদ্ধার-সংক্রান্ত IP প্রচেষ্টার তথ্য সর্বোচ্চ ৪৮ ঘণ্টা এবং অপব্যবহার প্রতিরোধে ব্যবহৃত কিছু সীমিত অনুরোধ-রেকর্ড সর্বোচ্চ ৩৫ দিন পর্যন্ত থাকতে পারে। কোনো নিরাপত্তা সীমাবদ্ধতা সক্রিয় থাকলে তা কার্যকর থাকা পর্যন্ত সংশ্লিষ্ট তথ্য রাখা হয়; মেয়াদ শেষ হলে সেই সীমাবদ্ধতার রেকর্ড পরিষ্কার করা হয়। প্রশাসনিক নিরীক্ষা-রেকর্ড প্রয়োজন অনুযায়ী আলাদা সংরক্ষণ ব্যবস্থায় রাখা হয়.': 'Security and login records are cleared according to their retention periods. IP and general browser/device details in app-session records are removed by the scheduled daily security cleanup after 30 days. IP details for password-recovery attempts may be kept for up to 48 hours, while certain limited abuse-prevention request records may remain for up to 35 days. Records related to an active security restriction are retained while that restriction remains in effect and are cleared when it expires. Administrative audit records are retained separately as needed.',
    'অ্যাকাউন্ট, সদস্য তালিকা, ব্যালেন্স, বাজার-জমা-খরচের হিসাব, হিসাব ইতিহাস ও আর্কাইভের ঐতিহাসিক রেকর্ড নিরাপত্তা লগের মতো একই ৩০ দিনের নিয়মে মুছে যায় না। এগুলো সেবার কার্যক্রম, সংশ্লিষ্ট মেসের প্রয়োজন এবং প্রযোজ্য সংরক্ষণ নীতি অনুযায়ী রাখা হয়। হোস্টিং ও প্রমাণীকরণ সেবাদাতার নিজস্ব নীতিতে থাকা তথ্য তাদের নীতি অনুযায়ী সংরক্ষিত হতে পারে.': 'Accounts, member lists, balances, market/deposit/expense records, account history and archived historical records are not deleted under the same 30-day rule as security logs. They are retained according to service operations, the needs of the relevant hostel and applicable retention policies. Information held by hosting and authentication providers may be retained under their own policies.',
    'নিজের তথ্য সংশোধন বা মুছে ফেলার অনুরোধ জানাতে Hostel Life Support-এর সঙ্গে যোগাযোগ করুন। মিল, বাজার বা আর্থিক হিসাব যৌথ রেকর্ড হতে পারে; কোনো তথ্য মুছে ফেললে অন্য সদস্যের হিসাবেও প্রভাব পড়তে পারে। তাই অনুরোধ যাচাই করে এবং সংশ্লিষ্ট রেকর্ডের প্রয়োজন বিবেচনা করে ব্যবস্থা নেওয়া হয়।': 'Contact Hostel Life Support to request correction or deletion of your information. Meal, market and financial records may be shared records; deleting information could affect other members’ accounts. Requests are reviewed in light of the relevant record requirements before action is taken.',
    'বর্তমানে অ্যাকাউন্ট তৈরি করতে বয়স কমপক্ষে ১৮ বছর হতে হবে। সেবার ফিচার, সংযুক্ত সেবা বা তথ্য ব্যবহারের নিয়মে গুরুত্বপূর্ণ পরিবর্তন হলে এই নীতি হালনাগাদ করা হবে। হালনাগাদের তারিখ এই পাতায় উল্লেখ থাকবে।': 'You must be at least 18 years old to create an account. This policy will be updated if there are significant changes to service features, connected services or information practices. The update date will be shown on this page.',
    'আপনার তথ্য, অ্যাকাউন্ট বা গোপনীয়তা-সংক্রান্ত প্রশ্নের জন্য আমাদের সঙ্গে যোগাযোগ করুন।': 'Contact us with questions about your information, account or privacy.',
    'Hostel Life মেসের সদস্য, মিল, বাজার, জমা-খরচ, নোটিশ এবং সংশ্লিষ্ট হিসাবের রেকর্ড গুছিয়ে রাখতে সহায়তা করে। এটি হিসাব ব্যবস্থাপনার মাধ্যম; অ্যাপটি নিজে পেমেন্ট গেটওয়ে নয় এবং সরাসরি টাকা গ্রহণ বা স্থানান্তর করে না।': 'Hostel Life helps organise hostel membership, meals, market entries, deposits, expenses, notices and related account records. It is an account-management tool; the app is not a payment gateway and does not directly receive or transfer money.',
    'বর্তমানে অ্যাকাউন্ট তৈরি ও ব্যবহার করতে বয়স কমপক্ষে ১৮ বছর হতে হবে। নিবন্ধনের সময় সঠিক ও নিজের তথ্য দিন এবং বয়স-যোগ্যতা পূরণ না হলে অ্যাকাউন্ট তৈরি করবেন না।': 'You must be at least 18 years old to create and use an account. Provide accurate information about yourself when registering, and do not create an account if you do not meet the age requirement.',
    'নিজের অ্যাকাউন্ট, পাসওয়ার্ড ও OTP গোপন রাখুন। অন্যের অ্যাকাউন্ট অনুমতি ছাড়া ব্যবহার করবেন না; ভুয়া অ্যাকাউন্ট তৈরি বা অন্যের পরিচয় ব্যবহার করা যাবে না। ব্যক্তিগত আমন্ত্রণের Join Code ও Invitation Link সুরক্ষিত রাখুন। ব্যক্তিগত Join Code ও Invitation Link কেবল যাঁদের মেসে যুক্ত হওয়া প্রয়োজন তাঁদের সঙ্গে ব্যক্তিগতভাবে ভাগ করুন; প্রকাশ্যে দেবেন না। ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়.': 'Keep your account, password and OTP confidential. Do not access another person’s account without permission, create a fake account or use another person’s identity. Protect personal Join Codes and Invitation Links. Share them privately only with people who need to join your hostel; do not publish them. The general website address and Hostel Life About page may be shared publicly.',
    'এই অ্যাপে Google Sign-In নেই; Google অ্যাকাউন্টের তথ্য সংগ্রহ বা ব্যবহার করা হয় না। ভবিষ্যতে Google বা অন্য কোনো তৃতীয় পক্ষের Sign-In সুবিধা চালু হলে, সেটি ব্যবহারের সময় সংশ্লিষ্ট প্রদানকারীর শর্তও প্রযোজ্য হবে এবং চালুর আগে গোপনীয়তা নীতি হালনাগাদ করা হবে.': 'Google Sign-In is not available in this app, and Google account information is not collected or used. If Google or another third-party sign-in option is introduced in the future, the provider’s terms will also apply and the Privacy Policy will be updated before launch.',
    'সাধারণ সদস্য, সহকারী ম্যানেজার ও প্রধান ম্যানেজারের ক্ষমতা আলাদা। নিজের অনুমতির বাইরে কোনো রেকর্ড দেখা, পরিবর্তন, মুছে ফেলা বা অন্যকে অনুমতি দেওয়ার চেষ্টা করা যাবে না। সম্পাদনার ক্ষমতা সংশ্লিষ্ট ভূমিকা ও সার্ভার-যাচাইকৃত অনুমতির মধ্যে সীমিত।': 'Members, assistant managers and primary managers have different permissions. Do not view, change or delete records, or grant access to others, beyond your permissions. Editing capabilities are limited by the assigned role and server-verified permissions.',
    'মিলের অনুরোধ সময়মতো দিন এবং Late Request বা Correction-এর ক্ষেত্রে অনুমোদন ও সময়সীমা মেনে চলুন। বাজার, জমা ও খরচের তথ্য বাস্তব অনুযায়ী লিখুন। ভুয়া এন্ট্রি, প্রতারণা, হয়রানি, অননুমোদিত প্রবেশ, অন্যের তথ্যের অপব্যবহার বা সেবা ব্যাহত করা নিষিদ্ধ।': 'Submit meal requests on time and follow the approval process and deadlines for late requests or corrections. Enter accurate market, deposit and expense information. Fake entries, fraud, harassment, unauthorised access, misuse of another person’s information and disruption of the service are prohibited.',
    'অ্যাপের হিসাব ব্যবহারকারীদের দেওয়া তথ্যের ভিত্তিতে তৈরি হয়। গুরুত্বপূর্ণ এন্ট্রি ও রিপোর্ট যাচাই করুন। ভুল রেকর্ড হলে অনুমোদিত সংশোধন-পদ্ধতি অনুসরণ করুন। বন্ধ মাসের রেকর্ডে পরিবর্তন কেবল অনুমোদিত ব্যক্তি করতে পারবেন। গুরুত্বপূর্ণ হিসাবের প্রয়োজনীয় কপি নিজের কাছে রাখুন।': 'App accounts are based on information entered by users. Review important entries and reports. Use the approved correction process if a record is wrong. Only authorised people may change records in a closed month. Keep your own copies of important account information.',
    'ঐচ্ছিক টেলিগ্রাম সংযোগ ব্যবহার করলে সংযুক্ত Telegram account-এর username ও টেলিগ্রাম চ্যাট আইডি সংযোগ পরিচালনা এবং বিজ্ঞপ্তি পাঠানোর জন্য ব্যবহার হতে পারে। বিজ্ঞপ্তির শিরোনাম ও বার্তার লেখা সংযুক্ত টেলিগ্রাম অ্যাকাউন্টে পাঠানো হয়; সংযোগ যেকোনো সময় বিচ্ছিন্ন করা যাবে। এই অ্যাপে Google Sign-In নেই; ভবিষ্যতে চালু হলে ব্যবহারকারীকে সেই Sign-In পদ্ধতি বেছে নেওয়ার আগে জানানো হবে এবং Google-এর নিজস্ব শর্তও প্রযোজ্য হবে.': 'If you use the optional Telegram connection, the linked Telegram account username and chat ID may be used to manage the connection and send notifications. Notification titles and message text are sent to the linked Telegram account; you can disconnect at any time. Google Sign-In is not currently available. If it is introduced, users will be informed before choosing that sign-in method, and Google’s own terms will apply.',
    'নেটওয়ার্ক, ডিভাইস বা রক্ষণাবেক্ষণের কারণে কিছু ফিচার সাময়িকভাবে ব্যাহত হতে পারে। অফলাইনে দেখা তথ্য সর্বশেষ সংরক্ষিত কপি হতে পারে; ইন্টারনেট ছাড়া সব পরিবর্তন জমা হয়েছে ধরে নেবেন না। সেবার কার্যপ্রণালি বা শর্তাবলী পরিবর্তিত হলে হালনাগাদ সংস্করণ প্রকাশ করা হবে।': 'Some features may be temporarily unavailable because of network, device or maintenance issues. Offline information may be the most recently saved copy; do not assume that changes have been submitted without an internet connection. Updated terms will be published when the service or its terms change.',
    'সেবা ব্যবহার, অ্যাকাউন্ট বা কোনো নিয়ম সম্পর্কে সহায়তার জন্য আমাদের সঙ্গে যোগাযোগ করুন।': 'Contact us for help with the service, your account or any of these terms.',
  };

  const MORE_EN = {
    'বাতিল': 'Cancel', 'আগের': 'Previous', 'পরের': 'Next', 'বিবরণ': 'Description', 'টাকার পরিমাণ': 'Amount', 'ডিফল্ট মিল': 'Default meals',
    'সব দিনে প্রয়োগ করুন': 'Apply to all days', 'ম্যানেজার ফিচার': 'Manager feature', 'অ্যাপ ইনস্টল করুন': 'Install app', 'পরে দেখব': 'Maybe later',
    'এখনো মাস শুরু হয়নি': 'The month has not started yet', 'ইন্টারনেট সংযোগ নেই — সর্বশেষ সংরক্ষিত ড্যাশবোর্ড, মিল ও লেট রিকোয়েস্ট দেখা যাবে।': 'You are offline. The latest saved dashboard, meals and late requests are available.',
    'মেসের ম্যানেজারের বার্তা': 'Message from the hostel manager', 'লাইট': 'Light', 'সিস্টেম': 'System', 'ডার্ক': 'Dark', 'আকাশি': 'Sky',
    'মোবাইলে Hostel Life ব্যবহার আরও সহজ করুন': 'Make Hostel Life easier to use on your phone', 'হোম স্ক্রিনে অ্যাপটি যোগ করলে এক ট্যাপেই খুলতে পারবেন। বারবার ব্রাউজারে খুঁজতে হবে না।': 'Add the app to your home screen to open it with one tap instead of searching for it in your browser.',
    'টেলিগ্রাম সংযোগ করুন': 'Connect Telegram', 'গুরুত্বপূর্ণ আপডেট সরাসরি পেতে একবার সংযোগ করুন। এটি ঐচ্ছিক।': 'Connect once to receive important updates directly. This is optional.',
    'মেসের নোটিশ টেলিগ্রামে পান': 'Receive hostel notices on Telegram', 'এখনই রিফ্রেশ করুন': 'Refresh now', 'আপডেটের বিস্তারিত': 'Update details',
    'ইতিমধ্যে অ্যাকাউন্ট আছে?': 'Already have an account?', 'এখনো অ্যাকাউন্ট নেই?': 'Don’t have an account yet?', 'লগইন করুন': 'Sign in', 'রেজিস্ট্রেশন করুন': 'Create account',
    'ইমেইল যাচাই': 'Email verification', 'ভেরিফিকেশন কোড পাঠানো হয়েছে': 'Verification code sent', '৬ সংখ্যার কোড': '6-digit code', 'ছয় সংখ্যার ভেরিফিকেশন কোড': '6-digit verification code',
    'যাচাই হচ্ছে...': 'Verifying...', 'ইমেইল যাচাই করুন': 'Verify email', 'কোড আবার পাঠান': 'Resend code', 'রেজিস্ট্রেশনে ফিরে যান': 'Back to registration',
    'Inbox-এ না পেলে Spam/Junk বা Promotions দেখুন।': 'Check your Spam/Junk or Promotions folder if it is not in your inbox.',
    'ইনবক্সে না পেলে Spam/Junk বা Promotions দেখুন।': 'Check your Spam/Junk or Promotions folder if it is not in your inbox.',
    'অনুমতি কোড': 'Access code', 'নতুন অ্যাকাউন্ট খোলার অনুমতি যাচাই করতে কোডটি লাগবে।': 'This code is required to verify permission to create a new account.',
    'আমি নিশ্চিত করছি, আমার বয়স কমপক্ষে ১৮ বছর এবং ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতি মেনে নিচ্ছি।': 'I confirm that I am at least 18 years old and agree to the Terms of Service and Privacy Policy.',
    'পাসওয়ার্ড ভুলে গেছেন?': 'Forgot password?', 'পাসওয়ার্ড পুনরুদ্ধার': 'Password recovery', 'পাসওয়ার্ড রিসেটের নিয়ম': 'Password reset limits',
    'ইমেইলে পাসওয়ার্ড পরিবর্তনের লিংক পাঠানো হবে।': 'A password reset link will be sent to your email.',
    'পাসওয়ার্ড রিসেট করতে ইন্টারনেট সংযোগ প্রয়োজন।': 'An internet connection is required to reset your password.',
    'নিরাপত্তার জন্য একটি ইমেইল থেকে দিনে সর্বোচ্চ ২ বার এবং প্রতি ক্যালেন্ডার মাসে সর্বোচ্চ ৫ বার রিসেটের অনুরোধ করা যাবে।': 'For security, each email address can request up to 2 resets per day and 5 resets per calendar month.',
    'মাসিক সীমা পূর্ণ হলে Help Section থেকে Hostel Life Support এ যোগাযোগ করুন। পরিচয় যাচাইয়ের পর Admin প্রয়োজনে Temporary Password দেবেন। সেটি দিয়ে লগইন করে বাধ্যতামূলকভাবে নতুন পাসওয়ার্ড তৈরি করতে হবে।': 'If the monthly limit is reached, contact Hostel Life Support from the Help section. After identity verification, an administrator may provide a temporary password. Sign in with it and create a new password when prompted.',
    'নাম কমপক্ষে ২ অক্ষরের হতে হবে।': 'Name must contain at least 2 characters.', 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।': 'The new password must contain at least 8 characters.',
    'সঠিক মোবাইল নম্বর দিন (৮–১৫টি সংখ্যা)।': 'Enter a valid mobile number (8–15 digits).', 'দুইটি পাসওয়ার্ড একই নয়।': 'The passwords do not match.',
    'এই ইমেইলে Hostel Life অ্যাকাউন্ট থাকলে, রিসেট নির্দেশনা পাঠানো হলে ইনবক্স দেখুন।': 'If a Hostel Life account exists for this email, check your inbox for reset instructions.',
    'অ্যাকাউন্টে প্রবেশ করুন': 'Sign in', 'আপনার অ্যাকাউন্টে প্রবেশ করুন': 'Sign in to your account', 'একটি অ্যাকাউন্ট তৈরি করুন': 'Create an account',
    'নিরাপদ অ্যাকাউন্ট': 'Secure account', 'অ্যাকাউন্ট সেটআপ': 'Account setup', 'নতুন যাত্রা শুরু হোক': 'Let’s get started', 'আবারও স্বাগতম': 'Welcome back',
    'আপনার ইমেইল ও পাসওয়ার্ড দিয়ে নিরাপদে প্রবেশ করুন।': 'Sign in securely with your email and password.', 'নাম, মোবাইল ও ইমেইল দিয়ে অ্যাকাউন্ট তৈরি করুন।': 'Create an account with your name, mobile number and email.',
    'আপনার নাম': 'Your name', 'আপনার ইমেইল': 'Your email', 'আপনার মোবাইল নম্বর': 'Your mobile number', 'সঠিক ইমেইল ব্যবহার করুন': 'Use a valid email address',
    'পাসওয়ার্ড আবার দিন': 'Confirm password', 'কমপক্ষে ৮ অক্ষর': 'At least 8 characters', 'একই পাসওয়ার্ড আবার': 'Enter the same password again',
    'লগইন হচ্ছে...': 'Signing in...', 'রেজিস্ট্রেশন হচ্ছে...': 'Creating account...', 'অ্যাকাউন্ট তৈরি হয়েছে। এখন মেসে যুক্ত হন।': 'Account created. Join a hostel to continue.',
    'সফলভাবে লগইন হয়েছে।': 'Signed in successfully.', 'রেজিস্ট্রেশন করা যায়নি। আবার চেষ্টা করুন।': 'Registration failed. Please try again.',
    'সঠিক ইমেইল ব্যবহার করুন': 'Use a valid email address', 'নিরাপত্তার কারণে ইমেইল পরিবর্তন করা যাবে না।': 'Email cannot be changed for security reasons.',
    'অ্যাকাউন্ট': 'Account', 'ব্যক্তিগত তথ্য': 'Personal information', 'নিরাপত্তা': 'Security', 'সদস্যতা': 'Membership', 'মেসের তথ্য': 'Hostel information',
    'আমার ভূমিকা': 'My role', 'যুক্ত হওয়ার সময়': 'Joined on', 'অভিজ্ঞতা': 'Experience', 'থিম পছন্দ': 'Theme preference', 'হোস্টেল লাইফ সাপোর্ট': 'Hostel Life Support',
    'ছবির ফরম্যাট: JPG, PNG, WEBP': 'Image formats: JPG, PNG, WEBP', 'প্রোফাইল ছবি পরিবর্তন': 'Change profile photo', 'পরিবর্তন সংরক্ষণ': 'Save changes',
    'নাম': 'Name', 'মোবাইল নম্বর': 'Mobile number', 'ইমেইল': 'Email', 'পাসওয়ার্ড': 'Password', 'বর্তমান পাসওয়ার্ড': 'Current password', 'নতুন পাসওয়ার্ড': 'New password', 'নতুন পাসওয়ার্ড আবার': 'Confirm new password',
    'ঐচ্ছিক': 'Optional', 'যোগ করা হয়নি': 'Not added', 'বন্ধ করুন': 'Close', 'এডিট': 'Edit', 'পরিবর্তন': 'Change', 'পরিবর্তন করুন': 'Change',
    'ফিরে যান': 'Go back', 'পরে': 'Later', 'আবার চেষ্টা করুন': 'Try again', 'রিফ্রেশ': 'Refresh', 'আবার লোড করুন': 'Reload', 'তালিকা রিফ্রেশ': 'Refresh list', 'বুঝেছি': 'Got it',
    'ড্যাশবোর্ড': 'Dashboard', 'ডাইনিং': 'Dining', 'হিস্টরি': 'History', 'প্রোফাইল': 'Profile', 'মিল শিট': 'Meal sheet', 'বন্ধ মাসসমূহ': 'Closed months',
    'রিপোর্ট ডাউনলোড': 'Download reports', 'সকল সদস্য': 'All members', 'খালার টাকা': 'Staff allowance', 'শীর্ষ খাদক': 'Top meal consumers', 'বেশি বাজারকারী': 'Top buyers', 'বেশি ডিপোজিটকারী': 'Top depositors',
    'গোপনীয়তা ও নীতিমালা': 'Privacy & policies', 'ব্যবহারের শর্তাবলী': 'Terms of Service', 'কীভাবে ব্যবহার করব': 'How to use', 'অ্যাপ ডাউনলোড': 'Download app', 'টেলিগ্রাম সংযোগ': 'Telegram connection', 'হেল্প': 'Help',
    'বর্তমান মাস শেষ করুন': 'Close current month', 'নতুন মাস শুরু': 'Start new month', 'ম্যানেজার পরিবর্তন': 'Change manager', 'সহকারী ম্যানেজার': 'Assistant manager', 'মেস সেটিংস': 'Hostel settings', 'মেস নোটিশ': 'Hostel notice',
    'জয়েন রিকোয়েস্ট পর্যালোচনা': 'Review join requests', 'সদস্য ব্যবস্থাপনা': 'Member management', 'ডাইনিং ব্যবস্থাপনা': 'Dining management', 'মেনু বন্ধ করুন': 'Close menu',
    'ম্যানেজার ফিচার': 'Manager feature', 'সিস্টেম তথ্য': 'System information', 'লগআউট': 'Sign out', 'হিসাব ও সদস্য': 'Accounts & members',
    'আজকের মিল': 'Today’s meals', 'আগামী ৭ দিন': 'Next 7 days', 'আগামী সাত দিনের মিল': 'Meals for the next seven days', 'লেট অনুরোধ': 'Late requests', 'মিল অনুরোধ': 'Meal requests',
    'ব্রেকফাস্ট': 'Breakfast', 'লাঞ্চ': 'Lunch', 'ডিনার': 'Dinner', 'সকালের মিল': 'Breakfast', 'দুপুরের মিল': 'Lunch', 'রাতের মিল': 'Dinner', 'মোট মিল': 'Total meals', 'মোট': 'Total',
    'মোট বাজার': 'Total market expenses', 'বাজার': 'Market', 'বাজার এন্ট্রি': 'Market entry', 'বাজারকারী': 'Buyer', 'আইটেম': 'Item', 'পণ্যের নাম': 'Product name', 'পরিমাণ': 'Quantity',
    'জমা': 'Deposit', 'মোট জমা': 'Total deposits', 'নগদ ডিপোজিট': 'Cash deposit', 'বাজার ক্রেডিট': 'Market credit', 'খরচ': 'Expense', 'মিল খরচ': 'Meal cost', 'অন্যান্য খরচ': 'Other expenses',
    'মিল রেট': 'Meal rate', 'সর্বমোট': 'Grand total', 'অবশিষ্ট ফান্ড': 'Remaining fund', 'মেসের অবশিষ্ট': 'Hostel balance', 'বিবরণ': 'Description', 'তারিখ': 'Date', 'শুরুর তারিখ': 'Start date', 'শেষের তারিখ': 'End date', 'শেষ তারিখ': 'End date',
    'অবস্থা': 'Status', 'সক্রিয়': 'Active', 'নিষ্ক্রিয়': 'Inactive', 'অপেক্ষমাণ': 'Pending', 'অনুমোদিত': 'Approved', 'অনুমোদিত হয়নি': 'Not approved', 'বাতিল': 'Cancelled', 'সংশোধন': 'Correction', 'আপডেটেড': 'Updated',
    'চলমান মাস': 'Current month', 'কাজের মাস': 'Active month', 'সংরক্ষিত মাস': 'Saved month', 'মাসের অবস্থা': 'Month status', 'মাসিক হিসাব': 'Monthly accounts', 'মাসিক প্রতিবেদন': 'Monthly report', 'রিপোর্ট': 'Reports', 'PDF / প্রিন্ট': 'PDF / Print',
    'নোটিশ': 'Notice', 'বার্তা': 'Message', 'শিরোনাম': 'Title', 'ম্যানেজারের বার্তা': 'Manager message', 'প্রকাশ করুন': 'Publish', 'প্রকাশিত': 'Published',
    'সদস্য নির্বাচন করুন': 'Select member', 'সব সদস্য': 'All members', 'সদস্যের নাম': 'Member name', 'বাজারকারী': 'Buyer', 'লেনদেন': 'Transaction', 'লেনদেনের ইতিহাস': 'Transaction history', 'হিসাব ইতিহাস': 'Account history',
    'সংযুক্ত ব্যবহারকারী': 'Connected user', 'সংযোগ যাচাই': 'Verify connection', 'সংযোগ বিচ্ছিন্ন': 'Disconnect', 'সংযোগ লিংক তৈরি করুন': 'Create connection link', 'টেলিগ্রাম বট': 'Telegram bot',
    'আমন্ত্রণ যাচাই হচ্ছে': 'Verifying invitation', 'সদস্য আমন্ত্রণ': 'Member invitation', 'মেসে যোগ দিন': 'Join a hostel', 'অনুরোধ অপেক্ষমাণ': 'Request pending', 'অনুরোধ অনুমোদিত': 'Request approved', 'অনুরোধ অনুমোদিত হয়নি': 'Request not approved',
    'যোগদানের কোড': 'Join code', 'যুক্ত হওয়ার কোড': 'Join code', 'কোড দিয়ে মেসে যুক্ত হন': 'Join a hostel with a code', 'নতুন মেস তৈরি করুন': 'Create a new hostel', 'মেসের নাম দিন': 'Enter hostel name', 'মেসের নাম': 'Hostel name',
    'সাধারণ অনুরোধ': 'Regular request', 'ম্যানেজার সংশোধন': 'Manager correction', 'এডমিন এন্ট্রি': 'Admin entry', 'ম্যানুয়াল মিল অনুরোধ': 'Manual meal request', 'ডাইনিংয়ে ফিরে যান': 'Back to dining',
    'সময়': 'Time', 'সময়': 'Time', 'রাত ১০টা': '10:00 PM', 'রাত ৯টা': '9:00 PM', 'রাত ৮টার পর': 'After 8:00 PM', '৭ দিন': '7 days', '৩০ দিন': '30 days', '১৫ মিনিট': '15 minutes', '১ ঘণ্টা': '1 hour', '৬ ঘণ্টা': '6 hours', '২৪ ঘণ্টা': '24 hours',
    'কারণ': 'Reason', 'টাকার পরিমাণ': 'Amount', 'পরিমাণ': 'Amount', 'ধরন': 'Type', 'সব': 'All', 'সব কাজ': 'All actions', 'আগের পৃষ্ঠায় যান': 'Go to previous page', 'লগইনে যান': 'Go to sign in',
    'Super Admin প্রবেশাধিকার যাচাই': 'Verify Super Admin access', 'সিস্টেম কন্ট্রোল': 'System controls', 'পর্যবেক্ষণ ও পরিচালনা': 'Monitoring & operations', 'সিস্টেম সেটিংস': 'System settings', 'এক নজরে প্ল্যাটফর্ম': 'Platform overview',
    'Activity Log ও Security Monitoring': 'Activity log & security monitoring', 'Audit Log খুলুন': 'Open audit log', 'কার্যক্রম': 'Activity', 'সব কার্যক্রম': 'All activity', 'কাজের ধরন': 'Action type', 'লক্ষ্যের ধরন': 'Target type',
    'ডাটাবেজের বর্তমান ব্যবহার': 'Current database usage', 'রিফ্রেশ করে আবার চেষ্টা করুন।': 'Refresh and try again.', 'কোনো কার্যক্রম পাওয়া যায়নি': 'No activity found', 'ফিল্টার মুছুন': 'Clear filters',
    'CSV ডাউনলোড': 'Download CSV', 'JSON ডাউনলোড': 'Download JSON', 'ব্যাকআপ তৈরি করুন': 'Create backup', 'Integrity যাচাই করুন': 'Verify integrity', 'Dry Run করুন': 'Run a dry run',
    'সংরক্ষিত হিসাব': 'Saved accounts', 'বিস্তারিত রিপোর্ট': 'Detailed report', 'মাসিক সারসংক্ষেপ': 'Monthly summary', 'অগ্রাধিকার তালিকা': 'Priority list', 'রেকর্ড সংরক্ষণের জন্য প্রস্তুত': 'Ready to save records',
    'কোনো তথ্য পাওয়া যায়নি': 'No information found', 'কোনো মিল পাওয়া যায়নি।': 'No meals found.', 'কোনো সদস্য পাওয়া যায়নি': 'No members found', 'কোনো নোটিফিকেশন নেই': 'No notifications',
    'বাংলাদেশ সময় · UTC+06:00': 'Bangladesh time · UTC+06:00', 'সর্বশেষ আপডেট': 'Last updated', 'শেষ সিঙ্ক': 'Last sync', 'এখন': 'Now', 'সাবমিট': 'Submitted', 'অনুসন্ধান মুছুন': 'Clear search',
    'অ্যাকাউন্ট স্ট্যাটাস': 'Account status', 'আপনার সদস্যতা বর্তমানে নিষ্ক্রিয়': 'Your membership is currently inactive', 'সংযোগ ও সেশন': 'Connections & sessions', 'ওয়েবসাইট সরাসরি খুলুন': 'Open website directly', 'পেজ রিলোড করুন': 'Reload page',
    'ভাষা': 'Language', 'অ্যাপের সব মেনু, পৃষ্ঠা ও নির্দেশনার ভাষা নির্বাচন করুন।': 'Choose the language for app menus, pages and guidance.', 'ভাষা নির্বাচন': 'Choose language', 'ভাষা সংরক্ষণ হয়েছে।': 'Language preference saved.',
    'Google sign-in-এর আগে ১৮+ বয়স ও নীতিমালায় সম্মতি নিশ্চিত করুন।': 'Before signing in with Google, confirm that you are 18 or older and accept the applicable policies.',
    'Google sign-in সম্পন্ন হয়েছে, কিন্তু profile প্রস্তুত করা যায়নি। আবার চেষ্টা করুন।': 'Google sign-in was completed, but your profile could not be prepared. Please try again.',
    'আজ রাত ১০টার স্বাভাবিক cutoff শেষ হয়েছে। আজকের মিলের জন্য লেট অনুরোধ দিন; সেটি ম্যানেজারের অনুমোদনসাপেক্ষ।': 'The regular 10:00 PM cutoff has passed. Submit a late request for today’s meal; manager approval is required.',
    'এই নামে কোনো সদস্য মেলেনি। অন্য নাম লিখুন অথবা সার্চ মুছে দিন।': 'No member was found with this name. Try another name or clear the search.',
    'নামের বানান পরিবর্তন করুন অথবা সার্চ মুছে সব সদস্য দেখুন।': 'Check the spelling or clear the search to see all members.',
    'থেকে': 'from', 'পর্যন্ত': 'until', 'পরিশোধিত অর্থ': 'Amount paid',
    'নোটিশটি সদস্যদের অ্যাপ ও ইনবক্সে দেখাবে।': 'The notice will appear in members’ app and inbox.',
    'টি মেস নির্বাচিত': 'hostels selected',
    'একসাথে সর্বোচ্চ ২৫টি মেস বেছে স্থায়ীভাবে মুছতে পারবেন। নির্বাচন পৃষ্ঠা বদলালেও থাকবে।': 'You can permanently delete up to 25 hostels at once. Your selection will be retained when you change pages.',
    'এই পাতার সব নির্বাচন': 'Select all on this page', 'নির্বাচন বাতিল': 'Clear selection', 'নির্বাচিত মেস মুছুন': 'Delete selected hostels',
    'এই পরিবর্তন ফেরানো যাবে না। আগে ডেটাবেজ backup নিশ্চিত করুন।': 'This change cannot be undone. Confirm that you have a database backup first.',
    'বিষয়ভিত্তিক প্রশ্নোত্তর': 'Topic-based help', 'যে বিষয়ে জানতে চান সেটি খুলুন': 'Choose a topic to explore', 'সময় মনে রাখুন': 'Keep these times in mind',
    'অ্যাকাউন্ট থেকে মাসিক হিসাব—সহজ তিন ধাপে': 'From account setup to monthly accounts in three simple steps', 'দৈনন্দিন কাজ': 'Daily activity', 'আজকের সারসংক্ষেপ': 'Today’s summary',
    'সদস্য · আর্কাইভ · ম্যানেজার টুলস': 'Members · Archive · Manager tools', 'ব্যবস্থাপনা মেনু · নমুনা UI': 'Management menu · UI preview', 'মাসিক প্রতিবেদন · নমুনা UI': 'Monthly report · UI preview',
    'সদস্যের জমা': 'Member deposit', 'সদস্যদের জমা': 'Member deposits', 'মিল পরিকল্পনা': 'Meal planning', 'ডিপোজিট': 'Deposit', 'ডিপোজিট · জমা সংরক্ষণ': 'Deposit · Save deposit',
    'অথবা': 'or', 'মেস সেটআপ': 'Hostel setup', '২০ নভেম্বর ২০২৬': 'November 20, 2026',
    'Google দিয়ে চালিয়ে যান': 'Continue with Google', 'Google-এ সংযোগ হচ্ছে…': 'Connecting to Google…',
    'আবার Google দিয়ে চেষ্টা করুন': 'Try Google again', 'Google থেকে পরিচয় যাচাইয়ের তথ্য পাওয়া যায়নি। আবার চেষ্টা করুন।': 'Google did not provide verified identity information. Please try again.',
    'ইন্টারনেট, Google Client ID এবং অনুমোদিত website origin পরীক্ষা করে আবার চেষ্টা করুন।': 'Check your internet connection, Google Client ID and authorised website origin, then try again.',
    'Google দিয়ে প্রবেশ করা যায়নি।': 'Could not sign in with Google.', 'Google দিয়ে রেজিস্ট্রেশন করা যায়নি।': 'Could not create an account with Google.',
    'Google Identity Services লোড হয়েছে, কিন্তু button API পাওয়া যায়নি।': 'Google Identity Services loaded, but the button API is unavailable.',
    'Google sign-in service লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।': 'Could not load the Google sign-in service. Check your internet connection.',
    'Google sign-in button প্রস্তুত করা যায়নি।': 'Could not prepare the Google sign-in button.',
    'Google Sign-In এখনো কনফিগার করা হয়নি।': 'Google Sign-In has not been configured yet.',
    'Google sign-in বাতিল করা হয়েছে। চাইলে আবার চেষ্টা করুন।': 'Google sign-in was cancelled. You can try again.',
    'Google provider এখনো সম্পূর্ণভাবে কনফিগার করা হয়নি। Google Client ID, Supabase Google provider এবং অনুমোদিত website origin যাচাই করুন।': 'The Google provider is not fully configured. Check the Google Client ID, Supabase Google provider and authorised website origin.',
    'Google দিয়ে প্রবেশ সম্পন্ন করা যায়নি। Google Cloud ও Supabase-এর OAuth configuration যাচাই করে আবার চেষ্টা করুন।': 'Google sign-in could not be completed. Check the Google Cloud and Supabase OAuth configuration, then try again.',
    'Google sign-in session পাওয়া যায়নি। আবার Login পেজ থেকে চেষ্টা করুন।': 'No Google sign-in session was found. Try again from the Login page.',
    'এই পৃষ্ঠার জন্য বৈধ Google পরিচয় পাওয়া যায়নি। আবার Login পেজ থেকে শুরু করুন।': 'A valid Google identity was not found for this page. Start again from the Login page.',
    'এই ব্রাউজারে নিরাপদ Google sign-in চালু করা যাচ্ছে না। আপডেট করা HTTPS browser ব্যবহার করুন।': 'Secure Google sign-in is not available in this browser. Use an up-to-date browser over HTTPS.',
    'এই ব্রাউজারে নিরাপদভাবে Google sign-in প্রস্তুত করা যাচ্ছে না। Private browsing/storage settings পরীক্ষা করুন।': 'Secure Google sign-in could not be prepared in this browser. Check private-browsing and storage settings.',
    'এই সিস্টেমে নতুন অ্যাকাউন্টের জন্য অনুমতি কোড আবশ্যক। অনুমতি কোডসহ সাধারণ রেজিস্ট্রেশন ব্যবহার করুন।': 'A permission code is required to create a new account in this system. Use the standard registration form with an access code.',
    'একবারে ২–২৫টি ভিন্ন মেস নির্বাচন করতে হবে।': 'Select between 2 and 25 different hostels at a time.',
    'একবারে সর্বোচ্চ ১০০ জনের ফাইনাল মিল সংরক্ষণ করা যাবে। আরও নির্দিষ্ট করে সদস্য খুঁজে কয়েক ধাপে সংরক্ষণ করুন।': 'You can save final meals for up to 100 members at a time. Narrow the member search and save in several batches.',
    'সংরক্ষণের জন্য সদস্যের মিলের তথ্য নেই।': 'There are no member meal records to save.',
    'অনুরোধের ইতিহাসে ফিরুন': 'Return to request history', 'উপলব্ধ': 'Available',
    'এন্ট্রি বাতিল': 'Void entry', 'টাকার পরিমাণ অনুযায়ী': 'Ranked by amount', 'তারিখের তথ্য নেই': 'Date unavailable',
    'নাম লিখে নির্দিষ্ট সদস্য বা কয়েকজনকে খুঁজুন...': 'Search for one or more members by name...',
    'নাম লিখে সদস্য খুঁজুন...': 'Search members by name...', 'ফাইনাল মিলের সদস্য খুঁজুন': 'Search final-meal members',
    'সদস্য খুঁজুন ও নির্বাচন করুন': 'Find and select a member', 'সদস্যদের মধ্যে খুঁজুন': 'Search among members', 'সার্চ মুছুন': 'Clear search',
    'আপনি যেই মাস বন্ধ করেছেন, শুধু সেই মাসের সংশোধন বা এন্ট্রি করতে পারবেন।': 'You can make corrections or entries only for months that you have closed.',
    'বন্ধ করার সঙ্গে সঙ্গেই আজকের হিসাবও চূড়ান্ত হবে—রাত ৯টার জন্য অপেক্ষা করতে হবে না। আজকের পরের তারিখের সক্রিয় অনুরোধ ও রেকর্ড এবং অপেক্ষমাণ লেট/সংশোধন অনুরোধ বাতিল হবে।': 'Closing the month also finalises today’s accounts immediately; there is no need to wait until 9 PM. Active requests and records for later dates, along with pending late or correction requests, will be cancelled.',
    'মেসের গুরুত্বপূর্ণ বিজ্ঞপ্তি এই Telegram অ্যাকাউন্টে পাবেন।': 'You will receive important hostel notifications in this Telegram account.',
    'মোবাইল নম্বর সংরক্ষণ নিশ্চিত করা যায়নি। আবার নম্বর দিয়ে চেষ্টা করুন।': 'Could not confirm that the mobile number was saved. Enter the number and try again.',
    'অ্যাকাউন্ট সম্পূর্ণ করতে আপনার মোবাইল নম্বর নিশ্চিত করুন।': 'Confirm your mobile number to complete your account.',
    'অ্যাকাউন্ট সম্পূর্ণ করুন': 'Complete your account', 'অ্যাকাউন্টের তথ্য সংরক্ষণ করা হচ্ছে...': 'Saving account information...',
    'আপনার মোবাইল নম্বর লিখুন': 'Enter your mobile number', 'চালিয়ে যেতে ১৮+ বয়স, ব্যবহারের শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি দিন।': 'To continue, confirm that you are 18 or older and accept the Terms of Service and Privacy Policy.',
    'নাম ২ থেকে ১০০ অক্ষরের মধ্যে হতে হবে।': 'Name must be between 2 and 100 characters.', 'Google account পাওয়া যায়নি।': 'Google account was not found.',
    'প্রোফাইল সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।': 'Could not complete the profile. Please try again.',
    'Google account যাচাই করা হচ্ছে': 'Verifying Google account', 'Google account যাচাই করা হচ্ছে...': 'Verifying Google account...',
    'Google থেকে পাওয়া নাম, ইমেইল ও প্রোফাইল ছবি প্রস্তুত। অ্যাপ ব্যবহারের আগে মোবাইল নম্বর দিন।': 'Your name, email and profile photo from Google are ready. Add your mobile number before using the app.',
    'Google আপনার মোবাইল নম্বর দেয় না। নম্বরটি আপনার Hostel Life profile-এ সংরক্ষণ করা হবে। এই ধাপে SMS OTP যাচাই করা হবে না।': 'Google does not provide your mobile number. It will be saved to your Hostel Life profile. No SMS OTP verification is performed at this step.',
    'Google থেকে বৈধ পরিচয় যাচাইয়ের তথ্য পাওয়া যায়নি। আবার চেষ্টা করুন।': 'Google did not provide valid identity verification information. Please try again.',
    'Google sign-in অনুরোধের সময়সীমা শেষ হয়েছে। আবার চেষ্টা করুন।': 'The Google sign-in request timed out. Please try again.',
    'Google sign-in-এর নিরাপদ session state সংরক্ষণ করা যায়নি।': 'Could not save the secure Google sign-in session state.',
    'Supabase Google identity থেকে session তৈরি করতে পারেনি।': 'Supabase could not create a session from the Google identity.',
    'Google sign-in সম্পন্ন হয়নি': 'Google sign-in was not completed', 'লগইন পেজে ফিরুন': 'Return to the login page',
    'সদস্যের বিস্তারিত PDF ডাউনলোড': 'Download member detail PDF', 'সদস্যের রিপোর্ট তৈরি করা যায়নি।': 'Could not generate the member report.',
    'প্রস্তুত করেছেন': 'Prepared by', 'প্রস্তুতির সময়': 'Prepared at',
    'নির্বাচিত মেসগুলো স্থায়ীভাবে মুছে ফেলা যায়নি।': 'The selected hostels could not be permanently deleted.',
    'নির্বাচিত মেসগুলোর সদস্যদের Auth account-ও মুছুন': 'Also delete the Auth accounts of members in the selected hostels.',
    'সব নির্বাচিত মেস মুছে ফেলার পর সার্ভার প্রতিটি account-এর অন্য মেসের membership ও Super Admin role আবার যাচাই করবে। নিজের Admin account কখনো মুছবে না।': 'After deleting the selected hostels, the server will recheck each account’s memberships in other hostels and its Super Admin role. Your own Admin account will never be deleted.',
    'Database bulk-delete response যাচাই করা যায়নি। Auth account cleanup চালানো হয়নি। Supabase result পরীক্ষা করুন।': 'The database bulk-delete response could not be verified. Auth account cleanup was not run. Check the Supabase result.',
    'হোস্টেল লাইফ': 'Hostel Life', 'সহজ, স্বচ্ছ ও সুশৃঙ্খল ব্যবস্থাপনা': 'Simple, transparent and organised management.',
  };

  const ALL = Object.assign({}, EN, MORE_EN, LEGAL_TEXT, window.HostelLifeEnglishTranslations || {});
  const normalize = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  const toLatinDigits = (value) => String(value).replace(/[০-৯]/gu, (d) => String(bnDigits.indexOf(d)));
  const attrNames = ['placeholder', 'title', 'aria-label', 'alt', 'content'];
  const textRecords = new WeakMap();
  const attrRecords = new WeakMap();
  let currentLanguage = readLanguage();
  let observer = null;
  let scheduled = false;

  function readLanguage() {
    try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'bn'; }
    catch { return 'bn'; }
  }
  function getLanguage() { return currentLanguage; }

  function englishDate(value) {
    const raw = String(value || '');
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw;
    const date = new Date(`${raw}T12:00:00+06:00`);
    return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('en-US', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka'
    }).format(date);
  }

  // Translate only known UI templates. Captured member names, hostel names,
  // user notes, market items and other user-authored values are preserved.
  function translateDynamicUi(key) {
    let match = key.match(/^([০-৯0-9,]+) জন সদস্য (পাওয়া গেছে|পাওয়া গেছে|উপলব্ধ)(?: · নির্বাচিত: (.+))?$/u);
    if (match) return `${toLatinDigits(match[1])} members ${match[2] === 'উপলব্ধ' ? 'available' : 'found'}${match[3] ? ` · Selected: ${match[3]}` : ''}`;
    match = key.match(/^দেখানো হচ্ছে ([০-৯0-9,]+) \/ ([০-৯0-9,]+) জন · সার্চ চালু থাকলে শুধু দেখানো সদস্যদের মিল সংরক্ষণ হবে(?: · একবারে সর্বোচ্চ ১০০ জন; আরও নির্দিষ্ট করে খুঁজুন)?$/u);
    if (match) return `Showing ${toLatinDigits(match[1])} / ${toLatinDigits(match[2])} members · Only visible members will be saved while search is active${key.endsWith('খুঁজুন') ? ' · Up to 100 members per batch; narrow the search' : ''}`;
    match = key.match(/^([০-৯0-9,]+) জন সক্রিয় সদস্য(?: · একবারে সর্বোচ্চ ১০০ জনের মিল সংরক্ষণ করা যাবে)?$/u);
    if (match) return `${toLatinDigits(match[1])} active members${key.includes('সর্বোচ্চ') ? ' · Final meals can be saved for up to 100 members at a time' : ''}`;
    match = key.match(/^(.+) · বর্তমানে নির্বাচিত$/u);
    if (match) return `${match[1]} · Currently selected`;
    if (key === '-এর পর') return ' after';
    match = key.match(/^(.+)-এর এই লেনদেন সরাসরি মুছে না দিয়ে হিসাব সমন্বয়ের রেকর্ড তৈরি হবে।$/u);
    if (match) return `${match[1]}’s transaction will be adjusted through an account adjustment record instead of being deleted directly.`;
    match = key.match(/^(.+)-এর মিল$/u);
    if (match) return `${match[1]}’s meals`;
    match = key.match(/^নতুন মাসের প্রথম মিলের দিন (.+)। আজ রাত ১০টা পর্যন্ত এই দিনের জন্য সাধারণ মিল অনুরোধ দেওয়া যাবে।$/u);
    if (match) return `The first meal day of the new month is ${englishDate(match[1])}. Regular meal requests for this day can be submitted until 10:00 PM tonight.`;
    match = key.match(/^নতুন মাসের প্রথম মিলের দিন (.+)। আজ রাত ৮টার পর এই মাস চালু করা যাবে।$/u);
    if (match) return `The first meal day of the new month is ${englishDate(match[1])}. This month can be started after 8:00 PM today.`;
    match = key.match(/^নতুন মাস চালু করা যাবে, তবে প্রথম মিলের দিন (.+) ইতিমধ্যে পেরিয়ে গেছে। আগামীকাল ও পরবর্তী দিনের জন্য রাত ১০টা পর্যন্ত সাধারণ অনুরোধ দেওয়া যাবে।$/u);
    if (match) return `The new month can be started, but its first meal day (${englishDate(match[1])}) has passed. Regular requests for tomorrow and later dates can be submitted until 10:00 PM.`;
    match = key.match(/^নতুন মাস চালু করা যাবে, তবে প্রথম মিলের দিন (.+) ইতিমধ্যে পেরিয়ে গেছে। এখন আগামীকালের জন্য Late Request এবং পরের দিনগুলোর জন্য নির্ধারিত অনুরোধ-সময় অনুসরণ করুন।$/u);
    if (match) return `The new month can be started, but its first meal day (${englishDate(match[1])}) has passed. Use a Late Request for tomorrow and the scheduled request window for later dates.`;
    match = key.match(/^নতুন মাস চালু করা যাবে। প্রথম দিনের স্বাভাবিক মিল অনুরোধ রাত ১০টা পর্যন্ত গ্রহণ করা হবে; এখন প্রায় (.+) সময় বাকি।$/u);
    if (match) return `The regular meal request window for the first day remains open until 10:00 PM. About ${translateDynamicUi(match[1])} remain.`;
    match = key.match(/^([০-৯0-9]+) ঘণ্টা ([০-৯0-9]+) মিনিট$/u);
    if (match) return `${toLatinDigits(match[1])} hours ${toLatinDigits(match[2])} minutes`;
    match = key.match(/^([০-৯0-9]+) মিনিট$/u);
    if (match) return `${toLatinDigits(match[1])} minutes`;
    match = key.match(/^নির্বাচিত তারিখসীমায় (রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার) নেই। তারিখসীমা পরিবর্তন করে আবার চেষ্টা করুন।$/u);
    if (match) {
      const days = { রবিবার:'Sunday', সোমবার:'Monday', মঙ্গলবার:'Tuesday', বুধবার:'Wednesday', বৃহস্পতিবার:'Thursday', শুক্রবার:'Friday', শনিবার:'Saturday' };
      return `There are no ${days[match[1]]}s in the selected date range. Change the range and try again.`;
    }
    match = key.match(/^আপনার (.+)-এর জন্য আগে থেকেই একটি সক্রিয় মিল অনুরোধ আছে। একই দিনের জন্য আবার অনুরোধ দেওয়া যাবে না।$/u);
    if (match) return `You already have an active meal request for ${englishDate(match[1])}. A second request cannot be submitted for the same day.`;
    match = key.match(/^নতুন মাস (.+) থেকে শুরু হবে। (.+) (.+) থেকে করা যাবে।$/u);
    if (match) return `The new month will start on ${match[1]}. ${translate(match[2])} will be available from ${match[3]}.`;
    match = key.match(/^নতুন মাস চালু হয়েছে। প্রথম মিলের তারিখ (.+)। ওই দিন শুরু হলে এই কার্ডে মিলের হিসাব দেখা যাবে।$/u);
    if (match) return `The new month is active. The first meal date is ${englishDate(match[1])}. Meal details will appear on this card when that day begins.`;
    match = key.match(/^শেষ সিঙ্ক (.+)$/u);
    if (match) return `Last synced ${match[1]}`;
    match = key.match(/^আপডেটের সময়: (.+)$/u);
    if (match) return `Updated at: ${match[1]}`;
    match = key.match(/^লাইন ([০-৯0-9]+): সর্বোচ্চ ৩টি কলাম দিন—আইটেম, পরিমাণ ও টাকা।$/u);
    if (match) return `Line ${toLatinDigits(match[1])}: enter no more than 3 columns—item, quantity and amount.`;
    match = key.match(/^লাইন ([০-৯0-9]+): আইটেমের নাম পাওয়া যায়নি।$/u);
    if (match) return `Line ${toLatinDigits(match[1])}: item name is missing.`;
    match = key.match(/^লাইন ([০-৯0-9]+): আইটেমের নাম ১৬০ অক্ষরের বেশি।$/u);
    if (match) return `Line ${toLatinDigits(match[1])}: the item name is longer than 160 characters.`;
    match = key.match(/^লাইন ([০-৯0-9]+): পরিমাণ ১২০ অক্ষরের বেশি।$/u);
    if (match) return `Line ${toLatinDigits(match[1])}: the quantity is longer than 120 characters.`;
    match = key.match(/^লাইন ([০-৯0-9]+): টাকার ঘরে শুধু সঠিক সংখ্যা দিন। উদাহরণ: ৫০০ বা ৫০০\.৫০।$/u);
    if (match) return `Line ${toLatinDigits(match[1])}: enter a valid number in the amount field, for example 500 or 500.50.`;
    match = key.match(/^বাজার সফলভাবে সংরক্ষণ হয়েছে — (.+)。$/u);
    if (match) return `Market entry saved successfully — ${match[1]}.`;
    match = key.match(/^আইটেম ([০-৯0-9]+) এর নাম$/u);
    if (match) return `Item ${toLatinDigits(match[1])} name`;
    match = key.match(/^([০-৯0-9,]+)টি দেখা হয়েছে, ([০-৯0-9,]+)টি বাকি। পরে আবার চেষ্টা করুন।$/u);
    if (match) return `${toLatinDigits(match[1])} marked as seen, ${toLatinDigits(match[2])} remaining. Try again later.`;
    match = key.match(/^লেট অনুরোধের তারিখ (.+) চলমান মাসের শুরুর তারিখ (.+)-এর আগে। চলমান মাস বন্ধ না হওয়া পর্যন্ত নির্দিষ্ট শেষ তারিখ নেই।$/u);
    if (match) return `The Late Request date ${englishDate(match[1])} is before the running month start date ${englishDate(match[2])}. There is no fixed end date until the running month is closed.`;
    match = key.match(/^(?:ভেরিফিকেশন )?কোড পাঠানো হ(?:য়েছে|য়েছে) (.+) ঠিকান(?:ায়|ায়)$/u);
    if (match) return `A verification code was sent to ${match[1]}`;
    match = key.match(/^নির্বাচিত শুরুর তারিখ চলমান মাস শুরু হওয়ার আগে। বৈধ সীমা (.+) থেকে (.+)।$/u);
    if (match) return `The selected start date is before the running month. Valid range: ${englishDate(match[1])} to ${match[2] === 'শেষ তারিখ নির্ধারিত নয়' ? 'no fixed end date' : englishDate(match[2])}.`;
    match = key.match(/^মিল অনুরোধ চলমান মাসের শেষ তারিখের বাইরে দেওয়া যাবে না। বর্তমান সীমা (.+) থেকে (.+)।$/u);
    if (match) return `Meal requests cannot be submitted beyond the end of the running month. Current range: ${englishDate(match[1])} to ${englishDate(match[2])}.`;
    match = key.match(/^নতুন মাসের প্রথম মিলের দিন (.+) ইতিমধ্যে পেরিয়েছে।$/u);
    if (match) return `The first meal date of the new month (${match[1]}) has already passed.`;
    match = key.match(/^আজ রাত ১০টার স্বাভাবিক cutoff শেষ হয়েছে। আজকের মিলের জন্য লেট অনুরোধ দিন; সেটি ম্যানেজারের অনুমোদনসাপেক্ষ।$/u);
    if (match) return 'The regular 10:00 PM cutoff has passed. Submit a Late Request for today; it requires manager approval.';
    match = key.match(/^স্বাভাবিক অনুরোধ (.+) পরে, আজ রাত ১০টায় বন্ধ হবে। (.+)$/u);
    if (match) return `The regular request window closes in ${match[1]} at 10:00 PM today. ${match[2] === 'এর আগে চাইলে অনুরোধ আপডেট করতে পারবেন।' ? 'You can update your request before the cutoff.' : 'Submit your meal request before the cutoff.'}`;
    match = key.match(/^([০-৯0-9,]+)টি সদস্য-তারিখে আগে থেকেই অনুরোধ বা মিলের তথ্য পাওয়া গেছে। duplicate তৈরি না করে সংশ্লিষ্ট অনুরোধ\/মিল এন্ট্রি সম্পাদনা করুন। আপনি জোর করে পরিবর্তন চালালে server permission অনুযায়ী আগের হিসাব override হবে।$/u);
    if (match) return `Existing request or meal data was found for ${toLatinDigits(match[1])} member-date combination(s). Edit the relevant request or meal entry instead of creating duplicates. If you force the change, the previous record will be overridden according to server permissions.`;
    match = key.match(/^“(.+)” মাসের “(.+)” সংশোধন করবেন\? আগের ও নতুন মান অডিট লগে থাকবে এবং সদস্যদের জানানো হবে।$/u);
    if (match) return `Correct “${match[2]}” for the “${match[1]}” month? The previous and new values will be recorded in the audit log and members will be notified.`;
    match = key.match(/^বাজার \(([০-৯0-9,]+)টি\)$/u);
    if (match) return `Market (${toLatinDigits(match[1])})`;
    match = key.match(/^সদস্যভিত্তিক হিসাব \(([০-৯0-9,]+) জন\)$/u);
    if (match) return `Member accounts (${toLatinDigits(match[1])})`;
    match = key.match(/^খালার টাকা \(([০-৯0-9,]+)টি\)$/u);
    if (match) return `Staff allowance (${toLatinDigits(match[1])})`;
    match = key.match(/^দৈনিক ফাইনাল মিল \(([০-৯0-9,]+) দিন\)$/u);
    if (match) return `Daily finalized meals (${toLatinDigits(match[1])} days)`;
    match = key.match(/^লেনদেন \(([০-৯0-9,]+)টি\)$/u);
    if (match) return `Transactions (${toLatinDigits(match[1])})`;
    match = key.match(/^নাম সংরক্ষিত নেই · User ([A-Za-z0-9-]+)$/u);
    if (match) return `Name not recorded · User ${match[1]}`;
    match = key.match(/^(.+)-এর (.+) তারিখে আগে থেকেই মিল অনুরোধ বা মিল এন্ট্রি আছে। নতুন করে duplicate না করে “মিল অনুরোধ” থেকে সেটি সম্পাদনা\/সংশোধন করুন।$/u);
    if (match) return `${match[1]} already has a meal request or meal entry for ${match[2]}. Edit the existing item from “Meal Requests” instead of creating a duplicate.`;
    match = key.match(/^নতুন মাসের প্রথম মিলের দিন (.+) ইতিমধ্যে পেরিয়েছে।$/u);
    if (match) return `The first meal day of the new month (${match[1]}) has already passed.`;
    match = key.match(/^আপনার (.+)-এর জন্য আগে থেকেই একটি সক্রিয় মিল অনুরোধ আছে। একই দিনের জন্য আবার অনুরোধ দেওয়া যাবে না।$/u);
    if (match) return `You already have an active meal request for ${match[1]}. A second request cannot be submitted for the same day.`;
    match = key.match(/^এই মাসের সারসংক্ষেপ সংরক্ষণ করবেন\?\n(.+)\nএতে মূল হিসাব মুছবে না।$/u);
    if (match) return `Save the summary for this month?\n${match[1]}\nThe original accounts will not be deleted.`;
    // Hostel/account action confirmations. Dynamic names, email addresses, IPs,
    // period labels and free-form descriptions are deliberately preserved.
    match = key.match(/^“(.+)” মেস তৈরি হয়েছে এবং (.+) থেকে চলমান মাস শুরু হয়েছে।$/u);
    if (match) return `“${match[1]}” was created. The current month starts on ${englishDate(match[2])}.`;
    match = key.match(/^“(.+)” আবার চালু করা হবে। মাস বন্ধ করার সময় বাতিল হওয়া ভবিষ্যতের request স্বয়ংক্রিয়ভাবে ফেরত আসবে না। আপনি কি নিশ্চিত\?$/u);
    if (match) return `“${match[1]}” will be reopened. Future requests cancelled when the month was closed will not be restored automatically. Are you sure?`;
    match = key.match(/^“(.+)” পুনরায় চলমান করবেন\? বন্ধ করার সময় বাতিল হয়ে যাওয়া অনুরোধ স্বয়ংক্রিয়ভাবে ফিরবে না।$/u);
    if (match) return `Reopen “${match[1]}”? Requests cancelled when the month was closed will not be restored automatically.`;
    match = key.match(/^“(.+)” মেস (.+) করবেন\? এই অ্যাকশন ডেটা মুছবে না। স্থায়ীভাবে মুছতে আলাদা Super Delete ব্যবহার করুন।$/u);
    if (match) {
      const actionLabels = { বন্ধ: 'close', চালু: 'activate', স্থগিত: 'suspend', 'পুনরায় চালু': 'reopen', নিষ্ক্রিয়: 'deactivate' };
      const action = actionLabels[match[2]] || match[2];
      return `Do you want to ${action} hostel “${match[1]}”? This action will not delete data. Use Super Delete separately for permanent deletion.`;
    }
    match = key.match(/^“(.+)” স্থায়ীভাবে মুছে দিতে চান\? সংরক্ষিত সারসংক্ষেপ থেকে মূল লেনদেন ফেরানো যাবে না। ব্যাকআপ নিশ্চিত করুন।$/u);
    if (match) return `Permanently delete “${match[1]}”? Original transactions cannot be restored from a saved summary. Confirm that you have a backup.`;
    match = key.match(/^(.+) আবার সক্রিয় হয়েছে।$/u);
    if (match) return `${match[1]} has been reactivated.`;
    match = key.match(/^(.+) এখন নিষ্ক্রিয় সদস্য। (.+) মোট ([০-৯0-9,]+)টি অনুরোধ ও ([০-৯0-9,]+)টি মিল রেকর্ড বাতিল হয়েছে।$/u);
    if (match) return `${match[1]} is now an inactive member. ${translate(match[2])} A total of ${toLatinDigits(match[3])} requests and ${toLatinDigits(match[4])} meal records were cancelled.`;
    match = key.match(/^(.+) থেকে (.+)-এর (.+) Block তুলে দেবেন\? এটি Audit Log-এ সংরক্ষিত হবে।$/u);
    if (match) return `Remove the ${translate(match[3])} block for ${translate(match[2])} from ${match[1]}? This action will be recorded in the Audit Log.`;
    match = key.match(/^(.+)-এর Telegram সংযোগ বিচ্ছিন্ন হবে। Telegram ID-র সংযোগ এবং pending link token বাতিল হবে; Hostel Life account বা অন্য তথ্য মুছবে না।$/u);
    if (match) return `The Telegram connection for ${match[1]} will be disconnected. The Telegram ID link and pending link token will be cancelled; the Hostel Life account and other information will not be deleted.`;
    match = key.match(/^(.+) বন্ধ হয়েছে। (.+) পর্যন্ত হিসাব সঙ্গে সঙ্গেই চূড়ান্ত হয়েছে(?: \(([০-৯0-9,]+)টি মিল-দিন\))?। ([০-৯0-9,]+)টি অনুরোধ ও ([০-৯0-9,]+)টি ভবিষ্যৎ মিল রেকর্ড বাতিল হয়েছে।$/u);
    if (match) return `${match[1]} has been closed. Accounts through ${englishDate(match[2])} have been finalised immediately${match[3] ? ` (${toLatinDigits(match[3])} meal days)` : ''}. ${toLatinDigits(match[4])} requests and ${toLatinDigits(match[5])} future meal records were cancelled.`;
    match = key.match(/^([০-৯0-9,]+) জনের মিল সফলভাবে সংরক্ষণ হয়েছে।$/u);
    if (match) return `Meals for ${toLatinDigits(match[1])} people were saved successfully.`;
    match = key.match(/^(.+)-এর নামে (.+) ডিপোজিট সফলভাবে যোগ হয়েছে।$/u);
    if (match) return `A deposit of ${match[2]} was successfully added under ${match[1]}.`;
    match = key.match(/^(.+)-এর হিসাব থেকে (.+) সফলভাবে বাদ দেওয়া হয়েছে।$/u);
    if (match) return `${match[2]} was successfully deducted from ${match[1]}’s account.`;
    match = key.match(/^(.+)-কে (ব্লক|আনব্লক) করবেন\?$/u);
    if (match) return `${translate(match[2])} ${match[1]}?`;
    match = key.match(/^([০-৯0-9,]+)টি আইটেম একসঙ্গে যোগ হয়েছে। পরিমাণ ও টাকার ঘর যাচাই করে সংরক্ষণ করুন।$/u);
    if (match) return `${toLatinDigits(match[1])} items were added together. Review the quantities and amounts before saving.`;
    match = key.match(/^(.+) সফলভাবে শুরু হয়েছে।$/u);
    if (match) return `${translate(match[1]) || match[1]} started successfully.`;
    match = key.match(/^(.+) আবার চালু হয়েছে। বাতিল হওয়া future request প্রয়োজন হলে পুনরায় জমা দিতে হবে।$/u);
    if (match) return `${translate(match[1]) || match[1]} has been reopened. Cancelled future requests must be submitted again if needed.`;
    match = key.match(/^(.+)-এর নির্দিষ্ট Device Session বন্ধ হবে। এই কাজটি শুধু নির্বাচিত Session-এ প্রয়োগ হবে; অন্য Session অক্ষত থাকবে।$/u);
    if (match) return `The selected device session for ${match[1]} will be terminated. Only this session will be affected; other sessions will remain active.`;
    match = key.match(/^([০-৯0-9,]+)টি দেখা হয়েছে, ([০-৯0-9,]+)টি বাকি। পরে আবার চেষ্টা করুন।$/u);
    if (match) return `${toLatinDigits(match[1])} marked as seen; ${toLatinDigits(match[2])} remaining. Try again later.`;
    match = key.match(/^(.+)-এর হয়ে অনুরোধ তৈরি হয়েছে। এটি ওই সদস্যের অনুরোধের ইতিহাসে থাকবে।$/u);
    if (match) return `A request was created on behalf of ${match[1]}. It will appear in that member’s request history.`;
    match = key.match(/^আপনি কি (.+)-এর পরিচয় যাচাই করেছেন\? আগের পাসওয়ার্ড সঙ্গে সঙ্গে বাতিল হবে।$/u);
    if (match) return `Have you verified the identity of ${match[1]}? The previous password will be invalidated immediately.`;
    match = key.match(/^এই Auth account অন্য কোনো মেসে নেই, তা সার্ভারে আবার যাচাই করে মুছবে। এটি ফেরানো যাবে না: (.+)$/u);
    if (match) return `The server will verify again that this Auth account is not used by another hostel before deleting it. This cannot be undone: ${match[1]}`;
    match = key.match(/^থিম “(.+)” হিসেবে সংরক্ষণ হয়েছে।$/u);
    if (match) return `Theme saved as “${translate(match[1]) || match[1]}”.`;
    match = key.match(/^নিচের ([০-৯0-9,]+)টি Auth account স্থায়ীভাবে মুছে ফেলা হবে। সার্ভার প্রতিটি account-এর membership, Super Admin role ও বর্তমান Admin account আবার যাচাই করবে। মুছে ফেললে ফিরিয়ে আনা যাবে না।$/u);
    if (match) return `${toLatinDigits(match[1])} Auth account(s) below will be permanently deleted. The server will re-check each account’s membership, Super Admin role and current Admin account. This action cannot be undone.`;
    match = key.match(/^নির্বাচিত IP (.+) নির্দিষ্ট সময়ের জন্য (.+) থেকে সব অ্যাকাউন্টের জন্য ব্লক হবে। এটি Manual Global Block; স্বয়ংক্রিয় ভুল-চেষ্টার Block শুধু IP ও চেষ্টা করা ইমেইলের জোড়ায় প্রযোজ্য। নিশ্চিত করতে IP-টি হুবহু লিখুন।$/u);
    if (match) return `The selected IP ${match[1]} will be blocked for all accounts from ${translate(match[2]) || match[2]} for the specified period. This is a manual global block; automatic failed-attempt blocks apply only to an IP and the email attempted from it. Enter the IP exactly to confirm.`;
    match = key.match(/^বার্তাটি (.+) পাঠাবেন\?$/u);
    if (match) return `Send this message to ${translate(match[1]) || match[1]}?`;
    match = key.match(/^সব মেসে (.+) মাস বিস্তারিত ও পরবর্তী (.+) মাস সামারি রাখবেন\? এতে এখন কোনো ডেটা মুছবে না।$/u);
    if (match) return `Keep detailed records for ${toLatinDigits(match[1])} months across all hostels and summaries for the next ${toLatinDigits(match[2])} months? No data will be deleted now.`;
    match = key.match(/^শিরোনাম: (.+)$/u);
    if (match) return `Title: ${match[1]}`;
    return '';
  }

  function translate(value) {
    if (currentLanguage !== 'en') return value;
    const key = normalize(value);
    if (!key) return value;
    if (ALL[key]) return ALL[key];
    const dynamic = translateDynamicUi(key);
    if (dynamic) return dynamic;
    let match = key.match(/^([০-৯0-9,]+)\s*জন$/u);
    if (match) return `${toLatinDigits(match[1])} people`;
    match = key.match(/^([০-৯0-9,]+)\s*টি$/u);
    if (match) return `${toLatinDigits(match[1])} items`;
    match = key.match(/^([০-৯0-9,]+)\s*দিন$/u);
    if (match) return `${toLatinDigits(match[1])} days`;
    match = key.match(/^([০-৯0-9,]+)\s*টাকা$/u);
    if (match) return `৳${toLatinDigits(match[1])}`;
    // Pure numeric UI nodes are safe to localize. Unknown text is intentionally
    // returned unchanged so user-entered names, notices and notes are not altered.
    if (/^[০-৯,./:-]+$/u.test(key)) return toLatinDigits(value);
    return value;
  }
  function isProtectedTextNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('script, style, noscript, textarea, input, code, pre, [contenteditable="true"], [data-no-translate], [data-user-content]')) return true;
    return false;
  }
  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || isProtectedTextNode(node)) return;
    let record = textRecords.get(node);
    const current = node.nodeValue || '';
    if (!record) {
      record = { base: current, rendered: current };
      textRecords.set(node, record);
    } else if (current !== record.rendered) {
      // React changed the original Bengali content after a state update.
      record.base = current;
    }
    const base = record.base;
    const keyedElement = node.parentElement?.closest?.('[data-i18n-key]');
    const keyedTranslation = currentLanguage === 'en' && keyedElement ? KEY_EN[keyedElement.getAttribute('data-i18n-key')] : '';
    const leading = base.match(/^\s*/u)?.[0] || '';
    const trailing = base.match(/\s*$/u)?.[0] || '';
    const core = base.slice(leading.length, base.length - trailing.length || base.length);
    const next = currentLanguage === 'en' ? `${leading}${keyedTranslation || translate(core)}${trailing}` : base;
    if (node.nodeValue !== next) node.nodeValue = next;
    record.rendered = next;
  }
  function translateAttributes(element) {
    if (!(element instanceof Element)) return;
    if (element.closest('[data-no-translate], [data-user-content]')) return;
    attrNames.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      if (name === 'content' && !element.matches('meta[data-i18n-content-key], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]')) return;
      let records = attrRecords.get(element);
      if (!records) { records = new Map(); attrRecords.set(element, records); }
      const current = element.getAttribute(name) || '';
      let record = records.get(name);
      if (!record) { record = { base: current, rendered: current }; records.set(name, record); }
      else if (current !== record.rendered) record.base = current;
      const contentKey = name === 'content' ? element.getAttribute('data-i18n-content-key') : (name === 'aria-label' ? element.getAttribute('data-i18n-aria-label-key') : '');
      const keyedValue = contentKey && currentLanguage === 'en' ? KEY_EN[contentKey] : '';
      const next = currentLanguage === 'en' ? (keyedValue || translate(record.base)) : record.base;
      if (current !== next) element.setAttribute(name, next);
      record.rendered = next;
    });
    if (element.matches('input[type="button"], input[type="submit"]') && element.hasAttribute('value')) {
      let records = attrRecords.get(element);
      if (!records) { records = new Map(); attrRecords.set(element, records); }
      let record = records.get('value');
      const current = element.value;
      if (!record) { record = { base: current, rendered: current }; records.set('value', record); }
      else if (current !== record.rendered) record.base = current;
      const next = currentLanguage === 'en' ? translate(record.base) : record.base;
      if (current !== next) element.value = next;
      record.rendered = next;
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (root.querySelectorAll) root.querySelectorAll('*').forEach(translateAttributes);
  }
  function updateLanguageControls() {
    document.querySelectorAll('[data-language-switch]').forEach((button) => {
      button.textContent = currentLanguage === 'bn' ? 'English' : 'বাংলা';
      button.setAttribute('aria-label', currentLanguage === 'bn' ? 'Switch language to English' : 'ভাষা বাংলায় পরিবর্তন করুন');
      button.setAttribute('aria-pressed', currentLanguage === 'en' ? 'true' : 'false');
    });
  }
  function applyLanguage() {
    document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'bn-BD';
    document.documentElement.dataset.language = currentLanguage;
    document.documentElement.dataset.locale = currentLanguage === 'en' ? 'en-US' : 'bn-BD';
    walk(document.documentElement);
    updateLanguageControls();
    const title = document.querySelector('head title');
    if (title) translateTextNode(title.firstChild);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { language: currentLanguage } }));
  }
  function setLanguage(language) {
    const next = language === 'en' ? 'en' : 'bn';
    if (next === currentLanguage) return next;
    currentLanguage = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Page remains usable for this session. */ }
    applyLanguage();
    return currentLanguage;
  }
  function toggleLanguage() { return setLanguage(currentLanguage === 'bn' ? 'en' : 'bn'); }
  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (event) => callback(event.detail?.language || currentLanguage);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }
  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target);
        else if (record.type === 'attributes') translateAttributes(record.target);
        else if (record.type === 'childList') {
          record.addedNodes.forEach((node) => walk(node));
        }
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrNames });
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-language-switch]');
    if (button) { event.preventDefault(); toggleLanguage(); }
  });
  window.HostelLifeI18n = Object.freeze({ getLanguage, setLanguage, toggleLanguage, subscribe, translate, storageKey: STORAGE_KEY });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = event.newValue === 'en' ? 'en' : 'bn';
    if (next !== currentLanguage) { currentLanguage = next; applyLanguage(); }
  });
  startObserver();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyLanguage, { once: true });
  else applyLanguage();
})();
