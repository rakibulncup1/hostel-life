import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { OfflineState } from '../../components/OfflineState';
import { useAuth } from '../../contexts/AuthContext';
import { useManagementContext } from '../../hooks/useManagementContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../components/Toast';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { fetchManagerMemberDirectory } from '../../services/diningService';

import {
  addManagerDeposit,
  addManagerOtherExpense,
  createMarketEntry,
  createMealCorrectionRequest,
  createMealRequest,
  createLateMealRequest,
  reviewLateMealRequest,
  createMemberMealRequest,
  editApprovedMealRequest,
  fetchManagerMealRequests,
  fetchMealDayStates,
  fetchMealEntryData,
  fetchMemberDirectory,
  fetchMyMealRequests,
  fetchRunningPeriod,
  reviewMealCorrection,
  setManagerMealEntries,
} from '../../services/diningService';
import { emergencyOverrideMyMeal, saveManagerMyMeal, checkManagerMealEntryConflicts, managerEditApprovedMealRequest } from '../../services/managerService';
import { formatDateWithWeekday, isBangladeshWeekend, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';
import { canCorrectMealDay, canSubmitMealDay, getMealDayStatusText } from '../../utils/mealPolicy';

const DEFAULT_MEALS = { breakfast: 0.5, lunch: 1, dinner: 1 };

function todayValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDateDays(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function tomorrowValue() {
  return addDateDays(todayValue(), 1);
}

function clampMeal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(50, Math.round(number * 2) / 2));
}

function makeDay(date, defaults = DEFAULT_MEALS) {
  return {
    meal_date: date,
    breakfast: defaults.breakfast,
    lunch: defaults.lunch,
    dinner: defaults.dinner,
  };
}

function buildDateRange(startDate, endDate, defaults = DEFAULT_MEALS) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const days = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    days.push(makeDay(toDateInputValue(date), defaults));
  }
  return days;
}

function normalizeDays(days = []) {
  return days.map((day) => ({
    meal_date: String(day.meal_date).slice(0, 10),
    breakfast: clampMeal(day.breakfast),
    lunch: clampMeal(day.lunch),
    dinner: clampMeal(day.dinner),
  }));
}

function totalDays(days) {
  return days.reduce((sum, day) => sum + Number(day.breakfast || 0) + Number(day.lunch || 0) + Number(day.dinner || 0), 0);
}

function getRequestDayMap(request) {
  const map = new Map();
  for (const day of request?.days || []) map.set(String(day.meal_date).slice(0, 10), { ...day });
  return map;
}

function statusText(status) {
  const map = { submitted: 'অপেক্ষমাণ', approved: 'অনুমোদিত', rejected: 'বাতিল', cancelled: 'পুরোনো', void: 'বাতিল' };
  return map[status] || status || '—';
}

function requestTypeText(type, isLate = false) {
  if (isLate) return 'লেট মিল রিকোয়েস্ট';
  return type === 'correction' ? 'সংশোধন রিকোয়েস্ট' : 'মিল রিকোয়েস্ট';
}

function dhakaNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function normalRequestTimeLeft() {
  const parts = dhakaNowParts();
  const nowMinutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  const cutoffMinutes = 22 * 60;
  if (nowMinutes >= cutoffMinutes) return null;
  const remaining = cutoffMinutes - nowMinutes;
  return `${Math.floor(remaining / 60)} ঘণ্টা ${remaining % 60} মিনিট`;
}

function lateMealRequestTargetDate() {
  const parts = dhakaNowParts();
  const nowMinutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  // 9–10 PM is a transition gap: today's card is finalized, tomorrow's normal cutoff has not started.
  if (nowMinutes >= 21 * 60 && nowMinutes < 22 * 60) return null;
  return nowMinutes >= 22 * 60 ? tomorrowValue() : todayValue();
}

function MealValuePills({ day, compact = false }) {
  const items = [
    ['ব্রেকফাস্ট', day?.breakfast],
    ['লাঞ্চ', day?.lunch],
    ['ডিনার', day?.dinner],
  ];
  return (
    <div className={`meal-value-pills ${compact ? 'compact' : ''}`}>
      {items.map(([label, value]) => (
        <span className="meal-value-pill" key={label}>
          <small>{label}</small>
          <strong>{formatMealCompact(value)}</strong>
        </span>
      ))}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }) {
  return (
    <div className="page-title-row dining-section-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

function DiningOptionCard({ icon, title, description, onClick, badge }) {
  return (
    <button className="card dining-option-card" onClick={onClick} type="button">
      <span className="dining-option-icon"><Icon name={icon} size={22} /></span>
      <span className="dining-option-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {badge && <span className="power-badge">পাওয়ার</span>}
      <Icon name="chevron" size={18} className="dining-option-arrow" />
    </button>
  );
}

function MealStepper({ label, value, onChange, readOnly = false }) {
  const safe = clampMeal(value);
  return (
    <div className="meal-stepper-row">
      <span>{label}</span>
      <div className="meal-stepper">
        <button type="button" disabled={readOnly} onClick={() => onChange(clampMeal(safe - 0.5))} aria-label={`${label} কমান`}>−</button>
        <strong>{formatMealCompact(safe)}</strong>
        <button type="button" disabled={readOnly} onClick={() => onChange(clampMeal(safe + 0.5))} aria-label={`${label} বাড়ান`}>+</button>
      </div>
    </div>
  );
}

function formatMealCompact(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '০';
  if (Number.isInteger(number)) return formatNumber(number, { maximumFractionDigits: 0 });
  return formatNumber(number, { maximumFractionDigits: 2 });
}

function MealDayCard({ day, onChange, readOnly = false, compact = false }) {
  const weekend = isBangladeshWeekend(day.meal_date);
  return (
    <article className={`card meal-day-card ${weekend ? 'weekend-day' : ''} ${compact ? 'compact-day-card' : ''}`}>
      <div className="meal-day-card-header">
        <div>
          <strong>{formatDateWithWeekday(day.meal_date)}</strong>
          <small>{weekend ? 'সাপ্তাহিক বন্ধ' : 'সাধারণ দিন'}</small>
        </div>
        {weekend && <span className="weekend-badge">বন্ধ</span>}
      </div>
      <div className="meal-day-fields">
        {['breakfast', 'lunch', 'dinner'].map((key) => (
          <MealStepper
            key={key}
            label={key === 'breakfast' ? 'ব্রেকফাস্ট' : key === 'lunch' ? 'লাঞ্চ' : 'ডিনার'}
            value={day[key]}
            onChange={(next) => !readOnly && onChange({ ...day, [key]: next })}
            readOnly={readOnly}
          />
        ))}
      </div>
      <div className="meal-day-total">মোট: <strong>{formatMealCompact(Number(day.breakfast || 0) + Number(day.lunch || 0) + Number(day.dinner || 0))}</strong> মিল</div>
    </article>
  );
}

function MealRequestEditor({ mode, request, onSaved, onCancel }) {
  const toast = useToast();
  const today = todayValue();
  const originalDays = useMemo(() => normalizeDays(request?.days || []), [request]);
  const [startDate, setStartDate] = useState(() => request?.start_date || tomorrowValue());
  const [endDate, setEndDate] = useState(() => request?.end_date || tomorrowValue());
  const [defaults, setDefaults] = useState(DEFAULT_MEALS);
  const [days, setDays] = useState([]);
  const [period, setPeriod] = useState(null);
  const [dayStates, setDayStates] = useState([]);
  const [dayStateLoading, setDayStateLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchRunningPeriod()
      .then((data) => { if (active) setPeriod(data); })
      .catch((error) => toast.error(getFriendlySupabaseError(error, 'চলমান মাসের তথ্য লোড করা যায়নি।')));
    return () => { active = false; };
  }, [toast]);

  useEffect(() => {
    let active = true;
    if (!startDate || !endDate || startDate > endDate) {
      setDayStates([]);
      return undefined;
    }
    setDayStateLoading(true);
    fetchMealDayStates(startDate, endDate, period?.period_id || period?.id || null)
      .then((rows) => { if (active) setDayStates(rows); })
      .catch((error) => {
        if (active) {
          setDayStates([]);
          toast.error(getFriendlySupabaseError(error, 'নির্বাচিত দিনের meal rule যাচাই করা যায়নি।'));
        }
      })
      .finally(() => { if (active) setDayStateLoading(false); });
    return () => { active = false; };
  }, [startDate, endDate, period?.period_id, period?.id, toast]);

  useEffect(() => {
    if (request?.days?.length) {
      const initial = normalizeDays(request.days);
      const usable = mode === 'correction' ? initial.filter((day) => day.meal_date <= today) : mode === 'edit' ? initial.filter((day) => day.meal_date > today) : initial;
      const firstUsable = usable[0]?.meal_date || tomorrowValue();
      const lastUsable = usable.at(-1)?.meal_date || firstUsable;
      setStartDate(mode === 'correction' || mode === 'edit' ? firstUsable : (request.start_date || initial[0]?.meal_date || tomorrowValue()));
      setEndDate(mode === 'correction' || mode === 'edit' ? lastUsable : (request.end_date || initial.at(-1)?.meal_date || tomorrowValue()));
      setDays(usable);
    } else {
      const initialDate = request?.start_date || tomorrowValue();
      const lastDate = request?.end_date || initialDate;
      setStartDate(initialDate);
      setEndDate(lastDate);
      setDays(buildDateRange(initialDate, lastDate, DEFAULT_MEALS));
    }
  }, [request]);

  const isCorrection = mode === 'correction';
  const isEdit = mode === 'edit';
  const dayStateMap = useMemo(() => new Map(dayStates.map((day) => [String(day.meal_date).slice(0, 10), day])), [dayStates]);
  const correctionEligibleDays = useMemo(() => originalDays.filter((day) => canCorrectMealDay(dayStateMap.get(day.meal_date))), [originalDays, dayStateMap]);
  const editEligibleDays = useMemo(() => originalDays.filter((day) => canSubmitMealDay(dayStateMap.get(day.meal_date)) && day.meal_date > today), [originalDays, dayStateMap, today]);
  const title = isCorrection ? 'মিল সংশোধন রিকোয়েস্ট' : isEdit ? 'অনুমোদিত রিকোয়েস্ট এডিট' : 'নতুন মিল রিকোয়েস্ট';
  const helper = isCorrection
    ? 'কাট-অফ পার হওয়া দিনের জন্য ম্যানেজারের অনুমোদন প্রয়োজন।'
    : isEdit
      ? 'শুধু কাট-অফ না হওয়া দিন সরাসরি পরিবর্তন করা যাবে।'
      : 'পরবর্তী দিনের জন্য বা ভবিষ্যৎ তারিখে মিল সাজান।';

  const regenerateDays = () => {
    if (request?.days?.length && isEdit) {
      const map = getRequestDayMap(request);
      setDays(buildDateRange(startDate, endDate, defaults).map((day) => map.get(day.meal_date) || day));
      return;
    }
    setDays(buildDateRange(startDate, endDate, defaults));
  };

  useEffect(() => {
    if (!days.length) regenerateDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyDefaults = () => {
    setDays((current) => current.map((day) => ({ ...day, ...defaults })));
    toast.success('ডিফল্ট মিল সব দিনের কার্ডে বসানো হয়েছে।');
  };

  const updateDay = (next) => {
    setDays((current) => current.map((day) => day.meal_date === next.meal_date ? next : day));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!startDate || !endDate || startDate > endDate) {
      toast.error('শুরুর ও শেষের তারিখ সঠিকভাবে দিন।');
      return;
    }
    if (!days.length) {
      toast.error('কমপক্ষে একটি দিনের মিল তথ্য দিতে হবে।');
      return;
    }
    const payload = normalizeDays(days);
    const payloadDates = payload.map((day) => day.meal_date);
    if (isCorrection) {
      const eligible = correctionEligibleDays.map((day) => day.meal_date);
      if (!eligible.length) {
        toast.warning('এই রিকোয়েস্টে সংশোধনযোগ্য কোনো দিন পাওয়া যায়নি।');
        return;
      }
      if (payloadDates.some((day) => !eligible.includes(day))) {
        toast.warning('শুধু server cutoff পার হওয়া দিনের জন্য সংশোধন রিকোয়েস্ট করা যাবে। দিনটি ইতিমধ্যে final হয়ে থাকলেও manager approval-এর পরে final হিসাব আপডেট হবে।');
        return;
      }
      const fullRange = buildDateRange(startDate, endDate).map((day) => day.meal_date);
      if (fullRange.some((day) => !eligible.includes(day)) || payloadDates.length !== fullRange.length) {
        toast.warning('নির্বাচিত range-এর প্রতিটি দিনের cutoff পার হওয়া থাকতে হবে।');
        return;
      }
    }
    if (isEdit) {
      const eligible = editEligibleDays.map((day) => day.meal_date);
      if (!eligible.length) {
        toast.warning('কাট-অফের আগে পরিবর্তনযোগ্য কোনো ভবিষ্যৎ দিন আর বাকি নেই।');
        return;
      }
      if (startDate <= today) {
        toast.warning('সরাসরি এডিট শুধু ভবিষ্যৎ দিনের জন্য করা যাবে।');
        return;
      }
      if (payloadDates.some((day) => !eligible.includes(day))) {
        toast.warning('নির্বাচিত range-এর কোনো একটি দিনের cutoff শেষ হয়ে গেছে। সেই দিনের জন্য সংশোধন রিকোয়েস্ট ব্যবহার করুন।');
        return;
      }
    }
    if (!isCorrection) {
      try {
        const existingRequests = await fetchMyMealRequests(100);
        const requestedDates = new Set(payloadDates);
        const duplicateDates = [];
        for (const existing of existingRequests) {
          if (existing?.request_id === request?.request_id) continue;
          if (!['submitted', 'approved'].includes(existing?.status)) continue;
          for (const existingDay of existing?.days || []) {
            const date = String(existingDay?.meal_date || '').slice(0, 10);
            if (date && requestedDates.has(date)) duplicateDates.push(date);
          }
        }
        if (duplicateDates.length) {
          const first = [...new Set(duplicateDates)].sort()[0];
          toast.warning(`আপনার ${formatDateWithWeekday(first)}-এর জন্য আগে থেকেই একটি সক্রিয় meal request আছে। একই দিনের জন্য আবার request দেওয়া যাবে না।`);
          return;
        }
      } catch (error) {
        console.warn('Existing meal request overlap pre-check failed:', error);
      }

      if (startDate <= today) {
        toast.warning('আজকের বা আগের দিনের জন্য সাধারণ মিল রিকোয়েস্ট দেওয়া যাবে না।');
        return;
      }
      const unavailable = payloadDates.filter((day) => !canSubmitMealDay(dayStateMap.get(day)));
      if (unavailable.length) {
        toast.warning('নির্বাচিত তারিখগুলোর অন্তত একটি দিনে cutoff শেষ হয়েছে বা দিনটি final হয়েছে।');
        return;
      }
      if (period?.end_date && endDate > period.end_date) {
        toast.warning('মিল রিকোয়েস্ট চলমান মাসের শেষ তারিখের বাইরে দেওয়া যাবে না।');
        return;
      }
    }
    setBusy(true);
    try {
      let result;
      if (isCorrection) {
        result = await createMealCorrectionRequest({
          startDate,
          endDate,
          days: payload,
          parentRequestId: request?.request_id || null,
        });
      } else if (isEdit) {
        result = await editApprovedMealRequest({
          requestId: request.request_id,
          startDate,
          endDate,
          days: payload,
        });
      } else {
        result = await createMealRequest({ startDate, endDate, days: payload });
      }

      if (isCorrection) toast.success('মিল সংশোধন রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে।');
      else if (isEdit) toast.success('মিল রিকোয়েস্ট সফলভাবে আপডেট হয়েছে।');
      else toast.success('মিল রিকোয়েস্ট সফলভাবে সাবমিট ও অনুমোদিত হয়েছে।');
      onSaved?.(result);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিকোয়েস্ট সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">মিল রিকোয়েস্ট</span>
          <h2>{title}</h2>
          <p>{helper}</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button>
      </div>

      {!isCorrection && (
        <div className="request-range-grid">
          <label className="field-label">
            <span>শুরুর তারিখ</span>
            <input type="date" min={tomorrowValue()} max={period?.end_date || undefined} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field-label">
            <span>শেষের তারিখ</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <button className="secondary-button" type="button" onClick={regenerateDays}>
            <Icon name="calendar" size={17} /> দিন তৈরি করুন
          </button>
        </div>
      )}

      {isCorrection && (
        <div className="request-range-grid">
          <label className="field-label">
            <span>সংশোধনের শুরুর তারিখ</span>
            <input type="date" min={correctionEligibleDays[0]?.meal_date} max={correctionEligibleDays.at(-1)?.meal_date} value={startDate} onChange={(e) => {
              const nextStart = e.target.value;
              setStartDate(nextStart);
              const nextEnd = endDate < nextStart ? nextStart : endDate;
              setEndDate(nextEnd);
              const allowed = new Set(correctionEligibleDays.map((day) => day.meal_date));
              setDays(buildDateRange(nextStart, nextEnd, defaults).filter((day) => allowed.has(day.meal_date)).map((day) => getRequestDayMap(request).get(day.meal_date) || day));
            }} />
          </label>
          <label className="field-label">
            <span>সংশোধনের শেষের তারিখ</span>
            <input type="date" min={startDate} max={correctionEligibleDays.at(-1)?.meal_date} value={endDate} onChange={(e) => {
              const nextEnd = e.target.value;
              setEndDate(nextEnd);
              const allowed = new Set(correctionEligibleDays.map((day) => day.meal_date));
              setDays(buildDateRange(startDate, nextEnd, defaults).filter((day) => allowed.has(day.meal_date)).map((day) => getRequestDayMap(request).get(day.meal_date) || day));
            }} />
          </label>
        </div>
      )}

      {isEdit && (
        <div className="request-range-grid">
          <label className="field-label">
            <span>পরিবর্তনের শুরুর তারিখ</span>
            <input type="date" min={editEligibleDays[0]?.meal_date} max={editEligibleDays.at(-1)?.meal_date} value={startDate} onChange={(e) => {
              const nextStart = e.target.value;
              const nextEnd = endDate < nextStart ? nextStart : endDate;
              setStartDate(nextStart);
              setEndDate(nextEnd);
              const allowed = new Set(editEligibleDays.map((day) => day.meal_date));
              setDays(buildDateRange(nextStart, nextEnd, defaults).filter((day) => allowed.has(day.meal_date)).map((day) => getRequestDayMap(request).get(day.meal_date) || day));
            }} />
          </label>
          <label className="field-label">
            <span>পরিবর্তনের শেষের তারিখ</span>
            <input type="date" min={startDate} max={editEligibleDays.at(-1)?.meal_date} value={endDate} onChange={(e) => {
              const nextEnd = e.target.value;
              setEndDate(nextEnd);
              const allowed = new Set(editEligibleDays.map((day) => day.meal_date));
              setDays(buildDateRange(startDate, nextEnd, defaults).filter((day) => allowed.has(day.meal_date)).map((day) => getRequestDayMap(request).get(day.meal_date) || day));
            }} />
          </label>
        </div>
      )}

      {dayStateLoading && (
        <div className="meal-policy-note is-loading"><Icon name="clock" size={15} /> নির্বাচিত দিনের cutoff ও status যাচাই করা হচ্ছে...</div>
      )}
      {!dayStateLoading && (isCorrection ? correctionEligibleDays.length === 0 : isEdit ? editEligibleDays.length === 0 : dayStates.length === 0) && (
        <div className="meal-policy-note is-warning"><Icon name="warning" size={15} /> এই date range-এ এখন submit/edit করার উপযোগী দিন পাওয়া যায়নি। server rule অনুযায়ী তারিখটি পরিবর্তন করুন।</div>
      )}

      <div className="default-meal-box">
        <div>
          <strong>ডিফল্ট মিল</strong>
          <small>সব দিনের জন্য একসাথে বসাতে পারবেন, পরে প্রতিটি দিন আলাদাভাবে পরিবর্তন করতে পারবেন।</small>
        </div>
        <div className="default-meal-controls">
          {[
            ['breakfast', 'ব্রেকফাস্ট'],
            ['lunch', 'লাঞ্চ'],
            ['dinner', 'ডিনার'],
          ].map(([key, label]) => (
            <label className="mini-field" key={key}>
              <span>{label}</span>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={defaults[key]}
                onChange={(e) => setDefaults((current) => ({ ...current, [key]: clampMeal(e.target.value) }))}
              />
            </label>
          ))}
        </div>
        <button className="secondary-button compact" type="button" onClick={applyDefaults}>সব দিনে প্রয়োগ করুন</button>
      </div>

      <div className="request-summary-strip">
        <span>{formatNumber(days.length)} দিন</span>
        <strong>মোট {formatMealCompact(totalDays(days))} মিল</strong>
      </div>

      <div className="meal-days-stack">
        {days.map((day) => (
          <MealDayCard key={day.meal_date} day={day} onChange={updateDay} />
        ))}
      </div>

      <div className="request-footer-note">
        <Icon name="clock" size={16} /> প্রতিটি দিনের cutoff server থেকে নির্ধারিত হয়। cutoff পার হলে সরাসরি পরিবর্তনের বদলে সংশোধন রিকোয়েস্ট ব্যবহার করুন।
      </div>

      <button className="primary-button large dining-submit" type="button" disabled={busy || dayStateLoading} onClick={submit}>
        {busy ? 'সংরক্ষণ হচ্ছে...' : isCorrection ? 'সংশোধন রিকোয়েস্ট পাঠান' : isEdit ? 'পরিবর্তন সংরক্ষণ করুন' : 'চূড়ান্তভাবে সাবমিট করুন'}
      </button>
    </section>
  );
}

function RequestHistory({ onEdit, onCorrect }) {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await fetchMyMealRequests(100));
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মিল রিকোয়েস্ট হিস্টরি লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="dining-panel card"><LoadingSpinner label="রিকোয়েস্ট হিস্টরি লোড হচ্ছে..." /></div>;

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">মিল রিকোয়েস্ট</span>
          <h2>রিকোয়েস্ট হিস্টরি</h2>
          <p>আপনার আগের ও বর্তমান রিকোয়েস্টগুলো এখানে থাকবে।</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={load}><Icon name="refresh" size={15} /> রিফ্রেশ</button>
      </div>

      {requests.length === 0 ? (
        <div className="empty-state-card dining-empty"><Icon name="calendar" size={26} /><strong>এখনও কোনো রিকোয়েস্ট নেই</strong><span>নতুন মিল রিকোয়েস্ট দিলে এখানে দেখা যাবে।</span></div>
      ) : (
        <div className="request-history-list">
          {requests.map((request) => {
            const needsReview = request.status === 'submitted' && (request.request_type === 'correction' || request.is_late_request);
            return <article className="request-history-card" key={request.request_id}>
              <button className="request-history-head" type="button" onClick={() => setSelected(selected === request.request_id ? null : request.request_id)}>
                <span>
                  <strong>{requestTypeText(request.request_type, request.is_late_request)}</strong>
                  <small>{formatDateWithWeekday(request.start_date)} → {formatDateWithWeekday(request.end_date)}</small>
                </span>
                <span className={`request-status request-status-${request.status}`}>
                  {statusText(request.status)}
                </span>
              </button>
              <div className="request-history-meta">
                <span>সাবমিট: {formatDateTime12(request.submitted_at)}</span>
                <strong>মোট {formatMealCompact(totalDays(request.days || []))} মিল</strong>
              </div>

              {selected === request.request_id && (
                <div className="request-history-expanded">
                  <div className="mini-day-list">
                    {(request.days || []).map((day) => (
                      <MealDayCard key={day.meal_date} day={day} onChange={() => {}} readOnly compact />
                    ))}
                  </div>
                  {request.rejection_reason && <div className="inline-error"><Icon name="warning" size={16} /> {request.rejection_reason}</div>}
                  {request.status === 'approved' && request.request_type === 'normal' && request.is_late_request && (
                    <div className="late-request-locked-note">
                      <Icon name="lock" size={17} />
                      <div><strong>এটি সংশোধনযোগ্য নয়</strong><span>ম্যানেজার এই আবেদনটি লেট রিকোয়েস্ট হিসেবে অনুমোদন করেছেন। এটি আর এডিট বা নতুন সংশোধন রিকোয়েস্টের মাধ্যমে পরিবর্তন করা যাবে না। ফাইনাল মিল হয়ে গেলে পরিবর্তনের জন্য প্রধান ম্যানেজারের সঙ্গে যোগাযোগ করুন।</span></div>
                    </div>
                  )}
                  {request.status === 'approved' && request.request_type === 'normal' && !request.is_late_request && (
                    <div className="request-action-row">
                      {request.days?.some((day) => String(day.meal_date).slice(0, 10) > todayValue()) && <button className="secondary-button" type="button" onClick={() => onEdit(request)}><Icon name="refresh" size={16} /> এডিট করুন</button>}
                      {request.days?.some((day) => String(day.meal_date).slice(0, 10) <= todayValue()) && <button className="secondary-button" type="button" onClick={() => onCorrect(request)}><Icon name="warning" size={16} /> সংশোধন রিকোয়েস্ট</button>}
                    </div>
                  )}
                  {needsReview && (
                    <div className="inline-success"><Icon name="clock" size={16} /> {request.is_late_request ? 'লেট রিকোয়েস্ট ম্যানেজারের অনুমোদনের অপেক্ষায় আছে। এই আবেদন পাঠানোর পর এডিট বা আলাদা সংশোধন রিকোয়েস্ট করা যাবে না।' : 'ম্যানেজারের অনুমোদনের অপেক্ষায় আছে।'}</div>
                  )}
                </div>
              )}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}

function MarketEntryForm({ isManager, members, ownMembershipId, period, onSaved, onCancel }) {
  const toast = useToast();
  const today = todayValue();
  const [entryDate, setEntryDate] = useState(today);
  const [buyerId, setBuyerId] = useState(ownMembershipId || '');
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([{ item_name: '', quantity: '', amount: '' }]);

  useEffect(() => {
    if (!buyerId) setBuyerId(ownMembershipId || members[0]?.membership_id || '');
  }, [buyerId, members, ownMembershipId]);

  const total = useMemo(() => items.reduce((sum, item) => sum + (Number(item.amount) > 0 ? Number(item.amount) : 0), 0), [items]);

  const updateItem = (index, patch) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const addItem = () => setItems((current) => [...current, { item_name: '', quantity: '', amount: '' }]);
  const removeItem = (index) => setItems((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = items.map((item) => ({
      item_name: item.item_name.trim(),
      quantity: item.quantity.trim(),
      amount: Number(item.amount),
    }));
    if (!period) return toast.warning('কোনো চলমান মাস নেই। আগে একটি চলমান মাস শুরু করুন।');
    if (!entryDate) return toast.error('বাজারের তারিখ দিন।');
    if (entryDate < period.start_date || entryDate > period.end_date || entryDate > today) return toast.warning(`বাজারের তারিখ চলমান মাসের মধ্যে এবং আজ বা তার আগের হতে হবে।`);
    if (!buyerId) return toast.error('যার নামে বাজার হবে তাকে নির্বাচন করুন।');
    if (!cleaned.length || cleaned.some((item) => !item.item_name || !Number.isFinite(item.amount) || item.amount < 0)) {
      return toast.error('প্রতিটি আইটেমের নাম ও সঠিক টাকার পরিমাণ দিতে হবে।');
    }
    if (total <= 0) return toast.error('মোট বাজারের পরিমাণ শূন্যের বেশি হতে হবে।');

    setBusy(true);
    try {
      const result = await createMarketEntry({
        entryDate,
        buyerMembershipId: buyerId,
        items: cleaned,
        creditToBuyer: credit,
      });
      toast.success(`বাজার সফলভাবে সংরক্ষণ হয়েছে — ${formatCurrency(result?.total_amount ?? total)}।`);
      onSaved?.(result);
      setItems([{ item_name: '', quantity: '', amount: '' }]);
      setCredit(false);
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'বাজার সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">বাজার এন্ট্রি</span>
          <h2>বাজারের তথ্য দিন</h2>
          <p>{period ? `${period.label} — নতুন বাজার entry শুধু চলমান মাসের মধ্যে রাখা হচ্ছে।` : 'কোনো চলমান মাস পাওয়া যায়নি।'}</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button>
      </div>

      <div className="market-top-fields">
        <label className="field-label">
          <span>তারিখ</span>
          <input type="date" min={period?.start_date || undefined} max={period?.end_date ? (period.end_date < today ? period.end_date : today) : today} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} disabled={!period} />
        </label>
        <label className="field-label">
          <span>{isManager ? 'কার নামে বাজার?' : 'বাজারকারী'}</span>
          {isManager ? (
            <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
              {members.filter((member) => member.member_status === 'active').map((member) => <option value={member.membership_id} key={member.membership_id}>{member.member_name}</option>)}
            </select>
          ) : (
            <input value="নিজের নামে" disabled />
          )}
        </label>
      </div>

      {isManager && members.filter((member) => member.member_status === 'active').length === 0 && (
        <div className="state-card state-card-warning market-member-warning">
          <Icon name="warning" size={18} />
          <div><strong>সদস্য তালিকা এখনো প্রস্তুত নয়।</strong><p>মার্কেট এন্ট্রি করার জন্য active member list দরকার। আবার চেষ্টা করুন।</p></div>
          <button className="secondary-button compact" type="button" onClick={onSaved}>আবার চেষ্টা করুন</button>
        </div>
      )}

      <div className="market-table-card">
        <div className="market-table-head">
          <span>ক্রম</span><span>আইটেমের নাম</span><span>পরিমাণ</span><span>টাকার পরিমাণ</span><span aria-hidden="true" />
        </div>
        <div className="market-item-list">
          {items.map((item, index) => (
            <div className="market-item-row" key={`item-${index}`}>
              <span className="market-serial">{formatNumber(index + 1, { maximumFractionDigits: 0 })}</span>
              <input className="market-input-item" value={item.item_name} onChange={(e) => updateItem(index, { item_name: e.target.value })} placeholder="নাম" aria-label="আইটেমের নাম" />
              <input className="market-input-quantity" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} placeholder="পরিমাণ" aria-label="পরিমাণ" />
              <input type="number" min="0" step="0.01" inputMode="decimal" className="market-input-amount" value={item.amount} onChange={(e) => updateItem(index, { amount: e.target.value })} placeholder="Amount" aria-label="টাকার পরিমাণ" />
              <button className="icon-button compact-icon" type="button" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label="আইটেম মুছুন"><Icon name="x" size={15} /></button>
            </div>
          ))}
        </div>
        <button className="secondary-button add-market-item" type="button" onClick={addItem}><Icon name="plus-circle" size={17} /> আরেকটি আইটেম যোগ করুন</button>
        <div className="market-total-row"><span>সর্বমোট</span><strong>{formatCurrency(total)}</strong></div>
      </div>

      <div className={`deposit-toggle-card ${credit ? 'enabled' : ''}`}>
        <button type="button" className="toggle-control" onClick={() => setCredit((value) => !value)} aria-pressed={credit}>
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span>
            <strong>বাজারের টাকা আমার/নির্বাচিত সদস্যের নামে ডিপোজিট হিসেবে যুক্ত করুন</strong>
            <small>এটি চালু করলে {formatCurrency(total)} ডিপোজিট হিসেবে যুক্ত হবে।</small>
          </span>
        </button>
        {credit && (
          <div className="toggle-warning"><Icon name="shield" size={16} /> ON অবস্থায় এই বাজারের পুরো মোট টাকা নির্বাচিত সদস্যের হিসাবে জমা হবে।</div>
        )}
      </div>

      <button className="primary-button large dining-submit" type="button" disabled={busy} onClick={submit}>
        {busy ? 'বাজার সংরক্ষণ হচ্ছে...' : 'বাজার সংরক্ষণ করুন'}
      </button>
    </section>
  );
}

function ManagerMealEntry({ members, onSaved, isPrimaryManager = false }) {
  const toast = useToast();
  const [date, setDate] = useState(todayValue());
  const [mode, setMode] = useState('all');
  const [selectedMember, setSelectedMember] = useState(members.find((member) => member.member_status === 'active')?.membership_id || '');
  const [entries, setEntries] = useState({});
  const [finalizedMemberIds, setFinalizedMemberIds] = useState([]);
  const [dayStatus, setDayStatus] = useState(null);
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [conflictConfirmOpen, setConflictConfirmOpen] = useState(false);

  const [defaultMealDefaults, setDefaultMealDefaults] = useState(DEFAULT_MEALS);

  const activeMembers = useMemo(() => members.filter((member) => member.member_status === 'active'), [members]);

  const load = useCallback(async () => {
    if (!date || !activeMembers.length) return;
    setLoading(true);
    try {
      const periodData = await fetchRunningPeriod();
      const mealData = await fetchMealEntryData(date, periodData?.period_id || periodData?.id || null);
      const { day, records } = mealData;
      setPeriod(periodData);
      setDayStatus(day);
      const recordMap = new Map(records.map((record) => [record.member_id, record]));
      const finalizedRows = records.filter((record) => !record.cancelled && (
        Boolean(record.finalized_at) || (day?.status === 'finalized' && [record.final_breakfast, record.final_lunch, record.final_dinner].some((value) => value !== null && value !== undefined))
      ));
      const nextFinalizedIds = finalizedRows.map((record) => record.member_id);
      setFinalizedMemberIds(nextFinalizedIds);
      const next = {}
      for (const member of activeMembers) {
        const record = recordMap.get(member.membership_id);
        next[member.membership_id] = {
          breakfast: Number(record?.final_breakfast ?? record?.actual_breakfast ?? record?.planned_breakfast ?? 0),
          lunch: Number(record?.final_lunch ?? record?.actual_lunch ?? record?.planned_lunch ?? 0),
          dinner: Number(record?.final_dinner ?? record?.actual_dinner ?? record?.planned_dinner ?? 0),
        };
      }
      setEntries(next);
      if (!nextFinalizedIds.includes(selectedMember)) setSelectedMember(nextFinalizedIds[0] || '');
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মিল এন্ট্রির তথ্য লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [activeMembers, date, selectedMember, toast]);

  useEffect(() => { load(); }, [load]);

  const setValue = (memberId, key, value) => {
    setEntries((current) => ({ ...current, [memberId]: { ...current[memberId], [key]: clampMeal(value) } }));
  };

  const finalizedMembers = useMemo(() => activeMembers.filter((member) => finalizedMemberIds.includes(member.membership_id)), [activeMembers, finalizedMemberIds]);

  const buildPayload = (force = true) => {
    const baseMembers = finalizedMembers;
    const targetMembers = mode === 'single' ? baseMembers.filter((member) => member.membership_id === selectedMember) : baseMembers;
    return targetMembers.map((member) => ({
      member_id: member.membership_id,
      meal_date: date,
      breakfast: clampMeal(entries[member.membership_id]?.breakfast),
      lunch: clampMeal(entries[member.membership_id]?.lunch),
      dinner: clampMeal(entries[member.membership_id]?.dinner),
      ...(force ? { force: true } : {}),
    }));
  };

  const performSave = async (payload) => {
    setBusy(true);
    try {
      const result = await setManagerMealEntries(payload);
      toast.success(`${formatNumber(result?.saved_count ?? payload.length)} জনের মিল সফলভাবে সংরক্ষণ হয়েছে।`);
      setConflicts([]);
      setConflictConfirmOpen(false);
      onSaved?.(result);
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মিল এন্ট্রি সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!isPrimaryManager) return toast.warning('ফাইনাল মিল সংশোধন শুধু প্রধান ম্যানেজার করতে পারবেন।');
    if (!dayStatus || dayStatus.status !== 'finalized') return toast.warning('শুধু final হওয়া দিনের মিল এখানে সংশোধন করা যাবে।');
    const payload = buildPayload(true);
    if (!payload.length) return toast.warning('এই তারিখে কোনো সদস্যের final meal record নেই।');
    const missing = payload.filter((row) => !finalizedMemberIds.includes(row.member_id));
    if (missing.length) return toast.warning('শুধু আগে final হওয়া member record-ই সংশোধন করা যাবে।');
    await performSave(payload);
  };

  return (
    <>
      <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">ম্যানেজার ফিচার</span>
          <h2>ফাইনাল মিল সংশোধন</h2>
          <p>শুধু নির্বাচিত দিনে যাদের final meal record আছে তারাই তালিকায় আসবে। পরিবর্তন সরাসরি final হিসাব ও snapshot আপডেট করবে।</p>
        </div>
      </div>

      <div className="manager-entry-toolbar">
        <label className="field-label">
          <span>তারিখ</span>
          <input type="date" min={period?.start_date || undefined} max={period?.end_date || undefined} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="segmented-control" role="tablist" aria-label="মিল এন্ট্রি মোড">
          <button className={mode === 'all' ? 'active' : ''} type="button" onClick={() => setMode('all')}>সবার</button>
          <button className={mode === 'single' ? 'active' : ''} type="button" onClick={() => setMode('single')}>একক ব্যক্তি</button>
        </div>
      </div>

      <div className="default-meal-box manager-default-entry-box">
        <div><strong>ডিফল্ট মিল</strong><small>একবার সেট করে সবার meal entry-তে দ্রুত বসিয়ে দিন।</small></div>
        <div className="default-meal-controls">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label]) => <label className="mini-field" key={key}><span>{label}</span><input type="number" min="0" max="50" step="0.5" value={defaultMealDefaults[key]} onChange={(e) => setDefaultMealDefaults((current) => ({ ...current, [key]: clampMeal(e.target.value) }))} /></label>)}</div>
        <button className="secondary-button compact" type="button" onClick={() => setEntries((current) => Object.fromEntries(activeMembers.map((member) => [member.membership_id, { ...current[member.membership_id], ...defaultMealDefaults }] )))}>সব সদস্যে প্রয়োগ করুন</button>
      </div>

      {mode === 'single' && (
        <label className="field-label manager-member-select">
          <span>সদস্য নির্বাচন</span>
          <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}>
            {finalizedMembers.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}
          </select>
        </label>
      )}

      {dayStatus?.status && (
        <div className={`entry-status-note ${dayStatus.status === 'finalized' ? 'is-finalized' : ''}`}>
          <Icon name="calendar" size={16} /> {formatDateWithWeekday(date)} · অবস্থা: <strong>{getMealDayStatusText(dayStatus)}</strong>
        </div>
      )}
      {!loading && !dayStatus && (
        <div className="meal-policy-note is-warning"><Icon name="warning" size={15} /> এই তারিখের server meal-day record পাওয়া যায়নি। আগে তারিখটি পরিবর্তন করে দেখুন।</div>
      )}

      {!isPrimaryManager && <div className="meal-policy-note is-warning"><Icon name="shield" size={15}/> এই ক্ষমতা শুধু প্রধান ম্যানেজারের। সহকারী ম্যানেজার ম্যানুয়াল মিল রিকোয়েস্ট দিতে পারবেন।</div>}
      {dayStatus?.status !== 'finalized' && !loading && <div className="meal-policy-note is-warning"><Icon name="info" size={15}/> নির্বাচিত দিনটি এখনো final হয়নি। Final correction কেবল রাত ৯টার পর final হওয়া দিনের জন্য।</div>}
      {loading ? <LoadingSpinner label="ফাইনাল মিলের রেকর্ড লোড হচ্ছে..." /> : (
        <div className="manager-meal-entry-list">
          {(mode === 'single' ? finalizedMembers.filter((member) => member.membership_id === selectedMember) : finalizedMembers).map((member) => {
            const values = entries[member.membership_id] || DEFAULT_MEALS;
            return (
              <article className="card manager-meal-card" key={member.membership_id}>
                <div className="manager-meal-card-head">
                  <div className="avatar">{member.member_name?.trim()?.[0] || 'M'}</div>
                  <div><strong>{member.member_name}</strong><small>মিল এন্ট্রি</small></div>
                </div>
                <div className="manager-meal-grid">
                  <div><MealStepper label="ব্রেকফাস্ট" value={values.breakfast} onChange={(v) => setValue(member.membership_id, 'breakfast', v)} /></div>
                  <div><MealStepper label="লাঞ্চ" value={values.lunch} onChange={(v) => setValue(member.membership_id, 'lunch', v)} /></div>
                  <div><MealStepper label="ডিনার" value={values.dinner} onChange={(v) => setValue(member.membership_id, 'dinner', v)} /></div>
                </div>
              </article>
            );
          })}
          {!finalizedMembers.length && !loading && <div className="empty-state-card"><Icon name="calendar" size={24}/><strong>এই দিনে কোনো final meal record নেই</strong><span>যাদের নামে ওই দিনে final meal হয়েছে, শুধু তারাই এখানে দেখা যাবে।</span></div>}
        </div>
      )}

      <button className="primary-button large dining-submit" type="button" disabled={busy || loading || !dayStatus || dayStatus.status !== 'finalized' || !isPrimaryManager || !finalizedMembers.length} onClick={save}>
        {busy ? 'ফাইনাল হিসাব আপডেট হচ্ছে...' : 'ফাইনাল মিল সংশোধন করুন'}
      </button>
      </section>
      {conflictConfirmOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel card confirmation-modal" role="dialog" aria-modal="true">
            <div className="modal-head"><div><span className="eyebrow">সতর্কতা</span><h2>আগের মিলের তথ্য পাওয়া গেছে</h2></div><button className="icon-button" type="button" onClick={() => { if (!busy) setConflictConfirmOpen(false); }} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button></div>
            <p className="confirm-description">{conflicts.length === 1 ? `${activeMembers.find((m) => m.membership_id === conflicts[0]?.member_id)?.member_name || 'এই সদস্য'}-এর ${formatDateWithWeekday(conflicts[0]?.meal_date)} তারিখে আগে থেকেই মিল রিকোয়েস্ট বা মিল এন্ট্রি আছে। নতুন করে duplicate না করে “মিল রিকোয়েস্ট” থেকে সেটি সম্পাদনা/সংশোধন করুন।` : `${formatNumber(conflicts.length)}টি সদস্য-তারিখে আগে থেকেই রিকোয়েস্ট বা মিলের তথ্য পাওয়া গেছে। duplicate তৈরি না করে সংশ্লিষ্ট রিকোয়েস্ট/মিল এন্ট্রি সম্পাদনা করুন।`} আপনি জোর করে পরিবর্তন চালালে server permission অনুযায়ী আগের হিসাব override হবে।</p>
            <div className="conflict-list">{conflicts.map((conflict, index) => <div className="conflict-item" key={`${conflict.member_id || 'member'}-${conflict.meal_date || index}`}><strong>{activeMembers.find((m) => m.membership_id === conflict.member_id)?.member_name || 'সদস্য'}</strong><span>{formatDateWithWeekday(conflict.meal_date)}{conflict.message ? ` · ${conflict.message}` : ''}</span></div>)}</div>
            <div className="confirm-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setConflictConfirmOpen(false)}>বাতিল</button><button className="primary-button danger-button" type="button" disabled={busy} onClick={() => performSave(buildPayload(true))}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন নিশ্চিত করুন'}</button></div>
          </section>
        </div>
      )}
    </>
  );
}


function PersonalTomorrowMealCard({ compact = false }) {
  const toast = useToast();
  const [meal, setMeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const targetDate = tomorrowValue();
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const requests = await fetchMyMealRequests(100);
        const row = requests.find((request) => request.status === 'approved' && Array.isArray(request.days) && request.days.some((day) => String(day.meal_date).slice(0, 10) === targetDate));
        const day = row?.days?.find((item) => String(item.meal_date).slice(0, 10) === targetDate);
        if (!active) return;
        setMeal(day ? { ...day, requestId: row.request_id, requestType: row.request_type } : null);
      } catch (error) {
        if (active) toast.error(getFriendlySupabaseError(error, 'আগামীকালের আপনার মিল লোড করা যায়নি।'));
      } finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [toast, targetDate]);
  const left = normalRequestTimeLeft();
  const values = meal || { breakfast: 0, lunch: 0, dinner: 0 };
  return (
    <section className={`card personal-tomorrow-meal-card ${compact ? 'compact-personal-meal-card' : ''}`}>
      <div className="personal-tomorrow-head">
        <div><span className="eyebrow">সার্ভার থেকে সর্বশেষ তথ্য</span><h2>আপনার আগামীকাল অর্থাৎ {formatDateWithWeekday(targetDate)}-এর মিল</h2></div>
        <span className={`status-chip ${meal ? 'live-chip' : 'offline-chip'}`}><span className="pulse-dot" /> {meal ? 'সার্ভারে সংরক্ষিত' : 'এখনো রিকোয়েস্ট নেই'}</span>
      </div>
      {loading ? <div className="personal-tomorrow-loading">সার্ভারের তথ্য লোড হচ্ছে...</div> : (
        <div className="personal-tomorrow-grid">
          <div><span>ব্রেকফাস্ট</span><strong>{formatMealCompact(values.breakfast)}</strong></div>
          <div><span>লাঞ্চ</span><strong>{formatMealCompact(values.lunch)}</strong></div>
          <div><span>ডিনার</span><strong>{formatMealCompact(values.dinner)}</strong></div>
          <div className="personal-tomorrow-total"><span>মোট</span><strong>{formatMealCompact(Number(values.breakfast || 0)+Number(values.lunch || 0)+Number(values.dinner || 0))}</strong></div>
        </div>
      )}
      {!loading && <div className={`personal-meal-cutoff-note ${left ? '' : 'is-closed'}`}>
        <Icon name={left ? 'clock' : 'shield'} size={15}/>
        {left ? `স্বাভাবিক রিকোয়েস্ট ${left} পরে, আজ রাত ১০টায় বন্ধ হবে। ${meal ? 'এর আগে চাইলে রিকোয়েস্ট আপডেট করতে পারবেন।' : 'সময় শেষ হওয়ার আগে মিল রিকোয়েস্ট দিন।'}` : 'আজ রাত ১০টার স্বাভাবিক cutoff শেষ হয়েছে। আজকের মিলের জন্য লেট রিকোয়েস্ট দিন; সেটি ম্যানেজারের অনুমোদনসাপেক্ষ।'}
      </div>}
    </section>
  );
}

function ManagerMyMeal() {
  const toast = useToast();
  const { membership } = useAuth();
  const [startDate, setStartDate] = useState(tomorrowValue());
  const [endDate, setEndDate] = useState(tomorrowValue());
  const [defaults, setDefaults] = useState(DEFAULT_MEALS);
  const [days, setDays] = useState(() => buildDateRange(tomorrowValue(), tomorrowValue(), DEFAULT_MEALS));
  const [busy, setBusy] = useState(false);
  const [overrideDate, setOverrideDate] = useState('');
  const [override, setOverride] = useState(DEFAULT_MEALS);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [period, setPeriod] = useState(null);

  useEffect(() => {
    fetchRunningPeriod().then(setPeriod).catch((error) => toast.error(getFriendlySupabaseError(error, 'চলমান মাসের তথ্য লোড করা যায়নি।')));
  }, [toast]);

  useEffect(() => {
    const fresh = buildDateRange(startDate, endDate, defaults);
    setDays((current) => fresh.map((day) => current.find((item) => item.meal_date === day.meal_date) || day));
  }, [startDate, endDate]);

  useEffect(() => {
    let cancelled = false;
    if (!showOverride || !overrideDate || !period?.period_id || !membership?.membership_id) return undefined;
    setOverrideLoading(true);
    setOverride(DEFAULT_MEALS);
    fetchMealEntryData(overrideDate, period.period_id)
      .then(({ records = [] }) => {
        if (cancelled) return;
        const existing = records.find((record) => record.member_id === membership.membership_id);
        if (!existing) return;
        setOverride({
          breakfast: clampMeal(existing.final_breakfast ?? existing.actual_breakfast ?? existing.planned_breakfast ?? DEFAULT_MEALS.breakfast),
          lunch: clampMeal(existing.final_lunch ?? existing.actual_lunch ?? existing.planned_lunch ?? DEFAULT_MEALS.lunch),
          dinner: clampMeal(existing.final_dinner ?? existing.actual_dinner ?? existing.planned_dinner ?? DEFAULT_MEALS.dinner),
        });
      })
      .catch((error) => {
        if (!cancelled) toast.error(getFriendlySupabaseError(error, 'নির্বাচিত দিনের আগের মিল লোড করা যায়নি।'));
      })
      .finally(() => { if (!cancelled) setOverrideLoading(false); });
    return () => { cancelled = true; };
  }, [showOverride, overrideDate, period?.period_id, membership?.membership_id, toast]);

  const submitPlan = async () => {
    if (!startDate || !endDate || startDate > endDate) return toast.warning('তারিখের পরিসর সঠিক নয়।');
    if (startDate <= todayValue()) return toast.warning('আজকের বা আগের দিনের জন্য সাধারণ মিল সংরক্ষণ করা যাবে না।');
    setBusy(true);
    try {
      await saveManagerMyMeal({ startDate, endDate, days: normalizeDays(days) });
      toast.success('আপনার মিল সফলভাবে সংরক্ষণ হয়েছে। এটি অন্যদের মতোই সার্ভারে কার্যকর হয়েছে।');
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'আপনার মিল সংরক্ষণ করা যায়নি।')); }
    finally { setBusy(false); }
  };

  const overrideNow = async () => {
    if (!overrideDate) return toast.warning('তারিখ নির্বাচন করুন।');
    if (overrideDate > todayValue()) return toast.warning('জরুরি ওভাররাইড ভবিষ্যতের দিনের জন্য ব্যবহার করা যাবে না।');
    setBusy(true);
    try {
      await emergencyOverrideMyMeal({ mealDate: overrideDate, breakfast: clampMeal(override.breakfast), lunch: clampMeal(override.lunch), dinner: clampMeal(override.dinner), reason: overrideReason.trim() || null });
      toast.success('জরুরি ওভাররাইড সফলভাবে সংরক্ষণ হয়েছে। এটি রাত ৯টার finalization-এ মূল হিসাবের সঙ্গে যুক্ত হবে।');
      setShowOverride(false); setOverrideReason('');
    } catch (error) { toast.error(getFriendlySupabaseError(error, 'জরুরি ওভাররাইড সংরক্ষণ করা যায়নি।')); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-stack">
      <PersonalTomorrowMealCard compact />
      <section className="card dining-panel manager-my-meal-card">
        <div className="panel-header"><div><span className="eyebrow">ম্যানেজারের নিজের মিল</span><h2>আমার মিল</h2><p>সাধারণ সদস্যের মতো একদিন বা একাধিক দিনের মিল একসাথে সাজিয়ে সংরক্ষণ করুন।</p></div></div>
        <div className="request-range-grid">
          <label className="field-label"><span>শুরুর তারিখ</span><input type="date" min={tomorrowValue()} max={period?.end_date || undefined} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="field-label"><span>শেষের তারিখ</span><input type="date" min={startDate || tomorrowValue()} max={period?.end_date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        </div>
        <div className="default-meal-box">
          <div><strong>ডিফল্ট মিল</strong><small>সব দিনের জন্য দ্রুত বসিয়ে দিন, তারপর প্রয়োজনে আলাদা দিনে পরিবর্তন করুন।</small></div>
          <div className="default-meal-controls">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label]) => <label className="mini-field" key={key}><span>{label}</span><input type="number" min="0" max="50" step="0.5" value={defaults[key]} onChange={(e) => setDefaults((current) => ({ ...current, [key]: clampMeal(e.target.value) }))} /></label>)}</div>
          <button className="secondary-button compact" type="button" onClick={() => setDays((current) => current.map((day) => ({ ...day, ...defaults })))}>সব দিনে প্রয়োগ করুন</button>
        </div>
        <div className="meal-days-stack">{days.map((day) => <MealDayCard key={day.meal_date} day={day} onChange={(next) => setDays((current) => current.map((item) => item.meal_date === next.meal_date ? next : item))} />)}</div>
        <button className="primary-button large dining-submit" type="button" disabled={busy} onClick={submitPlan}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'আমার মিল সংরক্ষণ করুন'}</button>
      </section>

      <section className="card dining-panel manager-override-card">
        <div className="panel-header"><div><span className="eyebrow">জরুরি ক্ষমতা</span><h2>জরুরি ওভাররাইড</h2><p>কাট-অফ পার হয়ে গেলে নিজের মিল সরাসরি বদলানোর জন্য ব্যবহার করুন।</p></div></div>
        {!showOverride ? <button className="secondary-button" type="button" onClick={() => setShowOverride(true)}><Icon name="warning" size={16} /> জরুরি ওভাররাইড খুলুন</button> : <>
          <div className="request-range-grid"><label className="field-label"><span>তারিখ</span><input type="date" max={todayValue()} value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} /></label></div>
          {overrideLoading && <div className="form-hint"><Icon name="clock" size={15}/> নির্বাচিত তারিখের সার্ভার রেকর্ড লোড হচ্ছে...</div>}
          {!overrideLoading && overrideDate && <div className="form-hint"><Icon name="check-circle" size={15}/> সার্ভারে আগে মিল থাকলে সেটি ফর্মে বসানো হয়েছে; না থাকলে ডিফল্ট মান দেখানো হচ্ছে।</div>}
          <div className="manager-meal-grid">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label]) => <div key={key}><MealStepper label={label} value={override[key]} onChange={(value) => setOverride((current) => ({ ...current, [key]: value }))} /></div>)}</div>
          <label className="field-label"><span>কারণ <em>(ঐচ্ছিক)</em></span><textarea rows="3" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="জরুরি পরিবর্তনের কারণ" /></label>
          <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>সতর্কতা</strong><p>এটি public locked snapshot-এ সঙ্গে সঙ্গে মিশবে না। রাত ৯টার finalization-এর সময় মূল final হিসাবের সঙ্গে যুক্ত হবে।</p></div></div>
          <div className="request-action-row"><button className="secondary-button" type="button" onClick={() => setShowOverride(false)}>বাতিল</button><button className="primary-button danger-button" type="button" disabled={busy || overrideLoading || !overrideDate} onClick={overrideNow}>{busy ? 'সংরক্ষণ হচ্ছে...' : 'ওভাররাইড সংরক্ষণ করুন'}</button></div>
        </>}
      </section>
    </div>
  );
}

function ManagerMealRequests() {
  const toast = useToast();
  const { membership } = useAuth();
  const [tab, setTab] = useState('all');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewBusy, setReviewBusy] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editRequest, setEditRequest] = useState(null);
  const [editDays, setEditDays] = useState([]);
  const [editDefaults, setEditDefaults] = useState(DEFAULT_MEALS);
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      if (tab === 'correction') {
        setRequests(await fetchManagerMealRequests({ requestType: 'correction', status: 'submitted' }));
      } else if (tab === 'late') {
        setRequests(await fetchManagerMealRequests({ status: 'submitted', lateOnly: true }));
      } else if (tab === 'approved') {
        setRequests(await fetchManagerMealRequests({ requestType: 'normal', status: 'approved', lateOnly: false }));
      } else {
        setRequests(await fetchManagerMealRequests({}));
      }
    } catch (error) {
      if (!silent) toast.error(getFriendlySupabaseError(error, 'ম্যানেজারের রিকোয়েস্ট লোড করা যায়নি।'));
      else console.warn('Manager request refresh failed:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, toast]);

  const online = useOnlineStatus();

  useEffect(() => {
    if (!online) return undefined;
    load();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    const timer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) load({ silent: true });
    }, 300000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load, online]);

  useRealtimeRefresh({
    enabled: online,
    hostelId: membership?.hostel_id,
    tables: ['meal_requests', 'meal_late_overrides', 'daily_meal_snapshots'],
    onRefresh: () => load({ silent: true }),
  });

  const review = async (requestId, approve) => {
    if (!approve && !rejectReason.trim()) {
      toast.warning('বাতিল করার কারণ লিখুন।');
      return;
    }
    setReviewBusy(requestId);
    try {
      const activeRequest = requests.find((item) => item.request_id === requestId);
      if (activeRequest?.is_late_request) {
        await reviewLateMealRequest({ requestId, approve, reason: approve ? null : rejectReason.trim() });
      } else {
        await reviewMealCorrection({ requestId, approve, reason: approve ? null : rejectReason.trim() });
      }
      toast.success(approve ? (activeRequest?.is_late_request ? 'লেট রিকোয়েস্ট অনুমোদিত হয়েছে।' : 'সংশোধন রিকোয়েস্ট অনুমোদিত হয়েছে।') : 'রিকোয়েস্ট বাতিল করা হয়েছে।');
      setRejectingId('');
      setRejectReason('');
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিকোয়েস্ট পর্যালোচনা করা যায়নি।'));
    } finally {
      setReviewBusy('');
    }
  };

  const openEdit = (request) => {
    setEditRequest(request);
    setEditDays((request.days || []).map((day) => ({
      meal_date: String(day.meal_date).slice(0, 10),
      breakfast: Number(day.breakfast ?? 0),
      lunch: Number(day.lunch ?? 0),
      dinner: Number(day.dinner ?? 0),
    })));
  };

  const applyEditDefaults = () => {
    setEditDays((current) => current.map((day) => ({ ...day, ...editDefaults })));
  };

  const saveEdit = async () => {
    if (!editRequest || !editDays.length) return;
    setEditBusy(true);
    try {
      await managerEditApprovedMealRequest({ requestId: editRequest.request_id, days: editDays });
      toast.success('রিকোয়েস্টের মিল সফলভাবে পরিবর্তন হয়েছে। cutoff অনুযায়ী এটি ৯টার finalization-এ যুক্ত হবে অথবা ইতিমধ্যে final হলে এখনই final update হয়েছে।');
      setEditRequest(null);
      setEditDays([]);
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিকোয়েস্টের মিল পরিবর্তন করা যায়নি।'));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">ম্যানেজার ফিচার</span>
          <h2>মিল রিকোয়েস্ট</h2>
          <p>সাধারণ রিকোয়েস্ট auto-approved; এখানে বিশেষ করে সংশোধন রিকোয়েস্ট পরিচালনা করুন।</p>
          {!online && <div className="form-hint"><Icon name="offline" size={14} /> অফলাইনে নতুন রিকোয়েস্ট লোড করা যাবে না। সংযোগ ফিরলে তালিকাটি স্বয়ংক্রিয়ভাবে refresh হবে।</div>}
        </div>
        <button className="secondary-button compact" type="button" onClick={load} disabled={!online}><Icon name="refresh" size={15} /> রিফ্রেশ</button>
      </div>

      <div className="segmented-control manager-request-tabs" role="tablist">
        <button className={tab === 'correction' ? 'active' : ''} type="button" onClick={() => setTab('correction')}>সংশোধন অপেক্ষমাণ</button>
        <button className={tab === 'late' ? 'active' : ''} type="button" onClick={() => setTab('late')}>লেট অপেক্ষমাণ</button>
        <button className={tab === 'approved' ? 'active' : ''} type="button" onClick={() => setTab('approved')}>সাধারণ অনুমোদিত</button>
        <button className={tab === 'all' ? 'active' : ''} type="button" onClick={() => setTab('all')}>সব রিকোয়েস্ট</button>
      </div>

      {loading ? <LoadingSpinner label="রিকোয়েস্ট লোড হচ্ছে..." /> : requests.length === 0 ? (
        <div className="empty-state-card dining-empty"><Icon name="check" size={26} /><strong>কোনো রিকোয়েস্ট নেই</strong><span>এই তালিকায় এখন কিছু দেখানোর নেই।</span></div>
      ) : (
        <div className="manager-request-list">
          {requests.map((request) => {
            const expanded = expandedId === request.request_id;
            const canEdit = request.request_type === 'normal' && !request.is_late_request && request.status === 'approved' && request.origin !== 'manager_self';
            const needsReview = request.status === 'submitted' && (request.request_type === 'correction' || request.is_late_request);
            return (
              <article className="manager-request-card" key={request.request_id}>
                <button className="manager-request-head manager-request-head-button" type="button" onClick={() => setExpandedId(expanded ? null : request.request_id)}>
                  <div>
                    <strong>{request.member_name}</strong>
                    <small>{requestTypeText(request.request_type, request.is_late_request)} · {formatDateTime12(request.submitted_at)}</small>
                  </div>
                  <span className={`request-status request-status-${request.status}`}>{statusText(request.status)}</span>
                </button>
                <div className="manager-request-date">{formatDateWithWeekday(request.start_date)} → {formatDateWithWeekday(request.end_date)}</div>
                {expanded && (
                  <div className="manager-request-expanded">
                    <div className="manager-request-day-summary">
                      {(request.days || []).map((day) => (
                        <div className={`compact-request-day ${isBangladeshWeekend(day.meal_date) ? 'weekend-day' : ''}`} key={day.meal_date}>
                          <strong>{formatDateWithWeekday(day.meal_date)}</strong>
                          <MealValuePills day={day} compact />
                        </div>
                      ))}
                    </div>
                    {canEdit && <div className="request-action-row"><button className="primary-button" type="button" onClick={() => openEdit(request)}><Icon name="edit" size={16} /> মিল এডিট করুন</button></div>}
                    {needsReview && (
                      <>
                        <div className="request-action-row">
                          <button className="primary-button" type="button" disabled={reviewBusy === request.request_id} onClick={() => review(request.request_id, true)}>
                            {reviewBusy === request.request_id ? 'অপেক্ষা করুন...' : 'অনুমোদন করুন'}
                          </button>
                          <button className="secondary-button" type="button" disabled={reviewBusy === request.request_id} onClick={() => { setRejectingId(request.request_id); setRejectReason(''); }}>বাতিল করুন</button>
                        </div>
                        {rejectingId === request.request_id && (
                          <div className="reject-reason-box">
                            <label className="field-label">
                              <span>বাতিলের কারণ</span>
                              <textarea rows="2" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="কারণ লিখুন..." />
                            </label>
                            <div className="request-action-row">
                              <button className="primary-button" type="button" disabled={reviewBusy === request.request_id} onClick={() => review(request.request_id, false)}>নিশ্চিতভাবে বাতিল</button>
                              <button className="secondary-button" type="button" disabled={reviewBusy === request.request_id} onClick={() => { setRejectingId(''); setRejectReason(''); }}>ফিরে যান</button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editRequest && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel card large-modal" role="dialog" aria-modal="true" aria-label="রিকোয়েস্টের মিল এডিট">
            <div className="modal-head">
              <div><span className="eyebrow">ম্যানেজার এডিট</span><h2>{editRequest.member_name}-এর মিল</h2><p>{formatDateWithWeekday(editRequest.start_date)} → {formatDateWithWeekday(editRequest.end_date)}</p></div>
              <button className="icon-button" type="button" disabled={editBusy} onClick={() => setEditRequest(null)} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button>
            </div>
            <div className="default-meal-box">
              <div><strong>ডিফল্ট মিল</strong><small>একবার সেট করে নিচের সব দিনেই প্রয়োগ করুন।</small></div>
              <div className="default-meal-controls">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label]) => <label className="mini-field" key={key}><span>{label}</span><input type="number" min="0" max="50" step="0.5" value={editDefaults[key]} onChange={(e) => setEditDefaults((current) => ({ ...current, [key]: clampMeal(e.target.value) }))} /></label>)}</div>
              <button className="secondary-button compact" type="button" onClick={applyEditDefaults}>সব দিনে প্রয়োগ করুন</button>
            </div>
            <div className="meal-days-stack">
              {editDays.map((day, index) => <MealDayCard key={day.meal_date} day={day} onChange={(next) => setEditDays((current) => current.map((item, i) => i === index ? next : item))} />)}
            </div>
            <div className="manager-warning-box"><Icon name="warning" size={18} /><div><strong>Server rule</strong><p>কাট-অফের আগে পরিবর্তন করলে ৯টার finalization পর্যন্ত pending থাকবে। কাট-অফের পরে বা দিনটি final হয়ে গেলে পরিবর্তনটি সঙ্গে সঙ্গে final হিসাবেও প্রয়োগ হবে।</p></div></div>
            <div className="confirm-actions"><button className="secondary-button" type="button" disabled={editBusy} onClick={() => setEditRequest(null)}>বাতিল</button><button className="primary-button" type="button" disabled={editBusy || !editDays.length} onClick={saveEdit}>{editBusy ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন সংরক্ষণ করুন'}</button></div>
          </section>
        </div>
      )}
    </section>
  );
}

function LateMealRequestForm({ onSaved, onCancel }) {
  const toast = useToast();
  const [values, setValues] = useState(DEFAULT_MEALS);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setClock] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setClock((value) => value + 1), 30000); return () => window.clearInterval(timer); }, []);
  const targetDate = lateMealRequestTargetDate();
  const submit = async () => {
    if (busy) return;
    if (!targetDate) return toast.warning('রাত ৯টার finalization ও ১০টার cutoff-এর মাঝের সময়ে late request দেওয়া যায় না।');
    setBusy(true);
    try {
      await createLateMealRequest({ mealDate: targetDate, breakfast: clampMeal(values.breakfast), lunch: clampMeal(values.lunch), dinner: clampMeal(values.dinner), reason: reason.trim() || null });
      toast.success('লেট মিল রিকোয়েস্ট পাঠানো হয়েছে। প্রধান/সহকারী ম্যানেজারের অনুমোদন না হওয়া পর্যন্ত এটি কার্যকর হবে না।');
      onSaved?.();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'লেট রিকোয়েস্ট পাঠানো যায়নি।'));
    } finally { setBusy(false); }
  };
  return <section className="dining-panel card late-request-form">
    <div className="panel-header"><div><span className="eyebrow">বিশেষ আবেদন</span><h2>{targetDate ? `${formatDateWithWeekday(targetDate)}-এর লেট মিল রিকোয়েস্ট` : 'লেট রিকোয়েস্টের সময় নয়'}</h2><p>{targetDate ? `${formatDateWithWeekday(targetDate)}-এর স্বাভাবিক রাত ১০টার cutoff মিস করলে এখানে আবেদন দিন।` : 'আজকের মিল রাত ৯টায় final হয়েছে; আগামী দিনের late request রাত ১০টার cutoff-এর পরে শুরু হবে।'} এটি auto-approved নয়; অনুমোদিত হলে target দিনের রাত ৯টার finalization-এ হিসাবের সঙ্গে যুক্ত হবে।</p></div><button className="icon-button" type="button" onClick={onCancel} aria-label="বন্ধ করুন"><Icon name="x" size={19}/></button></div>
    <div className="manager-warning-box late-request-warning-box"><Icon name="shield" size={18}/><div><strong>ম্যানেজারের অনুমোদন প্রয়োজন</strong><p>আবেদন পাঠালেই মিল যোগ হবে না। প্রধান বা সহকারী ম্যানেজার অনুমোদন করলে এটি সংশ্লিষ্ট দিনের ড্যাশবোর্ডের অনুমোদিত লেট রিকোয়েস্ট কার্ডে রাত ৯টার ফাইনালাইজেশন পর্যন্ত দেখা যাবে।</p><p><strong>গুরুত্বপূর্ণ:</strong> একবার লেট রিকোয়েস্ট পাঠালে এটি আর এডিট করা বা আলাদা সংশোধন রিকোয়েস্ট পাঠানো যাবে না। অনুমোদিত হলে নতুন করে পরিবর্তনের সুযোগ থাকবে না। ফাইনাল মিল হয়ে যাওয়ার পরে পরিবর্তন দরকার হলে প্রধান ম্যানেজারকে জানাতে হবে; তিনি Admin Entry → Final Meal Correction ব্যবহার করে সংশোধন করতে পারবেন।</p></div></div>
    <div className="manager-meal-grid">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label])=><div key={key}><MealStepper label={label} value={values[key]} onChange={(value)=>setValues((old)=>({...old,[key]:value}))}/></div>)}</div>
    <label className="field-label"><span>কারণ <em>(ঐচ্ছিক)</em></span><textarea rows="2" value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="কেন স্বাভাবিক cutoff-এর পরে request দিচ্ছেন"/></label>
    <button className="primary-button large dining-submit" type="button" onClick={submit} disabled={busy || !targetDate}>{busy?'আবেদন পাঠানো হচ্ছে...':'লেট রিকোয়েস্ট পাঠান'}</button>
  </section>;
}

function ManualMemberMealRequest({ members, period, onSaved, onCancel }) {
  const toast = useToast();
  const [memberId, setMemberId] = useState(members.find((item)=>item.member_status==='active')?.membership_id || '');
  const [startDate, setStartDate] = useState(tomorrowValue());
  const [endDate, setEndDate] = useState(tomorrowValue());
  const [defaults, setDefaults] = useState(DEFAULT_MEALS);
  const [days, setDays] = useState(()=>buildDateRange(tomorrowValue(),tomorrowValue(),DEFAULT_MEALS));
  const [busy, setBusy] = useState(false);
  useEffect(()=>{ if(!memberId) setMemberId(members.find((item)=>item.member_status==='active')?.membership_id||''); },[members,memberId]);
  useEffect(()=>{
    const fresh=buildDateRange(startDate,endDate,defaults);
    setDays((current)=>fresh.map((day)=>current.find((old)=>old.meal_date===day.meal_date)||day));
  },[startDate,endDate]);
  const applyDefaults=()=>setDays((current)=>current.map((day)=>({...day,...defaults})));
  const submit=async()=>{
    if(!memberId) return toast.warning('সদস্য নির্বাচন করুন।');
    if(!period) return toast.warning('কোনো running period নেই।');
    if(!startDate||!endDate||startDate>endDate) return toast.warning('তারিখের পরিসর সঠিক নয়।');
    if(startDate<=todayValue()) return toast.warning('ম্যানুয়াল সাধারণ request আগামীকাল বা পরবর্তী দিনের জন্য হবে। আজকের জন্য Late Request ব্যবহার করুন।');
    if(startDate<period.start_date||endDate>period.end_date) return toast.warning('নির্বাচিত তারিখগুলো running period-এর মধ্যে হতে হবে।');
    if(!days.length) return toast.warning('কমপক্ষে একটি দিনের মিল দরকার।');
    setBusy(true);
    try{
      await createMemberMealRequest({memberId,startDate,endDate,days:normalizeDays(days)});
      const target=members.find((item)=>item.membership_id===memberId);
      toast.success(`${target?.member_name||'সদস্য'}-এর হয়ে request তৈরি হয়েছে। এটি ওই সদস্যের request history-তে থাকবে।`);
      onSaved?.();
    }catch(error){toast.error(getFriendlySupabaseError(error,'ম্যানুয়াল মিল রিকোয়েস্ট তৈরি করা যায়নি।'));}
    finally{setBusy(false);}
  };
  return <section className="dining-panel card">
    <div className="panel-header"><div><span className="eyebrow">এডমিন এন্ট্রি</span><h2>ম্যানুয়াল মিল রিকোয়েস্ট</h2><p>সদস্য নিজে request দিতে না পারলে তার হয়ে দিন। request-টি ওই সদস্যের হিস্টরিতেই সংরক্ষিত হবে।</p></div><button className="icon-button" type="button" onClick={onCancel} aria-label="বন্ধ করুন"><Icon name="x" size={19}/></button></div>
    <div className="request-range-grid"><label className="field-label"><span>সদস্য</span><select value={memberId} onChange={(e)=>setMemberId(e.target.value)}>{members.filter((m)=>m.member_status==='active').map((m)=><option key={m.membership_id} value={m.membership_id}>{m.member_name}</option>)}</select></label><label className="field-label"><span>শুরুর তারিখ</span><input type="date" min={tomorrowValue()} max={period?.end_date||undefined} value={startDate} onChange={(e)=>{setStartDate(e.target.value);if(endDate<e.target.value)setEndDate(e.target.value);}}/></label><label className="field-label"><span>শেষের তারিখ</span><input type="date" min={startDate||tomorrowValue()} max={period?.end_date||undefined} value={endDate} onChange={(e)=>setEndDate(e.target.value)}/></label></div>
    <div className="default-meal-box"><div><strong>ডিফল্ট মিল</strong><small>প্রতিদিনের শুরুতে এই মান থাকবে; প্রতিটি দিনে আলাদা করে +/- করতে পারবেন।</small></div><div className="default-meal-controls">{[['breakfast','ব্রেকফাস্ট'],['lunch','লাঞ্চ'],['dinner','ডিনার']].map(([key,label])=><label className="mini-field" key={key}><span>{label}</span><input type="number" min="0" max="50" step="0.5" value={defaults[key]} onChange={(e)=>setDefaults((old)=>({...old,[key]:clampMeal(e.target.value)}))}/></label>)}</div><button className="secondary-button compact" type="button" onClick={applyDefaults}>সব দিনে প্রয়োগ করুন</button></div>
    <div className="request-summary-strip"><span>{formatNumber(days.length)} দিন</span><strong>মোট {formatMealCompact(totalDays(days))} মিল</strong></div>
    <div className="meal-days-stack">{days.map((day)=><MealDayCard key={day.meal_date} day={day} onChange={(next)=>setDays((current)=>current.map((item)=>item.meal_date===next.meal_date?next:item))}/>)}</div>
    <div className="manager-warning-box"><Icon name="info" size={18}/><div><strong>ডুপ্লিকেট সুরক্ষা</strong><p>সদস্যের কোনো দিনের active request আগে থেকেই থাকলে server request reject করবে; পুরোনো request overwrite হবে না।</p></div></div>
    <button className="primary-button large dining-submit" type="button" disabled={busy||!days.length} onClick={submit}>{busy?'রিকোয়েস্ট তৈরি হচ্ছে...':'চূড়ান্তভাবে সাবমিট করুন'}</button>
  </section>;
}

function ManagerDepositForm({ members, period, onSaved }) {
  const toast = useToast();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayValue());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberId) setMemberId(members.find((member) => member.member_status === 'active')?.membership_id || '');
  }, [memberId, members]);

  const submit = async (event) => {
    event.preventDefault();
    if (!period) return toast.warning('কোনো চলমান মাস নেই।');
    if (!memberId) return toast.error('সদস্য নির্বাচন করুন।');
    if (!date || date < period.start_date || date > period.end_date || date > todayValue()) return toast.warning('ডিপোজিটের তারিখ চলমান মাসের মধ্যে এবং আজ বা তার আগের হতে হবে।');
    if (!(Number(amount) > 0)) return toast.error('ডিপোজিটের পরিমাণ শূন্যের বেশি হতে হবে।');
    setBusy(true);
    try {
      await addManagerDeposit({ memberId, amount: Number(amount), date, description });
      const member = members.find((item) => item.membership_id === memberId);
      toast.success(`${member?.member_name || 'সদস্য'}-এর নামে ${formatCurrency(amount)} ডিপোজিট সফলভাবে যোগ হয়েছে।`);
      setAmount('');
      setDescription('');
      onSaved?.();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'ডিপোজিট সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header"><div><span className="eyebrow">ম্যানেজার ফিচার</span><h2>ডিপোজিট</h2><p>যেকোনো সদস্যের নামে ডিপোজিট যোগ করুন।</p></div></div>
      <div className="form-grid-2">
        <label className="field-label"><span>সদস্য</span><select value={memberId} onChange={(e) => setMemberId(e.target.value)}>{members.filter((member) => member.member_status === 'active').map((member) => <option value={member.membership_id} key={member.membership_id}>{member.member_name}</option>)}</select></label>
        <label className="field-label"><span>তারিখ</span><input type="date" min={period?.start_date || undefined} max={period?.end_date ? (period.end_date < todayValue() ? period.end_date : todayValue()) : todayValue()} value={date} onChange={(e) => setDate(e.target.value)} disabled={!period} /></label>
      </div>
      <div className="form-grid-2">
        <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="০" /></label>
        <label className="field-label"><span>বিবরণ <em>(ঐচ্ছিক)</em></span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="নগদ জমা" /></label>
      </div>
      <button className="primary-button dining-submit" type="button" disabled={busy} onClick={submit}>{busy ? 'ডিপোজিট যোগ হচ্ছে...' : 'ডিপোজিট সংরক্ষণ করুন'}</button>
    </section>
  );
}

function ManagerOtherExpenseForm({ members, period, onSaved }) {
  const toast = useToast();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayValue());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberId) setMemberId(members.find((member) => member.member_status === 'active')?.membership_id || '');
  }, [memberId, members]);

  const submit = async (event) => {
    event.preventDefault();
    if (!period) return toast.warning('কোনো চলমান মাস নেই।');
    if (!memberId) return toast.error('সদস্য নির্বাচন করুন।');
    if (!date || date < period.start_date || date > period.end_date || date > todayValue()) return toast.warning('খরচের তারিখ চলমান মাসের মধ্যে এবং আজ বা তার আগের হতে হবে।');
    if (!(Number(amount) > 0)) return toast.error('খরচের পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!description.trim()) return toast.error('খরচের বিবরণ দিতে হবে।');
    setBusy(true);
    try {
      await addManagerOtherExpense({ memberId, amount: Number(amount), date, description: description.trim() });
      const member = members.find((item) => item.membership_id === memberId);
      toast.success(`${member?.member_name || 'সদস্য'}-এর হিসাব থেকে ${formatCurrency(amount)} সফলভাবে বাদ দেওয়া হয়েছে।`);
      setAmount('');
      setDescription('');
      onSaved?.();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'অন্যান্য খরচ সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header"><div><span className="eyebrow">ম্যানেজার ফিচার</span><h2>অন্যান্য খরচ</h2><p>নির্বাচিত সদস্যের ডিপোজিট/হিসাব থেকে এই পরিমাণ বাদ যাবে।</p></div></div>
      <div className="form-grid-2">
        <label className="field-label"><span>সদস্য</span><select value={memberId} onChange={(e) => setMemberId(e.target.value)}>{members.filter((member) => member.member_status === 'active').map((member) => <option value={member.membership_id} key={member.membership_id}>{member.member_name}</option>)}</select></label>
        <label className="field-label"><span>তারিখ</span><input type="date" min={period?.start_date || undefined} max={period?.end_date ? (period.end_date < todayValue() ? period.end_date : todayValue()) : todayValue()} value={date} onChange={(e) => setDate(e.target.value)} disabled={!period} /></label>
      </div>
      <div className="form-grid-2">
        <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="০" /></label>
        <label className="field-label"><span>বিবরণ</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ব্যক্তিগত খরচ" /></label>
      </div>
      <button className="primary-button dining-submit" type="button" disabled={busy} onClick={submit}>{busy ? 'খরচ সংরক্ষণ হচ্ছে...' : 'খরচ সংরক্ষণ করুন'}</button>
    </section>
  );
}

export function DiningPage() {
  const toast = useToast();
  const { isManager, membership, profile } = useAuth();
  const { isOperationalManager, isPrimaryManager, isAssistantManager, period: managementPeriod } = useManagementContext();
  const isOnline = useOnlineStatus();
  const [view, setView] = useState('home');
  const [requestMode, setRequestMode] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberDirectoryError, setMemberDirectoryError] = useState(null);
  const [runningPeriod, setRunningPeriod] = useState(null);
  const [periodLoadError, setPeriodLoadError] = useState(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const periodFallback = useMemo(() => {
    if (!(managementPeriod?.period_id || managementPeriod?.id)) return null;
    if (managementPeriod?.status && managementPeriod.status !== 'running') return null;
    return { ...managementPeriod, period_id: managementPeriod.period_id || managementPeriod.id };
  }, [managementPeriod?.period_id, managementPeriod?.id, managementPeriod?.label, managementPeriod?.start_date, managementPeriod?.end_date, managementPeriod?.status]);
  const hasRunningManagerPeriod = Boolean(runningPeriod?.period_id || runningPeriod?.id || periodFallback?.period_id);
  const isPrimaryDiningManager = hasRunningManagerPeriod ? Boolean(isPrimaryManager) : Boolean(isManager);
  const canOperateDining = Boolean(isPrimaryDiningManager || isAssistantManager || (!hasRunningManagerPeriod && isOperationalManager));

  const loadMembers = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingMembers(true);
    setMemberDirectoryError(null);
    setPeriodLoadError(null);

    // Load period and member directory independently. A failed directory RPC must not
    // hide a valid running period (which previously disabled the market form as well).
    try {
      const [membersResult, periodResult] = await Promise.allSettled([
        canOperateDining ? fetchManagerMemberDirectory() : Promise.resolve([]),
        fetchRunningPeriod(),
      ]);

      if (periodResult.status === 'fulfilled') {
        // A successful null response is authoritative: no month is running. Only use
        // the management-context copy when the period RPC itself fails.
        setRunningPeriod(periodResult.value || null);
      } else {
        setRunningPeriod(periodFallback);
        const message = getFriendlySupabaseError(periodResult.reason, 'চলমান মাসের তথ্য লোড করা যায়নি।');
        setPeriodLoadError(message);
        if (!quiet) toast.error(message);
      }

      if (membersResult.status === 'fulfilled') {
        setMembers(Array.isArray(membersResult.value) ? membersResult.value : []);
        setMemberDirectoryError(null);
      } else {
        setMembers([]);
        const message = getFriendlySupabaseError(membersResult.reason, 'সদস্য তালিকা লোড করা যায়নি। নিজের নামে বাজার এন্ট্রি সম্ভব হতে পারে; অন্য সদস্য বাছাই করতে তালিকা পুনরায় লোড করুন।');
        setMemberDirectoryError(message);
        if (!quiet) toast.error(message);
      }
    } finally {
      if (!quiet) setLoadingMembers(false);
    }
  }, [canOperateDining, periodFallback, toast]);

  useEffect(() => {
    if (isOnline) loadMembers();
  }, [isOnline, loadMembers]);

  useRealtimeRefresh({
    enabled: isOnline,
    hostelId: membership?.hostel_id,
    tables: ['meal_requests', 'market_entries', 'khala_money_entries', 'monthly_periods', 'hostel_memberships'],
    onRefresh: () => loadMembers({ quiet: true }),
  });

  if (!isOnline) return <OfflineState description="ডাইনিং-এর সব কাজ online-এ চলবে। ডাটা/ওয়াই‑ফাই চালু করে আবার চেষ্টা করুন।" />;

  const backToHome = () => { setView('home'); setRequestMode(null); setSelectedRequest(null); };

  if (loadingMembers) {
    return <div className="dining-loading-wrap"><LoadingSpinner label="ডাইনিং প্রস্তুত হচ্ছে..." /></div>;
  }

  if (requestMode) {
    return (
      <div className="page-stack">
        <MealRequestEditor
          mode={requestMode}
          request={selectedRequest}
          onSaved={backToHome}
          onCancel={backToHome}
        />
      </div>
    );
  }

  if (view === 'late-request') {
    return <div className="page-stack"><div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div><LateMealRequestForm onSaved={backToHome} onCancel={backToHome} /></div>;
  }

  if (view === 'request-history') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <RequestHistory
          onEdit={(request) => { setSelectedRequest(request); setRequestMode('edit'); }}
          onCorrect={(request) => { setSelectedRequest(request); setRequestMode('correction'); }}
        />
      </div>
    );
  }

  if (view === 'meal-request') {
    return (
      <div className="page-stack">
        <PersonalTomorrowMealCard />
        <SectionHeader eyebrow="ডাইনিং" title="মিল রিকোয়েস্ট" description="নতুন রিকোয়েস্ট দিন, অথবা আগের রিকোয়েস্টের হিসাব দেখুন।" />
        <div className="request-entry-choice-grid">
          <button className="card request-choice-card" type="button" onClick={() => { setSelectedRequest(null); setRequestMode('new'); }}>
            <span className="dining-option-icon"><Icon name="calendar" size={22} /></span>
            <strong>নতুন মিল রিকোয়েস্ট</strong>
            <small>একটি দিন বা তারিখের পরিসর নিয়ে সব দিনের মিল একসাথে সাজান।</small>
          </button>
          <button className="card request-choice-card" type="button" onClick={() => setView('request-history')}>
            <span className="dining-option-icon"><Icon name="history" size={22} /></span>
            <strong>রিকোয়েস্ট হিস্টরি</strong>
            <small>আগের রিকোয়েস্ট দেখুন, কাট-অফের আগে এডিট করুন বা পরে সংশোধনের আবেদন দিন।</small>
          </button>
          <button className="card request-choice-card request-choice-late" type="button" onClick={() => setView('late-request')}>
            <span className="dining-option-icon"><Icon name="clock" size={22} /></span>
            <strong>লেট রিকোয়েস্ট</strong>
            <small>স্বাভাবিক রাত ১০টার cutoff মিস হলে আজকের মিলের জন্য আবেদন করুন। এটি স্বয়ংক্রিয়ভাবে অনুমোদিত হবে না; ম্যানেজার/সহকারী ম্যানেজারের review প্রয়োজন।</small>
          </button>
        </div>
      </div>
    );
  }

  if (view === 'market') {
    const fallbackOwnMember = membership?.membership_id ? [{
      membership_id: membership.membership_id,
      member_name: profile?.full_name || profile?.display_name || profile?.name || 'নিজের নামে (সদস্য তালিকা লোড হয়নি)',
      member_status: membership.status || 'active',
      role: membership.role || 'member',
    }] : [];
    const marketMembers = members.some((member) => member.member_status === 'active') ? members : fallbackOwnMember;
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        {periodLoadError && <div className="state-card state-card-warning"><Icon name="warning" size={18}/><div><strong>চলমান মাসের তথ্য যাচাই করা যায়নি</strong><p>{periodLoadError} সার্ভারের validation-ই চূড়ান্ত; তারিখ/মাস নিশ্চিত না হলে এন্ট্রি দেবেন না।</p><button className="secondary-button compact" type="button" onClick={loadMembers}>আবার চেষ্টা করুন</button></div></div>}
        {memberDirectoryError && canOperateDining && <div className="state-card state-card-warning"><Icon name="warning" size={18}/><div><strong>সদস্য তালিকা সম্পূর্ণ লোড হয়নি</strong><p>{memberDirectoryError} নিজের নামে এন্ট্রি দেওয়ার জন্য fallback দেখানো হতে পারে; অন্য সদস্যের নামে এন্ট্রির আগে তালিকা পুনরায় লোড করুন।</p><button className="secondary-button compact" type="button" onClick={loadMembers}>আবার চেষ্টা করুন</button></div></div>}
        <MarketEntryForm isManager={canOperateDining} members={marketMembers} ownMembershipId={membership?.membership_id} period={runningPeriod} onSaved={loadMembers} onCancel={backToHome} />
      </div>
    );
  }

  if (view === 'admin-entry') {
    return <div className="page-stack"><div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div><SectionHeader eyebrow="প্রধান/সহকারী ম্যানেজার" title="এডমিন এন্ট্রি" description="Final meal correction সরাসরি final হিসাব বদলায়; manual request নির্দিষ্ট সদস্যের request history-তে সংরক্ষিত হয়।"/><div className="request-entry-choice-grid"><button className="card request-choice-card" type="button" disabled={!isPrimaryDiningManager} onClick={() => setView('manager-meal')}><span className="dining-option-icon"><Icon name="check-circle" size={22}/></span><strong>ফাইনাল মিল সংশোধন</strong><small>{isPrimaryDiningManager ? 'তারিখ বেছে শুধু যাদের final meal record আছে তাদের হিসাব সংশোধন করুন।' : 'এই কাজটি শুধু প্রধান ম্যানেজার করতে পারবেন।'}</small></button><button className="card request-choice-card" type="button" onClick={() => setView('admin-manual-request')}><span className="dining-option-icon"><Icon name="users" size={22}/></span><strong>ম্যানুয়াল মিল রিকোয়েস্ট</strong><small>যে সদস্য নিজে request দিতে পারছেন না তার হয়ে date range ও daily meals দিয়ে request তৈরি করুন।</small></button></div></div>;
  }

  if (view === 'admin-manual-request') {
    return <div className="page-stack"><div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={() => setView('admin-entry')}><Icon name="chevron" size={15} className="rotate-left" /> এডমিন এন্ট্রি</button></div><ManualMemberMealRequest members={members} period={runningPeriod} onSaved={loadMembers} onCancel={() => setView('admin-entry')} /></div>;
  }

  if (view === 'manager-meal') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerMealEntry members={members} onSaved={loadMembers} isPrimaryManager={isPrimaryDiningManager} />
      </div>
    );
  }


  if (view === 'manager-request') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerMealRequests />
      </div>
    );
  }

  if (view === 'deposit') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerDepositForm members={members} period={runningPeriod} onSaved={loadMembers} />
      </div>
    );
  }

  if (view === 'other-expense') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerOtherExpenseForm members={members} period={runningPeriod} onSaved={loadMembers} />
      </div>
    );
  }

  return (
    <div className="page-stack dining-stack">
      <SectionHeader eyebrow="মূল সেকশন" title="ডাইনিং" description={isManager ? 'খাবার, বাজার ও মেসের হিসাবের সব কার্যক্রম এখানে পরিচালনা করুন।' : 'বাজার ও মিল সম্পর্কিত দৈনন্দিন কাজগুলো এখানে করুন।'} />

      <div className="dining-action-grid">
        {canOperateDining && <DiningOptionCard icon="shield" title="এডমিন এন্ট্রি" description="ফাইনাল মিল সংশোধন বা সদস্যের হয়ে ম্যানুয়াল মিল রিকোয়েস্ট তৈরি করুন।" badge onClick={() => setView('admin-entry')} />}
        {isPrimaryDiningManager && <DiningOptionCard icon="user" title="আমার মিল" description="সাধারণ সদস্যের মতো রিকোয়েস্ট, হিস্টরি ও সংশোধন ব্যবহার করুন।" badge onClick={() => setView('meal-request')} />}
        {isAssistantManager && !isPrimaryDiningManager && <DiningOptionCard icon="user" title="আমার মিল" description="সাধারণ সদস্যের মতো মিল রিকোয়েস্ট দিন, ইতিহাস দেখুন বা সংশোধনের আবেদন করুন।" onClick={() => setView('meal-request')} />}
        {canOperateDining && <DiningOptionCard icon="calendar" title="মিল রিকোয়েস্ট" description="সদস্যদের স্বয়ংক্রিয়ভাবে অনুমোদিত রিকোয়েস্ট এবং সংশোধন রিকোয়েস্ট পরিচালনা করুন।" badge onClick={() => setView('manager-request')} />}
        <DiningOptionCard icon="dining" title="বাজার এন্ট্রি" description={isManager ? 'যেকোনো সদস্যের নামে বাজার যোগ করুন, প্রয়োজনে ডিপোজিট হিসাবেও যুক্ত করুন।' : 'নিজের নামে বাজার যোগ করুন এবং চাইলে বাজারের টাকা ডিপোজিট হিসেবে নিন।'} badge={canOperateDining} onClick={() => setView('market')} />
        {canOperateDining && <DiningOptionCard icon="wallet" title="ডিপোজিট" description="যেকোনো সদস্যের নামে ডিপোজিট যোগ করুন।" badge onClick={() => setView('deposit')} />}
        {canOperateDining && <DiningOptionCard icon="wallet" title="অন্যান্য খরচ" description="নির্বাচিত সদস্যের হিসাব থেকে অন্যান্য খরচ বাদ দিন।" badge onClick={() => setView('other-expense')} />}
        {!isManager && !isAssistantManager && <DiningOptionCard icon="history" title="মিল রিকোয়েস্ট" description="নতুন request দিন বা আগের request-এর history দেখুন।" onClick={() => setView('meal-request')} />}
      </div>

      {canOperateDining && (
        <div className="manager-dining-note"><Icon name="shield" size={16} /><span>ম্যানেজার ফিচারে অতিরিক্ত ক্ষমতা আছে। ভুল এন্ট্রি পরে ম্যানেজার সংশোধন করতে পারবেন।</span></div>
      )}
    </div>
  );
}
