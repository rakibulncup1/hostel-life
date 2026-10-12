import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { supabase } from '../../lib/supabase';
import {
  fetchPlatformPublicSettings, platformAdminGenerateAccessCode, platformAdminGetOverview,
  platformAdminListHostelMembers, platformAdminListHostels, platformAdminSetGate,
  platformAdminSetHostelStatus, platformAdminSetUserBlocked, platformAdminUpdatePublicSettings,
} from '../../services/platformService';

const EMPTY_SETTINGS = {
  announcement_enabled: false, announcement_title: '', announcement_body: '',
  registration_code_required: false, hostel_creation_code_required: false,
  developer_name: '', developer_title: '', developer_photo_url: '', developer_email: '',
  developer_phone: '', developer_portfolio_url: '',
};
const errorText = (error, fallback) => /platform_admin_|get_platform_public_settings|function .* does not exist|schema cache/i.test(String(error?.message || ''))
  ? 'Super Admin SQL এখনো প্রয়োগ করা হয়নি। প্রথমে নির্দেশিকার Phase 2 SQL চালিয়ে schema reload হওয়া পর্যন্ত অপেক্ষা করুন।'
  : (error?.message || fallback);

function Field({ label, value, onChange, type = 'text', maxLength, multiline = false }) {
  return <label className="field-label platform-field"><span>{label}</span>{multiline
    ? <textarea rows={4} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    : <input type={type} value={value ?? ''} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}</label>;
}
function Stat({ label, value, icon }) {
  return <div className="platform-stat"><span className="platform-stat-icon"><Icon name={icon} size={19}/></span><div><small>{label}</small><strong>{Number(value || 0).toLocaleString('en-US')}</strong></div></div>;
}

export function SuperAdminPage({ user }) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [gateError, setGateError] = useState('');
  const [password, setPassword] = useState('');
  const [reauthenticated, setReauthenticated] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState({});
  const [hostels, setHostels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [members, setMembers] = useState([]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState('1440');
  const [maxUses, setMaxUses] = useState('1');
  const [generated, setGenerated] = useState(null);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [summary, allHostels, publicSettings] = await Promise.all([
        platformAdminGetOverview(), platformAdminListHostels(), fetchPlatformPublicSettings({ force: true }),
      ]);
      setOverview(summary || {});
      setHostels(allHostels || []);
      setSettings({ ...EMPTY_SETTINGS, ...(Array.isArray(publicSettings) ? publicSettings[0] : publicSettings || {}) });
    } catch (cause) { setError(errorText(cause, 'Super Admin তথ্য লোড করা যায়নি।')); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase || !user?.id) { if (live) { setGateError('বৈধ লগইন সেশন পাওয়া যায়নি।'); setChecking(false); } return; }
      try {
        const { data, error: queryError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (queryError) throw queryError;
        if (!live) return;
        setAllowed(data?.role === 'super_admin');
        if (data?.role !== 'super_admin') setGateError('এই অ্যাকাউন্টের role super_admin নয়।');
      } catch (cause) { if (live) setGateError(errorText(cause, 'Role যাচাই করা যায়নি।')); }
      finally { if (live) setChecking(false); }
    })();
    return () => { live = false; };
  }, [user?.id]);
  useEffect(() => { if (allowed && reauthenticated) refresh(); }, [allowed, reauthenticated, refresh]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'bn')), [members]);
  const selectedStatus = selected?.platform_status || 'active';
  const reauthenticate = async (event) => {
    event.preventDefault(); setGateError(''); setReauthBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user?.email, password });
      if (authError) throw authError;
      setPassword(''); setReauthenticated(true); setNotice('পাসওয়ার্ড যাচাই সফল হয়েছে।');
    } catch { setGateError('পাসওয়ার্ড মিলেনি। আপনার মূল অ্যাকাউন্টের পাসওয়ার্ড যাচাই করুন।'); }
    finally { setReauthBusy(false); }
  };
  const openHostel = async (hostel) => {
    setSelected(hostel); setMembers([]); setReason(''); setBusy(true); setError('');
    try { setMembers(await platformAdminListHostelMembers(hostel.hostel_id)); }
    catch (cause) { setError(errorText(cause, 'সদস্য তালিকা লোড করা যায়নি।')); }
    finally { setBusy(false); }
  };
  const changeHostelStatus = async (status) => {
    if (!selected) return;
    const label = status === 'soft_deleted' ? 'soft-delete' : status === 'suspended' ? 'স্থগিত' : 'চালু';
    if (!window.confirm(`“${selected.name}” মেস ${label} করবেন? Soft-delete হলেও পুরোনো তথ্য মুছে ফেলা হবে না।`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetHostelStatus(selected.hostel_id, status, reason);
      setSelected((old) => ({ ...old, platform_status: status })); setNotice('মেসের স্ট্যাটাস আপডেট হয়েছে।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'মেসের স্ট্যাটাস বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const toggleBlock = async (member) => {
    const blocked = !member.is_blocked;
    if (!window.confirm(`${member.full_name || 'সদস্য'}-কে ${blocked ? 'ব্লক' : 'আনব্লক'} করবেন?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminSetUserBlocked(member.user_id, blocked, blocked ? 'Super Admin panel' : null);
      setMembers((old) => old.map((row) => row.user_id === member.user_id ? { ...row, is_blocked: blocked, status: blocked ? 'inactive' : row.status } : row));
      setNotice(`ব্যবহারকারী ${blocked ? 'ব্লক' : 'আনব্লক'} করা হয়েছে।`);
      await refresh();
      if (selected) setMembers(await platformAdminListHostelMembers(selected.hostel_id));
    } catch (cause) { setError(errorText(cause, 'ব্যবহারকারীর স্ট্যাটাস বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const saveSettings = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await platformAdminUpdatePublicSettings(settings);
      setNotice('সেটিংস সংরক্ষিত হয়েছে। অন্য ব্যবহারকারীদের public settings cache সর্বোচ্চ ৫ মিনিটের মধ্যে আপডেট হবে।');
      await refresh();
    } catch (cause) { setError(errorText(cause, 'সেটিংস সংরক্ষণ করা যায়নি।')); }
    finally { setBusy(false); }
  };
  const changeGate = async (purpose, required) => {
    setBusy(true); setError(''); setNotice(''); setGenerated(null);
    try {
      await platformAdminSetGate(purpose, required);
      const key = purpose === 'registration' ? 'registration_code_required' : 'hostel_creation_code_required';
      setSettings((old) => ({ ...old, [key]: required }));
      setNotice(`${purpose === 'registration' ? 'রেজিস্ট্রেশন' : 'মেস তৈরির'} কোড যাচাই ${required ? 'চালু' : 'বন্ধ'} হয়েছে।`);
    } catch (cause) { setError(errorText(cause, 'Security gate বদলানো যায়নি।')); }
    finally { setBusy(false); }
  };
  const generateCode = async (purpose) => {
    setBusy(true); setError(''); setNotice(''); setGenerated(null);
    try {
      setGenerated(await platformAdminGenerateAccessCode(purpose, Number(ttl), Number(maxUses)));
      setNotice('নতুন কোড তৈরি হয়েছে। এটি এখন একবারই দেখানো হবে—নিরাপদ স্থানে কপি করুন।');
    } catch (cause) { setError(errorText(cause, 'নতুন কোড তৈরি করা যায়নি।')); }
    finally { setBusy(false); }
  };

  if (checking) return <main className="platform-page"><LoadingSpinner label="Super Admin role যাচাই হচ্ছে..."/></main>;
  if (!allowed) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="shield" size={30}/></span><h1>অ্যাক্সেস অনুমোদিত নয়</h1><p>{gateError || 'এই প্যানেল শুধুমাত্র Super Admin-এর জন্য।'}</p><button className="primary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরে যান</button></section></main>;
  if (!reauthenticated) return <main className="platform-page"><section className="card platform-reauth"><span className="platform-lock"><Icon name="lock" size={28}/></span><span className="eyebrow">অতিরিক্ত নিরাপত্তা</span><h1>Super Admin যাচাইকরণ</h1><p>প্যানেল খোলার আগে আপনার মূল অ্যাকাউন্টের পাসওয়ার্ড পুনরায় যাচাই হবে।</p><form className="form-stack" onSubmit={reauthenticate}><label className="field-label"><span>অ্যাকাউন্ট ইমেইল</span><input type="email" value={user?.email || ''} readOnly /></label><label className="field-label"><span>বর্তমান পাসওয়ার্ড</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{gateError && <div className="inline-error">{gateError}</div>}<button className="primary-button large" type="submit" disabled={reauthBusy}>{reauthBusy ? 'যাচাই হচ্ছে...' : 'যাচাই করে প্রবেশ করুন'}</button><button type="button" className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>বাতিল</button></form></section></main>;

  return <main className="platform-page">
    <header className="platform-header"><div className="platform-brand"><span className="platform-brand-mark"><Icon name="shield" size={24}/></span><div><small>HOSTEL LIFE · PLATFORM CONTROL</small><h1>Super Admin</h1></div></div><div className="platform-header-actions"><span className="platform-auth-user">{user?.email}</span><button className="secondary-button" onClick={() => { window.location.href = '/app/dashboard'; }}>অ্যাপে ফিরুন</button></div></header>
    <div className="platform-intro"><div><span className="eyebrow">সিস্টেম ব্যবস্থাপনা</span><h2>মেস, নিরাপত্তা ও পাবলিক সেটিংস</h2><p>এই প্যানেলে মিলের রেকর্ড, লেনদেন বা আর্থিক তথ্য দেখানো হয় না।</p></div><button className="secondary-button" onClick={refresh} disabled={busy}><Icon name="refresh" size={16}/> রিফ্রেশ</button></div>
    {error && <div className="inline-error platform-alert"><Icon name="warning" size={17}/><span>{error}</span></div>}{notice && <div className="inline-success platform-alert"><Icon name="check-circle" size={17}/><span>{notice}</span></div>}
    <nav className="platform-tabs">{[['overview','ওভারভিউ'],['hostels','মেস ও সদস্য'],['settings','নোটিশ ও Developer Info'],['security','Security Codes']].map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <section className="platform-stats-grid"><Stat label="মোট মেস" value={overview.hostels} icon="home"/><Stat label="মোট অ্যাকাউন্ট" value={overview.users} icon="users"/><Stat label="সক্রিয় মেম্বারশিপ" value={overview.active_memberships} icon="user-plus"/><Stat label="স্থগিত মেস" value={overview.suspended_hostels} icon="lock"/><Stat label="Soft-deleted মেস" value={overview.soft_deleted_hostels} icon="file"/><Stat label="ব্লক করা ব্যবহারকারী" value={overview.blocked_users} icon="shield"/><div className="card platform-privacy-note"><Icon name="shield" size={22}/><div><strong>Privacy boundary</strong><p>মেস-মেম্বার API শুধু পরিচয় ও স্ট্যাটাস ফেরত দেয়; finance এবং meal data query করা হয় না।</p></div></div></section>}
    {tab === 'hostels' && <section className="platform-two-col"><div className="card platform-panel"><div className="platform-panel-heading"><div><h3>সব মেস</h3><p>{hostels.length}টি মেস</p></div></div>{hostels.length===0?<p className="platform-empty">কোনো মেস পাওয়া যায়নি।</p>:<div className="platform-hostel-list">{hostels.map((hostel)=><button className={`platform-hostel-row ${selected?.hostel_id===hostel.hostel_id?'selected':''}`} key={hostel.hostel_id} onClick={()=>openHostel(hostel)}><span className="platform-hostel-icon"><Icon name="home" size={19}/></span><span className="platform-hostel-copy"><strong>{hostel.name}</strong><small>{hostel.member_count} জন সক্রিয় সদস্য · {new Date(hostel.created_at).toLocaleDateString()}</small></span><span className={`platform-status status-${hostel.platform_status||'active'}`}>{hostel.platform_status==='soft_deleted'?'বন্ধ':hostel.platform_status==='suspended'?'স্থগিত':'সক্রিয়'}</span></button>)}</div>}</div>
      <div className="card platform-panel">{selected?<><div className="platform-panel-heading"><div><h3>{selected.name}</h3><p>মেস ID: <code>{selected.hostel_id}</code></p></div><button className="text-button" onClick={()=>setSelected(null)}>বন্ধ করুন</button></div><Field label="অ্যাকশন নোট / কারণ (ঐচ্ছিক)" value={reason} onChange={setReason} maxLength={300}/><div className="platform-action-row"><button className="secondary-button" disabled={busy||selectedStatus==='active'} onClick={()=>changeHostelStatus('active')}>চালু করুন</button><button className="secondary-button" disabled={busy||selectedStatus==='suspended'} onClick={()=>changeHostelStatus('suspended')}>স্থগিত</button><button className="danger-button" disabled={busy||selectedStatus==='soft_deleted'} onClick={()=>changeHostelStatus('soft_deleted')}>Soft-delete</button></div><div className="platform-panel-heading platform-members-heading"><div><h3>সদস্য তালিকা</h3><p>নাম, ফোন, যোগদানের তারিখ ও status</p></div></div>{busy?<LoadingSpinner label="সদস্য তালিকা লোড হচ্ছে..."/>:<div className="platform-members-list">{sortedMembers.map((member)=><div className="platform-member-row" key={member.membership_id}><div className="platform-avatar">{String(member.full_name||'স').slice(0,1)}</div><div className="platform-member-copy"><strong>{member.full_name||'নাম নেই'}</strong><small>{member.phone||'ফোন নেই'} · যোগদান {member.joined_at?new Date(member.joined_at).toLocaleDateString():'—'}</small></div><div className="platform-member-actions"><span className={`platform-status ${member.status==='active'?'status-active':'status-inactive'}`}>{member.status==='active'?'সক্রিয়':'নিষ্ক্রিয়'}</span><button className={member.is_blocked?'secondary-button':'danger-button'} disabled={busy||member.user_id===user?.id} onClick={()=>toggleBlock(member)}>{member.is_blocked?'আনব্লক':'ব্লক'}</button></div></div>)}</div>}</>:<div className="platform-empty-state"><Icon name="users" size={28}/><strong>একটি মেস নির্বাচন করুন</strong><span>এখানে সদস্যদের সীমিত প্রোফাইল তথ্য দেখা যাবে।</span></div>}</div></section>}
    {tab === 'settings' && <form className="platform-settings-grid" onSubmit={saveSettings}><section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Global announcement</h3><p>ড্যাশবোর্ডের ওপরে সবার জন্য ব্যানার নোটিশ</p></div></div><label className="platform-toggle"><span><strong>নোটিশ চালু</strong><small>চালু থাকলে অ্যাপের ব্যবহারকারীরা ব্যানার দেখবেন</small></span><input type="checkbox" checked={Boolean(settings.announcement_enabled)} onChange={(e)=>setSettings((old)=>({...old,announcement_enabled:e.target.checked}))}/></label><Field label="নোটিশ শিরোনাম" value={settings.announcement_title} onChange={(v)=>setSettings((old)=>({...old,announcement_title:v}))} maxLength={160}/><Field label="নোটিশের বিবরণ" value={settings.announcement_body} onChange={(v)=>setSettings((old)=>({...old,announcement_body:v}))} maxLength={3000} multiline/></section><section className="card platform-panel"><div className="platform-panel-heading"><div><h3>Developer Info</h3><p>Developer Info পৃষ্ঠায় দেখানো তথ্য</p></div></div><Field label="নাম" value={settings.developer_name} onChange={(v)=>setSettings((old)=>({...old,developer_name:v}))} maxLength={160}/><Field label="পরিচয় / পদবি" value={settings.developer_title} onChange={(v)=>setSettings((old)=>({...old,developer_title:v}))} maxLength={240}/><Field label="ছবির URL" value={settings.developer_photo_url} onChange={(v)=>setSettings((old)=>({...old,developer_photo_url:v}))} maxLength={1000}/><Field label="ইমেইল" type="email" value={settings.developer_email} onChange={(v)=>setSettings((old)=>({...old,developer_email:v}))} maxLength={240}/><Field label="ফোন" value={settings.developer_phone} onChange={(v)=>setSettings((old)=>({...old,developer_phone:v}))} maxLength={80}/><Field label="Portfolio URL" value={settings.developer_portfolio_url} onChange={(v)=>setSettings((old)=>({...old,developer_portfolio_url:v}))} maxLength={1000}/></section><div className="platform-settings-footer"><button className="primary-button large" type="submit" disabled={busy}>{busy?'সংরক্ষণ হচ্ছে...':'সব সেটিংস সংরক্ষণ করুন'}</button></div></form>}
    {tab === 'security' && <section className="platform-settings-grid"><div className="card platform-panel"><div className="platform-panel-heading"><div><h3>Permission code controls</h3><p>নতুন কোড তৈরি হলে আগের কোড একই purpose-এ সঙ্গে সঙ্গে বাতিল হবে।</p></div></div><label className="platform-toggle"><span><strong>নতুন অ্যাকাউন্টে কোড বাধ্যতামূলক</strong><small>Registration page-এ কোড চাইবে</small></span><input type="checkbox" checked={Boolean(settings.registration_code_required)} disabled={busy} onChange={(e)=>changeGate('registration',e.target.checked)}/></label><label className="platform-toggle"><span><strong>মেস তৈরিতে কোড বাধ্যতামূলক</strong><small>নতুন মেস তৈরির আগে কোড যাচাই হবে</small></span><input type="checkbox" checked={Boolean(settings.hostel_creation_code_required)} disabled={busy} onChange={(e)=>changeGate('hostel_creation',e.target.checked)}/></label><Field label="কোডের মেয়াদ (মিনিট, ৫–১০০৮০)" type="number" value={ttl} onChange={setTtl}/><Field label="সর্বোচ্চ ব্যবহার (১–১০০০)" type="number" value={maxUses} onChange={setMaxUses}/><div className="platform-code-buttons"><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('registration')}>Registration code তৈরি</button><button className="secondary-button" disabled={busy} type="button" onClick={()=>generateCode('hostel_creation')}>Hostel creation code তৈরি</button></div>{generated&&<div className="platform-generated-code"><small>{generated.purpose==='registration'?'Registration':'Hostel creation'} · মেয়াদ {new Date(generated.expires_at).toLocaleString()}</small><code>{generated.code}</code><button className="primary-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(generated.code);setNotice('কোড কপি হয়েছে।');}catch{setNotice('কপি করা যায়নি—কোডটি হাতে কপি করুন।');}}}>কোড কপি করুন</button><p>এটি এখন একবারই দেখানো হয়েছে। নিরাপদ স্থানে রাখুন এবং সাধারণ নোটিশে প্রকাশ করবেন না।</p></div>}</div><div className="card platform-panel"><div className="platform-panel-heading"><div><h3>Security rules</h3><p>Role ও অ্যাক্সেস কোড</p></div></div><ul className="platform-security-list"><li>সাধারণ সাইন-আপের role সবসময় <code>user</code> হবে।</li><li>Super Admin role শুধু project owner Supabase SQL Editor থেকে সেট করবেন।</li><li>প্রতিটি admin RPC ডাটাবেজেই Super Admin role যাচাই করে।</li><li>এই প্যানেল কোনো আর্থিক বা meal data query করে না।</li></ul></div></section>}
    <footer className="platform-footer">Hostel Life · Platform administration · Access is enforced by database functions.</footer>
  </main>;
}
