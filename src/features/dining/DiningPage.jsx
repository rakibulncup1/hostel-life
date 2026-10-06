import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { OfflineState } from '../../components/OfflineState';
import { useAuth } from '../../contexts/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../components/Toast';
import {
  addManagerDeposit,
  addManagerOtherExpense,
  createMarketEntry,
  createMealCorrectionRequest,
  createMealRequest,
  editApprovedMealRequest,
  fetchManagerMealRequests,
  fetchMealEntryData,
  fetchMemberDirectory,
  fetchMyMealRequests,
  reviewMealCorrection,
  setManagerMealEntries,
} from '../../services/diningService';
import { formatDateWithWeekday, isBangladeshWeekend, toDateInputValue } from '../../utils/date';
import { formatCurrency, formatNumber } from '../../utils/number';
import { formatDateTime12 } from '../../utils/time';
import { getFriendlySupabaseError } from '../../utils/supabaseErrors';

const DEFAULT_MEALS = { breakfast: 0.5, lunch: 1, dinner: 1 };

function tomorrowValue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateInputValue(d);
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

function requestTypeText(type) {
  return type === 'correction' ? 'সংশোধন রিকোয়েস্ট' : 'মিল রিকোয়েস্ট';
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
  const [startDate, setStartDate] = useState(() => request?.start_date || tomorrowValue());
  const [endDate, setEndDate] = useState(() => request?.end_date || tomorrowValue());
  const [defaults, setDefaults] = useState(DEFAULT_MEALS);
  const [days, setDays] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (request?.days?.length) {
      const initial = normalizeDays(request.days);
      setStartDate(request.start_date || initial[0]?.meal_date || tomorrowValue());
      setEndDate(request.end_date || initial.at(-1)?.meal_date || tomorrowValue());
      setDays(initial);
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
    setBusy(true);
    try {
      const payload = normalizeDays(days);
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
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDays((current) => buildDateRange(e.target.value, endDate, defaults).map((day) => getRequestDayMap(request).get(day.meal_date) || day)); }} />
          </label>
          <label className="field-label">
            <span>সংশোধনের শেষের তারিখ</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => { setEndDate(e.target.value); setDays((current) => buildDateRange(startDate, e.target.value, defaults).map((day) => getRequestDayMap(request).get(day.meal_date) || day)); }} />
          </label>
        </div>
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
        <Icon name="clock" size={16} /> প্রতিটি দিনের সরাসরি পরিবর্তনের cutoff আগের রাত ১০টা। cutoff-এর পরে সংশোধন রিকোয়েস্ট ব্যবহার করুন।
      </div>

      <button className="primary-button large dining-submit" type="button" disabled={busy} onClick={submit}>
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
          {requests.map((request) => (
            <article className="request-history-card" key={request.request_id}>
              <button className="request-history-head" type="button" onClick={() => setSelected(selected === request.request_id ? null : request.request_id)}>
                <span>
                  <strong>{requestTypeText(request.request_type)}</strong>
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
                  {request.status === 'approved' && request.request_type === 'normal' && (
                    <div className="request-action-row">
                      <button className="secondary-button" type="button" onClick={() => onEdit(request)}><Icon name="refresh" size={16} /> এডিট করুন</button>
                      <button className="secondary-button" type="button" onClick={() => onCorrect(request)}><Icon name="warning" size={16} /> সংশোধন রিকোয়েস্ট</button>
                    </div>
                  )}
                  {request.request_type === 'correction' && request.status === 'submitted' && (
                    <div className="inline-success"><Icon name="clock" size={16} /> ম্যানেজারের অনুমোদনের অপেক্ষায় আছে।</div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketEntryForm({ isManager, members, ownMembershipId, onSaved, onCancel }) {
  const toast = useToast();
  const today = toDateInputValue();
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
    if (!entryDate) return toast.error('বাজারের তারিখ দিন।');
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
          <p>আজকের তারিখ ডিফল্ট আছে। প্রয়োজন হলে পরিবর্তন করুন।</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="বন্ধ করুন"><Icon name="x" size={19} /></button>
      </div>

      <div className="market-top-fields">
        <label className="field-label">
          <span>তারিখ</span>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
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

      <div className="market-table-card">
        <div className="market-table-head">
          <span>ক্রম</span><span>আইটেমের নাম</span><span>পরিমাণ</span><span>টাকার পরিমাণ</span><span aria-hidden="true" />
        </div>
        <div className="market-item-list">
          {items.map((item, index) => (
            <div className="market-item-row" key={`item-${index}`}>
              <span className="market-serial">{formatNumber(index + 1, { maximumFractionDigits: 0 })}</span>
              <input className="market-input-item" value={item.item_name} onChange={(e) => updateItem(index, { item_name: e.target.value })} placeholder="চাল, ডাল..." aria-label="আইটেমের নাম" />
              <input className="market-input-quantity" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} placeholder="৫ কেজি" aria-label="পরিমাণ" />
              <input type="number" min="0" step="0.01" inputMode="decimal" className="market-input-amount" value={item.amount} onChange={(e) => updateItem(index, { amount: e.target.value })} placeholder="০" aria-label="টাকার পরিমাণ" />
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

function ManagerMealEntry({ members, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState(toDateInputValue());
  const [mode, setMode] = useState('all');
  const [selectedMember, setSelectedMember] = useState(members.find((member) => member.member_status === 'active')?.membership_id || '');
  const [entries, setEntries] = useState({});
  const [dayStatus, setDayStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const activeMembers = useMemo(() => members.filter((member) => member.member_status === 'active'), [members]);

  const load = useCallback(async () => {
    if (!date || !activeMembers.length) return;
    setLoading(true);
    try {
      const { day, records } = await fetchMealEntryData(date);
      setDayStatus(day);
      const recordMap = new Map(records.map((record) => [record.member_id, record]));
      const next = {};
      for (const member of activeMembers) {
        const record = recordMap.get(member.membership_id);
        next[member.membership_id] = {
          breakfast: Number(record?.actual_breakfast ?? record?.planned_breakfast ?? 0),
          lunch: Number(record?.actual_lunch ?? record?.planned_lunch ?? 0),
          dinner: Number(record?.actual_dinner ?? record?.planned_dinner ?? 0),
        };
      }
      setEntries(next);
      if (!activeMembers.some((member) => member.membership_id === selectedMember)) setSelectedMember(activeMembers[0]?.membership_id || '');
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

  const save = async () => {
    const targetMembers = mode === 'single' ? activeMembers.filter((member) => member.membership_id === selectedMember) : activeMembers;
    if (!targetMembers.length) return toast.error('সদস্য নির্বাচন করুন।');
    setBusy(true);
    try {
      const payload = targetMembers.map((member) => ({
        member_id: member.membership_id,
        meal_date: date,
        breakfast: clampMeal(entries[member.membership_id]?.breakfast),
        lunch: clampMeal(entries[member.membership_id]?.lunch),
        dinner: clampMeal(entries[member.membership_id]?.dinner),
      }));
      const result = await setManagerMealEntries(payload);
      toast.success(`${formatNumber(result?.saved_count ?? payload.length)} জনের মিল সফলভাবে সংরক্ষণ হয়েছে।`);
      onSaved?.(result);
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'মিল এন্ট্রি সংরক্ষণ করা যায়নি।'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">ম্যানেজার ফিচার</span>
          <h2>মিল এন্ট্রি</h2>
          <p>বাস্তব মিলের হিসাব দিন। সংরক্ষণ হলে এটি চূড়ান্ত হিসাবের অংশ হবে।</p>
        </div>
      </div>

      <div className="manager-entry-toolbar">
        <label className="field-label">
          <span>তারিখ</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="segmented-control" role="tablist" aria-label="মিল এন্ট্রি মোড">
          <button className={mode === 'all' ? 'active' : ''} type="button" onClick={() => setMode('all')}>সবার</button>
          <button className={mode === 'single' ? 'active' : ''} type="button" onClick={() => setMode('single')}>একক ব্যক্তি</button>
        </div>
      </div>

      {mode === 'single' && (
        <label className="field-label manager-member-select">
          <span>সদস্য নির্বাচন</span>
          <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}>
            {activeMembers.map((member) => <option key={member.membership_id} value={member.membership_id}>{member.member_name}</option>)}
          </select>
        </label>
      )}

      {dayStatus?.status && (
        <div className="entry-status-note"><Icon name="calendar" size={16} /> {formatDateWithWeekday(date)} · অবস্থা: <strong>{dayStatus.status === 'finalized' ? 'ফাইনাল' : dayStatus.status === 'locked' ? 'লকড' : 'খোলা'}</strong></div>
      )}

      {loading ? <LoadingSpinner label="মিল এন্ট্রি লোড হচ্ছে..." /> : (
        <div className="manager-meal-entry-list">
          {(mode === 'single' ? activeMembers.filter((member) => member.membership_id === selectedMember) : activeMembers).map((member) => {
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
        </div>
      )}

      <button className="primary-button large dining-submit" type="button" disabled={busy || loading} onClick={save}>
        {busy ? 'মিল সংরক্ষণ হচ্ছে...' : 'মিল সংরক্ষণ করুন'}
      </button>
    </section>
  );
}

function ManagerMealRequests() {
  const toast = useToast();
  const [tab, setTab] = useState('correction');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewBusy, setReviewBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'correction') {
        setRequests(await fetchManagerMealRequests({ requestType: 'correction', status: 'submitted' }));
      } else if (tab === 'approved') {
        setRequests(await fetchManagerMealRequests({ requestType: 'normal', status: 'approved' }));
      } else {
        setRequests(await fetchManagerMealRequests({}));
      }
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'ম্যানেজারের রিকোয়েস্ট লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => { load(); }, [load]);

  const review = async (requestId, approve) => {
    if (!approve && !rejectReason.trim()) {
      toast.warning('বাতিল করার কারণ লিখুন।');
      return;
    }
    setReviewBusy(requestId);
    try {
      await reviewMealCorrection({ requestId, approve, reason: approve ? null : rejectReason.trim() });
      toast.success(approve ? 'সংশোধন রিকোয়েস্ট অনুমোদিত হয়েছে।' : 'সংশোধন রিকোয়েস্ট বাতিল করা হয়েছে।');
      setRejectingId('');
      setRejectReason('');
      await load();
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'রিকোয়েস্ট পর্যালোচনা করা যায়নি।'));
    } finally {
      setReviewBusy('');
    }
  };

  return (
    <section className="dining-panel card">
      <div className="panel-header">
        <div>
          <span className="eyebrow">ম্যানেজার ফিচার</span>
          <h2>মিল রিকোয়েস্ট</h2>
          <p>সাধারণ রিকোয়েস্ট auto-approved; এখানে বিশেষ করে সংশোধন রিকোয়েস্ট পরিচালনা করুন।</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={load}><Icon name="refresh" size={15} /> রিফ্রেশ</button>
      </div>

      <div className="segmented-control manager-request-tabs" role="tablist">
        <button className={tab === 'correction' ? 'active' : ''} type="button" onClick={() => setTab('correction')}>সংশোধন অপেক্ষমাণ</button>
        <button className={tab === 'approved' ? 'active' : ''} type="button" onClick={() => setTab('approved')}>সাধারণ অনুমোদিত</button>
        <button className={tab === 'all' ? 'active' : ''} type="button" onClick={() => setTab('all')}>সব রিকোয়েস্ট</button>
      </div>

      {loading ? <LoadingSpinner label="রিকোয়েস্ট লোড হচ্ছে..." /> : requests.length === 0 ? (
        <div className="empty-state-card dining-empty"><Icon name="check" size={26} /><strong>কোনো রিকোয়েস্ট নেই</strong><span>এই তালিকায় এখন কিছু দেখানোর নেই।</span></div>
      ) : (
        <div className="manager-request-list">
          {requests.map((request) => (
            <article className="manager-request-card" key={request.request_id}>
              <div className="manager-request-head">
                <div>
                  <strong>{request.member_name}</strong>
                  <small>{requestTypeText(request.request_type)} · {formatDateTime12(request.submitted_at)}</small>
                </div>
                <span className={`request-status request-status-${request.status}`}>{statusText(request.status)}</span>
              </div>
              <div className="manager-request-date">{formatDateWithWeekday(request.start_date)} → {formatDateWithWeekday(request.end_date)}</div>
              <div className="manager-request-day-summary">
                {(request.days || []).map((day) => (
                  <div className={`compact-request-day ${isBangladeshWeekend(day.meal_date) ? 'weekend-day' : ''}`} key={day.meal_date}>
                    <strong>{formatDateWithWeekday(day.meal_date)}</strong>
                    <span>B {formatMealCompact(day.breakfast)} · L {formatMealCompact(day.lunch)} · D {formatMealCompact(day.dinner)}</span>
                  </div>
                ))}
              </div>
              {request.request_type === 'correction' && request.status === 'submitted' && (
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
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ManagerDepositForm({ members }) {
  const toast = useToast();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toDateInputValue());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberId) setMemberId(members.find((member) => member.member_status === 'active')?.membership_id || '');
  }, [memberId, members]);

  const submit = async (event) => {
    event.preventDefault();
    if (!memberId) return toast.error('সদস্য নির্বাচন করুন।');
    if (!(Number(amount) > 0)) return toast.error('ডিপোজিটের পরিমাণ শূন্যের বেশি হতে হবে।');
    setBusy(true);
    try {
      await addManagerDeposit({ memberId, amount: Number(amount), date, description });
      const member = members.find((item) => item.membership_id === memberId);
      toast.success(`${member?.member_name || 'সদস্য'}-এর নামে ${formatCurrency(amount)} ডিপোজিট সফলভাবে যোগ হয়েছে।`);
      setAmount('');
      setDescription('');
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
        <label className="field-label"><span>তারিখ</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="form-grid-2">
        <label className="field-label"><span>টাকার পরিমাণ</span><input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="০" /></label>
        <label className="field-label"><span>বিবরণ <em>(ঐচ্ছিক)</em></span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="নগদ জমা" /></label>
      </div>
      <button className="primary-button dining-submit" type="button" disabled={busy} onClick={submit}>{busy ? 'ডিপোজিট যোগ হচ্ছে...' : 'ডিপোজিট সংরক্ষণ করুন'}</button>
    </section>
  );
}

function ManagerOtherExpenseForm({ members }) {
  const toast = useToast();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toDateInputValue());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberId) setMemberId(members.find((member) => member.member_status === 'active')?.membership_id || '');
  }, [memberId, members]);

  const submit = async (event) => {
    event.preventDefault();
    if (!memberId) return toast.error('সদস্য নির্বাচন করুন।');
    if (!(Number(amount) > 0)) return toast.error('খরচের পরিমাণ শূন্যের বেশি হতে হবে।');
    if (!description.trim()) return toast.error('খরচের বিবরণ দিতে হবে।');
    setBusy(true);
    try {
      await addManagerOtherExpense({ memberId, amount: Number(amount), date, description: description.trim() });
      const member = members.find((item) => item.membership_id === memberId);
      toast.success(`${member?.member_name || 'সদস্য'}-এর হিসাব থেকে ${formatCurrency(amount)} সফলভাবে বাদ দেওয়া হয়েছে।`);
      setAmount('');
      setDescription('');
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
        <label className="field-label"><span>তারিখ</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
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
  const { isManager, membership } = useAuth();
  const isOnline = useOnlineStatus();
  const [view, setView] = useState('home');
  const [requestMode, setRequestMode] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      setMembers(await fetchMemberDirectory());
    } catch (error) {
      toast.error(getFriendlySupabaseError(error, 'সদস্যদের তথ্য লোড করা যায়নি।'));
    } finally {
      setLoadingMembers(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isOnline) loadMembers();
  }, [isOnline, loadMembers]);

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
        </div>
      </div>
    );
  }

  if (view === 'market') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <MarketEntryForm isManager={isManager} members={members} ownMembershipId={membership?.membership_id} onSaved={loadMembers} onCancel={backToHome} />
      </div>
    );
  }

  if (view === 'manager-meal') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerMealEntry members={members} onSaved={loadMembers} />
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
        <ManagerDepositForm members={members} />
      </div>
    );
  }

  if (view === 'other-expense') {
    return (
      <div className="page-stack">
        <div className="subpage-back-row"><button className="secondary-button compact" type="button" onClick={backToHome}><Icon name="chevron" size={15} className="rotate-left" /> ডাইনিং</button></div>
        <ManagerOtherExpenseForm members={members} />
      </div>
    );
  }

  return (
    <div className="page-stack dining-stack">
      <SectionHeader eyebrow="মূল সেকশন" title="ডাইনিং" description={isManager ? 'খাবার, বাজার ও মেসের হিসাবের সব কার্যক্রম এখানে পরিচালনা করুন।' : 'বাজার ও মিল সম্পর্কিত দৈনন্দিন কাজগুলো এখানে করুন।'} />

      <div className="dining-action-grid">
        {isManager && <DiningOptionCard icon="history" title="মিল এন্ট্রি" description="সবার বা একক সদস্যের বাস্তব মিলের হিসাব দিন।" badge onClick={() => setView('manager-meal')} />}
        {isManager && <DiningOptionCard icon="calendar" title="মিল রিকোয়েস্ট" description="সদস্যদের স্বয়ংক্রিয়ভাবে অনুমোদিত রিকোয়েস্ট এবং সংশোধন রিকোয়েস্ট পরিচালনা করুন।" badge onClick={() => setView('manager-request')} />}
        <DiningOptionCard icon="dining" title="বাজার এন্ট্রি" description={isManager ? 'যেকোনো সদস্যের নামে বাজার যোগ করুন, প্রয়োজনে ডিপোজিট হিসাবেও যুক্ত করুন।' : 'নিজের নামে বাজার যোগ করুন এবং চাইলে বাজারের টাকা ডিপোজিট হিসেবে নিন।'} badge={isManager} onClick={() => setView('market')} />
        {isManager && <DiningOptionCard icon="wallet" title="ডিপোজিট" description="যেকোনো সদস্যের নামে ডিপোজিট যোগ করুন।" badge onClick={() => setView('deposit')} />}
        {isManager && <DiningOptionCard icon="wallet" title="অন্যান্য খরচ" description="নির্বাচিত সদস্যের হিসাব থেকে অন্যান্য খরচ বাদ দিন।" badge onClick={() => setView('other-expense')} />}
        {!isManager && <DiningOptionCard icon="history" title="মিল রিকোয়েস্ট" description="নতুন request দিন বা আগের request-এর history দেখুন।" onClick={() => setView('meal-request')} />}
      </div>

      {isManager && (
        <div className="manager-dining-note"><Icon name="shield" size={16} /><span>ম্যানেজার ফিচারে অতিরিক্ত ক্ষমতা আছে। ভুল এন্ট্রি পরে ম্যানেজার সংশোধন করতে পারবেন।</span></div>
      )}
    </div>
  );
}
