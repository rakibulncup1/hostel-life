/* Shared language switcher for the three public documents. */
(() => {
  'use strict';

  const STORAGE_KEY = 'hostel-life-public-language';
  const translations = {
    'Hostel Life — মেসের প্রতিদিনের কাজ, আরও গোছানো': 'Hostel Life — A clearer way to manage shared living',
    'Hostel Life—মিল, বাজার, সদস্য ও মেসের হিসাব এক জায়গায় গুছিয়ে রাখার বাংলা ওয়েব অ্যাপ।': 'Hostel Life is a web app for organising meals, shopping, members, and shared-hostel accounts in one place.',
    'দৈনিক মিল, বাজার, জমা-খরচ ও মাসিক হিসাব রাখুন একটি জায়গায়।': 'Keep daily meals, shopping, deposits, expenses, and monthly records together in one place.',
    'Hostel Life-এ আপনার তথ্য কীভাবে ব্যবহার, সংরক্ষণ ও নিয়ন্ত্রণ করা হয়—সহজ ভাষায় জানুন।': 'Learn in clear language how Hostel Life uses, stores, and handles your information.',
    'Hostel Life ব্যবহারের নিয়ম, অ্যাকাউন্টের দায়িত্ব এবং মেসের তথ্য ব্যবস্থাপনা সম্পর্কে জানুন।': 'Learn about the rules for using Hostel Life, account responsibilities, and hostel information management.',
    'মেসের সব হিসাব—দৈনিক মিল, মিলের অনুরোধ, বাজার, সদস্যদের জমা-খরচ আর মাসিক রেকর্ড—একটি সহজ ওয়েব অ্যাপে গুছিয়ে রাখুন। প্রয়োজনের সময় তথ্য খুঁজে পাওয়া ও কাজের অবস্থা বোঝা এখন আরও সহজ।': 'Bring meal planning, meal requests, shopping, member deposits and expenses, and monthly records together in one straightforward web app. Find the information you need and understand what is happening across your shared home with less back-and-forth.',
    'নীতিমালার অংশগুলো': 'Policy sections',
    'এই পাতার গুরুত্বপূর্ণ অংশ': 'On this page',
    'ফিচার': 'Features',
    'অ্যাপের স্ক্রিন': 'App preview',
    'গোপনীয়তা': 'Privacy',
    'শর্তাবলী': 'Terms',
    'প্রবেশ করুন': 'Log in',
    'অ্যাকাউন্ট তৈরি করুন': 'Create account',
    'প্রধান ফিচার': 'Key features',
    'গোপনীয়তা নীতি': 'Privacy policy',
    'ব্যবহারের শর্তাবলী': 'Terms of service',
    'অ্যাকাউন্ট তৈরি করুন ↗': 'Create account ↗',
    'মেস পরিচালনা, এক জায়গায়': 'Shared living, thoughtfully organised',
    'মেসের প্রতিদিনের কাজ হোক': 'Bring everyday hostel tasks',
    'আরও গোছানো।': 'into one clear workflow.',
    'মেসের সব হিসাব—দৈনিক মিল, মিলের অনুরোধ, বাজার, সদস্যদের জমা-খরচ আর মাসিক রেকর্ড—সবকিছু বাংলায়, সহজ একটি ওয়েব অ্যাপে। প্রয়োজনের সময় তথ্য খুঁজে পাওয়া ও কাজের অবস্থা বোঝা এখন আরও সহজ।': 'Bring meal planning, meal requests, shopping, member deposits and expenses, and monthly records together in one straightforward web app. Find the information you need and understand what is happening across your shared home with less back-and-forth.',
    'আগের অ্যাকাউন্টে প্রবেশ': 'Log in to an existing account',
    'বাংলা ইন্টারফেস': 'Bengali interface',
    'দৈনিক কাজের রেকর্ড': 'Daily activity records',
    'মাসভিত্তিক হিসাব': 'Monthly records',
    'ড্যাশবোর্ড · আজকের মিল': 'Dashboard · Today’s meals',
    'প্রতিদিনের অবস্থা এক নজরে': 'Your daily overview, at a glance',
    'বাস্তব অ্যাপ স্ক্রিন': 'Actual app screen',
    'ডাইনিং · প্রয়োজনীয় কাজ': 'Dining · Everyday tasks',
    'মিল ও বাজারের কাজ': 'Meals and shopping',
    'মিলের পরিকল্পনা': 'Meal planning',
    'দৈনিক মিল ও অনুরোধ': 'Daily meals and requests',
    'বাজার ও জমা': 'Shopping and deposits',
    'এন্ট্রি ও খরচের রেকর্ড': 'Entries and expense records',
    'হিসাব ও রিপোর্ট': 'Accounts and reports',
    'মাসভিত্তিক সারসংক্ষেপ': 'Monthly summaries',
    'দৈনন্দিন কাজ, একই জায়গায়': 'Everyday essentials, in one place',
    'যে কাজগুলো প্রতিদিন লাগে, সেগুলোই আগে': 'The tools you need for the everyday',
    'প্রয়োজনীয় ফিচারগুলো আলাদা করে সাজানো—যাতে কাজ করা, তথ্য দেখা এবং আগের রেকর্ড খুঁজে পাওয়া সহজ হয়।': 'Purposeful tools make it easier to enter updates, review information, and find previous records when you need them.',
    '০১ · মিল পরিকল্পনা': '01 · Meal planning',
    'আগাম মিল সাজানো ও অনুরোধ': 'Plan meals ahead and manage requests',
    'তারিখ নির্বাচন করে মিলের পরিমাণ ঠিক করুন, নতুন দিনের পরিকল্পনা তৈরি করুন এবং অনুরোধের অবস্থা দেখুন।': 'Choose a date, set meal quantities, prepare a plan for a new day, and review the status of requests.',
    'মিল অনুরোধ · দিন তৈরি': 'Meal requests · Daily planning',
    '০২ · বাজার ব্যবস্থাপনা': '02 · Shopping management',
    'ব্যক্তিগত তথ্য বাদ': 'Personal details excluded',
    'বাজারের হিসাব একসঙ্গে': 'Keep shopping records together',
    'বাজারের আইটেম, পরিমাণ ও খরচ লিখে রাখুন। কোন জিনিসে কত খরচ হয়েছে, পরে তা যাচাই করা সহজ হবে।': 'Record shopping items, quantities, and costs. Review later what was purchased and how much was spent on each item.',
    'বাজার এন্ট্রি · আইটেম তালিকা': 'Shopping entries · Item list',
    '০৩ · জমা ও ডিপোজিট': '03 · Deposits',
    'নমুনা পরিচয়': 'Sample identity',
    'সদস্যদের জমার রেকর্ড': 'Record member deposits',
    'সদস্য নির্বাচন করে জমার পরিমাণ ও বিবরণ সংরক্ষণ করুন। জমার তথ্য আলাদা রেকর্ড হিসেবে দেখা যাবে।': 'Select a member and save the deposit amount with its details. Deposit information remains available as a separate record.',
    'ডিপোজিট · জমা সংরক্ষণ': 'Deposits · Saved entries',
    '০৪ · আলাদা হিসাব': '04 · Separate records',
    'পারিশ্রমিকের পৃথক রেকর্ড': 'Keep separate payment records',
    'মাস ও তারিখ নির্বাচন করে নির্দিষ্ট পারিশ্রমিকের পরিমাণ ও বিবরণ যোগ করুন; সংশ্লিষ্ট হিসাব আলাদাভাবে রাখুন।': 'Choose a month and date, then record the relevant payment amount and details separately.',
    'খালার টাকা · মাসভিত্তিক হিসাব': 'Household staff payments · Monthly records',
    'সহজ ব্যবহার': 'A simple workflow',
    'শুরু থেকে হিসাব দেখা—একটি সহজ ধারা': 'From your first sign-in to reviewing records',
    'দৈনন্দিন ব্যবস্থাপনার প্রয়োজনীয় কাজগুলো একই অ্যাপের মধ্যে ধারাবাহিকভাবে করা যায়।': 'Handle the essential tasks of shared living in a connected, step-by-step workflow.',
    '১': '1',
    'অ্যাকাউন্টে প্রবেশ': 'Sign in',
    'নিজের অ্যাকাউন্ট তৈরি বা লগইন': 'Create an account or log in',
    '২': '2',
    'দৈনিক তথ্য যোগ': 'Add daily updates',
    'মিল, বাজার ও জমার এন্ট্রি': 'Enter meals, shopping, and deposits',
    '৩': '3',
    'রেকর্ড পর্যালোচনা': 'Review records',
    'ইতিহাস ও মাসিক সারসংক্ষেপ': 'History and monthly summaries',
    'Hostel Life হিসাব ও রেকর্ড ব্যবস্থাপনার অ্যাপ—এটি নিজে পেমেন্ট গেটওয়ে নয় এবং সরাসরি টাকা গ্রহণ বা স্থানান্তর করে না।': 'Hostel Life is an app for managing accounts and records. It is not a payment gateway and does not directly receive or transfer money.',
    'মেসের কাজ গুছিয়ে শুরু করুন': 'Bring your shared-home routine into focus',
    'নতুন হলে অ্যাকাউন্ট তৈরি করুন, আগে থেকে থাকলে সরাসরি প্রবেশ করুন।': 'Create an account to get started, or log in if you already have one.',
    'পরিচিতি': 'About',
    'যোগাযোগ': 'Contact',
    'গোপনীয়তা নীতি — Hostel Life': 'Privacy Policy — Hostel Life',
    'গোপনীয়তা নীতি': 'Privacy Policy',
    'আপনার তথ্য, আপনার নিয়ন্ত্রণ': 'Your information. Your choices.',
    'Hostel Life ব্যবহার করার সময় কোন তথ্য ব্যবহৃত হয়, কেন প্রয়োজন হয় এবং আপনার তথ্যের বিষয়ে কীভাবে যোগাযোগ বা অনুরোধ জানাবেন—এই পাতায় তা পরিষ্কারভাবে তুলে ধরা হয়েছে।': 'This policy explains what information may be used when you use Hostel Life, why it is needed, and how to contact us about a privacy-related request.',
    'সর্বশেষ হালনাগাদ: ৫ নভেম্বর ২০২৬': 'Last updated: November 5, 2026',
    'আমরা কেবল Hostel Life পরিচালনা, প্রয়োজনীয় ফিচার চালানো এবং ব্যবহারকারীকে সহায়তা দেওয়ার জন্য প্রাসঙ্গিক তথ্য ব্যবহার করার লক্ষ্য রাখি। আপনার মেসের তথ্য কারা দেখতে পারবেন, তা সংশ্লিষ্ট মেসের ভূমিকা ও অনুমতির ওপর নির্ভর করে।': 'We aim to use relevant information to operate Hostel Life, provide its features, and assist users. Who can view information from your hostel depends on the roles and permissions within that hostel.',
    '০১': '01',
    'কোন তথ্য ব্যবহৃত হয়': 'Information we may use',
    'অ্যাকাউন্ট তৈরি ও ব্যবহার করার সময় আপনার দেওয়া নাম, ইমেইল, মোবাইল নম্বর এবং প্রোফাইল ছবি ব্যবহার হতে পারে। আপনি যে মেসে যুক্ত থাকবেন, সেখানে সদস্য, মিল, বাজার, জমা, খরচ, নোটিশ, অনুরোধ ও সংশ্লিষ্ট হিসাবের তথ্যও সেবা পরিচালনার জন্য প্রক্রিয়া করা হয়।': 'When you create and use an account, information you provide may include your name, email address, mobile number, and profile photo. To provide the service, we also process relevant information from the hostel you join, such as member details, meals, shopping, deposits, expenses, notices, requests, and related records.',
    'লগইন সেশন, নিরাপত্তা এবং অ্যাপ সচল রাখার জন্য সীমিত ব্রাউজার বা ডিভাইস-সংক্রান্ত তথ্য এবং কিছু অ্যাপ-সেটিংস স্থানীয়ভাবে সংরক্ষিত থাকতে পারে।': 'Limited browser or device-related information and some app settings may be stored locally to maintain sign-in sessions, support security, and keep the app working.',
    '০২': '02',
    'তথ্য ব্যবহারের উদ্দেশ্য': 'Why information is used',
    'অ্যাকাউন্ট ও সদস্য ব্যবস্থাপনা, মেসে যোগদান, দৈনিক মিল ও বাজারের হিসাব, জমা-খরচের রেকর্ড, রিপোর্ট, নোটিফিকেশন, নিরাপত্তা এবং ব্যবহারকারীকে সহায়তা দেওয়ার জন্য প্রয়োজনীয় তথ্য ব্যবহার করা হয়। অপ্রয়োজনীয় ব্যক্তিগত তথ্য সংগ্রহ করা এই সেবার উদ্দেশ্য নয়।': 'Information is used as needed for account and member management, joining a hostel, daily meal and shopping records, deposits and expenses, reports, notifications, security, and user support. Collecting unnecessary personal information is not the purpose of this service.',
    '০৩': '03',
    'আপনার তথ্য কারা দেখতে পারেন': 'Who can see your information',
    'আপনি যে মেসে যুক্ত থাকবেন, সেই মেসের অন্য সদস্যরা তাঁদের নির্ধারিত ভূমিকা ও অনুমতি অনুযায়ী সদস্য তালিকা, মিল, বাজার, জমা-খরচ এবং সংশ্লিষ্ট কিছু রেকর্ড দেখতে পারেন। কোন তথ্য কার কাছে দৃশ্যমান হবে, তা অ্যাপের প্রবেশাধিকার ও ব্যবস্থাপনা-সেটিংসের ওপর নির্ভর করে।': 'Other members of the hostel you join may be able to view member lists, meals, shopping, deposits, expenses, and certain related records according to their assigned roles and permissions. Visibility depends on the app’s access controls and management settings.',
    'মেসের নোট, বিবরণ বা রেকর্ডে প্রয়োজনের বাইরে ব্যক্তিগত তথ্য না দেওয়াই ভালো।': 'Avoid adding personal information to hostel notes, descriptions, or records unless it is genuinely necessary.',
    '০৪': '04',
    'তথ্য শেয়ার ও সংযুক্ত সেবা': 'Information sharing and connected services',
    'ওয়েবসাইট সচল রাখা, নিরাপদ লগইন, তথ্য সংরক্ষণ এবং প্রয়োজনীয় নোটিফিকেশন দেওয়ার জন্য সংশ্লিষ্ট প্রযুক্তিগত সেবাদাতার মাধ্যমে সীমিত তথ্য প্রক্রিয়া হতে পারে। সেবা দেওয়ার প্রয়োজন ছাড়া ব্যবহারকারীর ব্যক্তিগত তথ্য বিক্রি বা ভাড়া দেওয়া হয় না।': 'Limited information may be processed by relevant technology providers to keep the website available, support secure sign-in, store information, and deliver necessary notifications. Users’ personal information is not sold or rented out except where processing is needed to provide the service.',
    'আপনি স্বেচ্ছায় Telegram সংযুক্ত করলে নোটিফিকেশন পাঠানোর জন্য প্রয়োজনীয় Telegram পরিচিতি ও বার্তা ব্যবহার হতে পারে। Google Sign-In বর্তমানে অ্যাপে সক্রিয় নয়। ভবিষ্যতে চালু করা হলে Google থেকে পাওয়া মৌলিক পরিচয়-তথ্য কীভাবে ব্যবহৃত হবে, তা জানিয়ে এই নীতি হালনাগাদ করা হবে।': 'If you choose to connect Telegram, the Telegram contact details and message information needed to send notifications may be used. Google Sign-In is not currently active in the app. If it is introduced in the future, this policy will be updated to explain how basic identity information received from Google is used.',
    '০৫': '05',
    'তথ্য সংরক্ষণ ও আপনার নিয়ন্ত্রণ': 'Data retention and your choices',
    'অ্যাকাউন্ট পরিচালনা, মেসের রেকর্ডের ধারাবাহিকতা এবং সেবা দেওয়ার প্রয়োজন অনুযায়ী তথ্য সংরক্ষণ করা হয়। আপনার অ্যাকাউন্ট বা ব্যক্তিগত তথ্য সংশোধন কিংবা মুছে ফেলার অনুরোধ জানাতে নিচের যোগাযোগ লিংক ব্যবহার করতে পারেন।': 'Information is retained as needed to manage accounts, preserve the continuity of hostel records, and provide the service. You can use the contact link below to request a correction or deletion of your account or personal information.',
    'কোনো তথ্য মুছে ফেললে মেসের যৌথ হিসাব বা অন্য সদস্যদের রেকর্ডে প্রভাব পড়তে পারে। তাই অনুরোধটি যাচাই করে সংশ্লিষ্ট রেকর্ডের ধারাবাহিকতা বিবেচনায় ব্যবস্থা নেওয়া হবে।': 'Deleting information may affect shared hostel accounts or records belonging to other members. Requests are therefore reviewed with the continuity of relevant records in mind.',
    '০৬': '06',
    'তথ্যের নিরাপত্তা': 'Information security',
    'অ্যাকাউন্ট ও সংরক্ষিত তথ্য সুরক্ষায় উপযুক্ত প্রযুক্তিগত ও পরিচালনাগত ব্যবস্থা ব্যবহারের চেষ্টা করা হয়। তবুও ইন্টারনেটভিত্তিক কোনো সেবাই শতভাগ ঝুঁকিমুক্ত নয়। নিজের পাসওয়ার্ড ও OTP গোপন রাখুন, অপরিচিত ডিভাইস থেকে ব্যবহার শেষে লগআউট করুন এবং সন্দেহজনক কার্যক্রম দেখলে যোগাযোগ করুন।': 'We seek to use appropriate technical and operational measures to protect accounts and stored information. However, no internet-based service is entirely free of risk. Keep your password and OTP private, sign out after using an unfamiliar device, and contact us if you notice suspicious activity.',
    '০৭': '07',
    'বয়স-যোগ্যতা': 'Age requirement',
    'বর্তমানে Hostel Life-এ অ্যাকাউন্ট তৈরি করতে ব্যবহারকারীর বয়স কমপক্ষে ১৮ বছর হতে হবে। নিবন্ধনের সময় ব্যবহারকারী নিজেই এই বয়স-যোগ্যতা নিশ্চিত করেন। এই ঘোষণার জন্য আলাদা জন্মতারিখ বা পরিচয়পত্র সংগ্রহ করা হয় না।': 'Users must currently be at least 18 years old to create a Hostel Life account. Users confirm that they meet this age requirement during registration. A separate date of birth or identity document is not collected for this declaration.',
    'তথ্য বা অ্যাকাউন্ট নিয়ে সহায়তা প্রয়োজন?': 'Need help with your information or account?',
    'আপনার তথ্য সংশোধন, মুছে ফেলার অনুরোধ বা গোপনীয়তা-সংক্রান্ত প্রশ্নের জন্য আমাদের সঙ্গে যোগাযোগ করুন।': 'Contact us to request a correction or deletion of your information, or to ask a privacy-related question.',
    'যোগাযোগ করুন ↗': 'Contact us ↗',
    'ব্যবহারের শর্তাবলী — Hostel Life': 'Terms of Service — Hostel Life',
    'গোপনীয়তা নীতি': 'Privacy Policy',
    'ব্যবহারের শর্তাবলী': 'Terms of Service',
    'সেবা ব্যবহারের সহজ নিয়ম': 'A few clear principles for using the service',
    'Hostel Life ব্যবহার করার আগে এই নিয়মগুলো জেনে নিন। অ্যাকাউন্ট তৈরি বা সেবা ব্যবহার করলে নিচের শর্তগুলো মেনে চলতে হবে।': 'Please review these terms before using Hostel Life. By creating an account or using the service, you agree to follow the terms below.',
    'Hostel Life মেস ও হোস্টেলের দৈনন্দিন ব্যবস্থাপনা এবং হিসাবের রেকর্ড গুছিয়ে রাখার একটি ওয়েব অ্যাপ। সেবাটি সঠিকভাবে ও অন্য ব্যবহারকারীর অধিকার সম্মান করে ব্যবহার করাই এই শর্তগুলোর উদ্দেশ্য।': 'Hostel Life is a web app that helps organise everyday hostel operations and accounting records. These terms are intended to support proper use of the service while respecting the rights of other users.',
    'সেবার উদ্দেশ্য': 'Purpose and scope of the service',
    'Hostel Life সদস্য, মিল, বাজার, জমা-খরচ, নোটিশ, অনুরোধ ও সংশ্লিষ্ট হিসাবের রেকর্ড সংরক্ষণ ও দেখাতে সহায়তা করে। অ্যাপটি হিসাব ও তথ্য ব্যবস্থাপনার মাধ্যম; অ্যাপটি নিজে পেমেন্ট গেটওয়ে নয় এবং সরাসরি টাকা গ্রহণ, সংরক্ষণ বা স্থানান্তর করে না।': 'Hostel Life helps users maintain and view records related to members, meals, shopping, deposits, expenses, notices, requests, and related accounts. The app is a record and information management tool; it is not a payment gateway and does not directly receive, hold, or transfer money.',
    'ব্যবহারের যোগ্যতা': 'Eligibility and accurate information',
    'বর্তমানে অ্যাকাউন্ট তৈরি ও ব্যবহার করার জন্য আপনার বয়স কমপক্ষে ১৮ বছর হতে হবে। নিবন্ধনের সময় দেওয়া তথ্য সঠিক রাখুন। এই বয়স-যোগ্যতা পূরণ না হলে অ্যাকাউন্ট তৈরি করবেন না।': 'You must currently be at least 18 years old to create and use an account. Keep the information you provide during registration accurate. Do not create an account if you do not meet this age requirement.',
    'অ্যাকাউন্ট ও নিরাপত্তা': 'Account security and personal responsibility',
    'নিজের অ্যাকাউন্টের লগইন তথ্য, পাসওয়ার্ড ও OTP গোপন রাখুন। আপনার অ্যাকাউন্ট দিয়ে সম্পন্ন কার্যক্রমের দায়িত্ব আপনার। অন্য কারও অ্যাকাউন্ট অনুমতি ছাড়া ব্যবহার করবেন না এবং সন্দেহজনক প্রবেশ বা কার্যক্রম দেখলে দ্রুত যোগাযোগ করুন।': 'Keep your account credentials, password, and OTP confidential. You are responsible for activity carried out through your account. Do not use another person’s account without permission, and contact us promptly if you notice suspicious access or activity.',
    'ভূমিকা ও অনুমতি': 'Roles and permissions',
    'মেসে প্রত্যেক ব্যবহারকারীর নির্ধারিত ভূমিকা অনুযায়ী ফিচার দেখা বা ব্যবহার করা যায়। ম্যানেজার বা অনুমোদিত দায়িত্বপ্রাপ্ত ব্যক্তি সদস্য ও মেসের ব্যবস্থাপনা পরিচালনা করতে পারেন। অনুমতি ছাড়া অন্যের তথ্য পরিবর্তন, মুছে ফেলা বা ব্যবস্থাপনায় হস্তক্ষেপ করা যাবে না।': 'Each user can view or use features according to their assigned role in the hostel. A manager or another authorised person may manage members and hostel operations. You must not alter or delete another person’s information or interfere with management without permission.',
    'দায়িত্বশীল ব্যবহার': 'Responsible and acceptable use',
    'মিল, বাজার, জমা ও খরচের তথ্য যথাসম্ভব সঠিকভাবে লিখুন। অন্যের ব্যক্তিগত তথ্য বা অ্যাকাউন্ট অনুমতি ছাড়া ব্যবহার করবেন না। প্রতারণা, হয়রানি, অননুমোদিত প্রবেশ, ভুল তথ্য ছড়ানো বা সেবার স্বাভাবিক কার্যক্রমে বাধা সৃষ্টি করে—এমন কাজ করা যাবে না।': 'Enter meal, shopping, deposit, and expense information as accurately as possible. Do not use another person’s personal information or account without permission. Fraud, harassment, unauthorised access, spreading false information, or disrupting the normal operation of the service is not allowed.',
    'ওয়েবসাইটের সাধারণ ঠিকানা বা Hostel Life-এর পরিচিতি পেজ প্রকাশ্যে শেয়ার করা যায়। ব্যক্তিগত Join Code, Invitation Link বা প্রবেশের তথ্য কেবল অনুমোদিত ব্যক্তির সঙ্গে ভাগ করুন।': 'You may publicly share the website address or the Hostel Life introduction page. Share private Join Codes, Invitation Links, and access credentials only with authorised people.',
    'হিসাব ও রেকর্ডের দায়িত্ব': 'Accuracy and review of records',
    'অ্যাপে দেখানো হিসাব ব্যবহারকারীদের দেওয়া তথ্যের ভিত্তিতে তৈরি হয়। গুরুত্বপূর্ণ এন্ট্রি, জমা, বাজারের খরচ ও মাসিক রিপোর্ট নিয়মিত যাচাই করুন। কোনো ভুল রেকর্ড থাকলে সংশ্লিষ্ট অনুমোদিত দায়িত্বপ্রাপ্ত ব্যক্তির সঙ্গে যোগাযোগ করুন। প্রয়োজনীয় হিসাবের কপি নিজেদের কাছেও সংরক্ষণ করুন।': 'The accounts shown in the app are based on information entered by users. Regularly review important entries, deposits, shopping expenses, and monthly reports. If you find an incorrect record, contact the relevant authorised person. Keep your own copies of important records where needed.',
    'সেবার প্রাপ্যতা ও পরিবর্তন': 'Service availability and changes',
    'রক্ষণাবেক্ষণ, নেটওয়ার্ক বা প্রযুক্তিগত কারণে কোনো ফিচার সাময়িকভাবে কাজ নাও করতে পারে। নিরাপত্তা ও স্থিতিশীলতা বজায় রাখতে প্রয়োজন হলে সেবার কিছু অংশ হালনাগাদ বা সাময়িকভাবে সীমিত করা হতে পারে। গুরুত্বপূর্ণ পরিবর্তন ওয়েবসাইট বা অ্যাপের মাধ্যমে জানানো হবে।': 'A feature may be temporarily unavailable due to maintenance, network conditions, or technical issues. Parts of the service may be updated or temporarily limited when needed to maintain security and stability. Important changes will be communicated through the website or app.',
    'শর্তাবলী বা অ্যাকাউন্ট নিয়ে প্রশ্ন আছে?': 'Questions about these terms or your account?',
    'সেবা ব্যবহার, অ্যাকাউন্ট বা কোনো নিয়ম সম্পর্কে সহায়তার জন্য আমাদের সঙ্গে যোগাযোগ করুন।': 'Contact us for help with using the service, your account, or any of these terms.',
    'Copyright ©': 'Copyright ©',
    'Hostel Life পরিচিতি': 'About Hostel Life',
    'প্রধান নেভিগেশন': 'Main navigation',
    'অ্যাকাউন্ট': 'Account',
    'মেনু খুলুন': 'Open menu',
    'মোবাইল নেভিগেশন': 'Mobile navigation',
    'মূল সুবিধা': 'Key benefits',
    'Hostel Life অ্যাপের বাস্তব স্ক্রিন প্রিভিউ': 'Preview of actual Hostel Life app screens',
    'Hostel Life ড্যাশবোর্ডে আজকের মিলের সারসংক্ষেপ': 'Today’s meal summary on the Hostel Life dashboard',
    'ডাইনিং সেকশনে মিল অনুরোধ, বাজার এন্ট্রি ও ডিপোজিটের অপশন': 'Meal requests, shopping entries, and deposit options in the Dining section',
    'প্রধান কাজের ক্ষেত্র': 'Key areas of the app',
    'নতুন মিল অনুরোধ তৈরি এবং তারিখ অনুযায়ী মিল সাজানোর স্ক্রিন': 'Screen for creating meal requests and arranging meals by date',
    'বাজারের আইটেম, পরিমাণ ও টাকার অঙ্ক যুক্ত করার স্ক্রিন; ব্যক্তিগত সদস্য তথ্য বাদ দেওয়া হয়েছে': 'Screen for adding shopping items, quantities, and costs; personal member details are excluded',
    'ডিপোজিট সংরক্ষণের স্ক্রিন; ব্যক্তিগত সদস্যের নামের বদলে নমুনা পরিচয় ব্যবহার করা হয়েছে': 'Deposit screen using a sample identity instead of a member’s personal name',
    'খালার টাকা বা পারিশ্রমিকের হিসাব যোগ করার স্ক্রিন': 'Screen for recording household staff payments or allowances',
    'Hostel Life হোম': 'Hostel Life home',
    'সহায়ক লিংক': 'Helpful links',
    'গোপনীয়তা নীতির সম্পূর্ণ বিবরণ': 'Full privacy policy',
    'ব্যবহারের শর্তাবলীর সম্পূর্ণ বিবরণ': 'Full terms of service',
    'Breadcrumb': 'Breadcrumb',
    'আইনি তথ্য': 'Legal information'
  };

  let language = 'bn';
  let originalTextNodes = [];
  let originalAttributes = [];

  function rememberOriginalContent() {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) originalTextNodes.push({ node, value: node.nodeValue });

    const elements = document.querySelectorAll('[alt], [aria-label], [title], [content]');
    for (const element of elements) {
      for (const attribute of ['alt', 'aria-label', 'title', 'content']) {
        if (element.hasAttribute(attribute)) originalAttributes.push({ element, attribute, value: element.getAttribute(attribute) });
      }
    }
  }

  function translateText(value) {
    const trimmed = value.trim();
    const translated = translations[trimmed];
    if (translated === undefined) return value;
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    return `${leading}${translated}${trailing}`;
  }

  function applyLanguage(nextLanguage) {
    language = nextLanguage === 'en' ? 'en' : 'bn';
    if (language === 'en') {
      for (const item of originalTextNodes) item.node.nodeValue = translateText(item.value);
      for (const item of originalAttributes) {
        const translated = translations[item.value.trim()];
        if (translated !== undefined) item.element.setAttribute(item.attribute, translated);
      }
    } else {
      for (const item of originalTextNodes) item.node.nodeValue = item.value;
      for (const item of originalAttributes) item.element.setAttribute(item.attribute, item.value);
    }

    document.documentElement.lang = language === 'en' ? 'en' : 'bn-BD';
    const toggle = document.getElementById('language-toggle');
    const label = document.getElementById('language-toggle-label');
    if (toggle && label) {
      label.textContent = language === 'en' ? 'বাংলা' : 'English';
      toggle.setAttribute('aria-label', language === 'en' ? 'Switch language to Bengali' : 'ভাষা ইংরেজিতে পরিবর্তন করুন');
      toggle.setAttribute('title', language === 'en' ? 'Switch to Bengali' : 'ইংরেজিতে পরিবর্তন করুন');
      toggle.setAttribute('aria-pressed', String(language === 'en'));
    }
    document.documentElement.dataset.publicLanguage = language;
  }

  function readSavedLanguage() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  }

  function saveLanguage(nextLanguage) {
    try { localStorage.setItem(STORAGE_KEY, nextLanguage); } catch { /* Continue for this page if storage is unavailable. */ }
  }

  rememberOriginalContent();
  applyLanguage(readSavedLanguage());

  const toggle = document.getElementById('language-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const nextLanguage = language === 'bn' ? 'en' : 'bn';
      saveLanguage(nextLanguage);
      applyLanguage(nextLanguage);
    });
  }
})();
