const TIME_ZONE = 'Asia/Dhaka';

function parseIsoParts(dateValue) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== dateValue) return null;
  return date;
}

export function addDhakaCalendarDays(dateValue, amount = 1) {
  const date = parseIsoParts(dateValue);
  if (!date || !Number.isInteger(amount)) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function getDhakaDateTimeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date/time is required.');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  return {
    ...values,
    today,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    seconds: Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second),
  };
}

/**
 * A future-start period is only allowed to be activated on the evening before
 * its first meal date, from 8 PM Dhaka time. If that date has already arrived,
 * delayed activation remains possible (Rule A); backend enforces the same rule.
 */
export function canActivateNextPeriod(startDate, value = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) return false;
  const clock = getDhakaDateTimeParts(value);
  if (startDate <= clock.today) return true;
  return startDate === addDhakaCalendarDays(clock.today, 1) && clock.minutes >= 20 * 60;
}

export function getNextPeriodActivationMessage(startDate, value = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) return 'নতুন মাসের শুরুর তারিখ নিশ্চিত করা যায়নি।';
  const clock = getDhakaDateTimeParts(value);
  const tomorrow = addDhakaCalendarDays(clock.today, 1);
  if (startDate === tomorrow && clock.minutes < 20 * 60) {
    return `নতুন মাসের প্রথম মিলের দিন ${startDate}। আজ রাত ৮টার পর এই মাস চালু করা যাবে।`;
  }
  if (startDate > tomorrow) {
    return 'নির্ধারিত প্রথম মিলের দিন আগামীকালেরও পরে। এই তারিখের আগের রাতে রাত ৮টার পর নতুন মাস চালু করা যাবে।';
  }
  if (startDate < clock.today) {
    if (clock.minutes < 22 * 60) {
      return `নতুন মাস চালু করা যাবে, তবে প্রথম মিলের দিন ${startDate} ইতিমধ্যে পেরিয়ে গেছে। আগামীকাল ও পরবর্তী দিনের জন্য রাত ১০টা পর্যন্ত সাধারণ অনুরোধ দেওয়া যাবে।`;
    }
    return `নতুন মাস চালু করা যাবে, তবে প্রথম মিলের দিন ${startDate} ইতিমধ্যে পেরিয়ে গেছে। এখন আগামীকালের জন্য Late Request এবং পরের দিনগুলোর জন্য নির্ধারিত অনুরোধ-সময় অনুসরণ করুন।`;
  }
  if (startDate === clock.today) {
    if (clock.minutes < 21 * 60) {
      return 'নতুন মাস চালু করা যাবে, তবে প্রথম মিলের দিন আজ। আজকের জন্য সাধারণ অনুরোধের সময় আগের রাত ১০টায় শেষ হয়েছে; আজ রাত ৯টার আগে Late Request দিয়ে ম্যানেজারের অনুমোদন নিতে হবে। আগামীকালের জন্য রাত ১০টা পর্যন্ত সাধারণ অনুরোধ দেওয়া যাবে।';
    }
    if (clock.minutes < 22 * 60) {
      return 'নতুন মাস চালু করা যাবে, তবে আজকের ৯টার Finalization সময় পেরিয়ে গেছে। আজকের মিলের জন্য আর অনুরোধ দেওয়া যাবে না; আগামীকালের জন্য রাত ১০টা পর্যন্ত সাধারণ অনুরোধ দেওয়া যাবে।';
    }
    return 'নতুন মাস চালু করা যাবে, তবে আজকের ৯টার Finalization সময় পেরিয়ে গেছে। আজকের মিলের জন্য আর অনুরোধ দেওয়া যাবে না; আগামীকালের জন্য Late Request পদ্ধতি প্রযোজ্য।';
  }
  if (clock.minutes < 22 * 60) {
    const remaining = 22 * 60 - clock.minutes;
    const hours = Math.floor(remaining / 60);
    const minutes = remaining % 60;
    const remainingText = hours > 0 ? `${hours} ঘণ্টা ${minutes} মিনিট` : `${minutes} মিনিট`;
    return `নতুন মাস চালু করা যাবে। প্রথম দিনের স্বাভাবিক মিল অনুরোধ রাত ১০টা পর্যন্ত গ্রহণ করা হবে; এখন প্রায় ${remainingText} সময় বাকি।`;
  }
  return 'নতুন মাস চালু করা যাবে। তবে রাত ১০টার স্বাভাবিক অনুরোধের সময় শেষ; প্রথম দিনের জন্য Late Request পদ্ধতি ব্যবহার করতে হবে।';
}

export function getMemberDeactivationImpact(value = new Date(), periodStartDate = '') {
  const clock = getDhakaDateTimeParts(value);
  if (!periodStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(periodStartDate))) {
    return { rule: 'no_running_period', beforeFinalization: clock.minutes < 21 * 60 };
  }
  if (periodStartDate > clock.today) {
    return { rule: 'not_in_period', beforeFinalization: clock.minutes < 21 * 60 };
  }
  return {
    rule: clock.minutes < 21 * 60 ? 'cancel' : 'preserve',
    beforeFinalization: clock.minutes < 21 * 60,
  };
}
