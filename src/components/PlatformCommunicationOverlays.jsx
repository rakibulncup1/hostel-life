import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

function dhakaDayKey() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return parts;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function campaignIsActive(campaign, now) {
  if (!campaign?.enabled) return false;
  const start = campaign.starts_at ? new Date(campaign.starts_at).getTime() : null;
  const end = campaign.ends_at ? new Date(campaign.ends_at).getTime() : null;
  if (start !== null && (!Number.isFinite(start) || now < start)) return false;
  if (end !== null && (!Number.isFinite(end) || now >= end)) return false;
  return true;
}

function campaignStorageKey(campaign) {
  const revision = `${campaign.revision || campaign.updated_at || campaign.title || 'current'}:${campaign.image_updated_at || ''}`.slice(0, 120);
  const base = `hostel-life-platform-notice-v1:${campaign.kind}:${revision}`;
  if (campaign.frequency === 'once_per_day') return `${base}:${dhakaDayKey()}`;
  return base;
}

function wasShown(campaign) {
  const key = campaignStorageKey(campaign);
  try {
    const store = campaign.frequency === 'once_per_app_open' ? window.sessionStorage : window.localStorage;
    return store.getItem(key) === '1';
  } catch {
    try { return window.sessionStorage.getItem(key) === '1'; } catch { return false; }
  }
}

function markShown(campaign) {
  const key = campaignStorageKey(campaign);
  try {
    const store = campaign.frequency === 'once_per_app_open' ? window.sessionStorage : window.localStorage;
    store.setItem(key, '1');
    return;
  } catch {
    try { window.sessionStorage.setItem(key, '1'); } catch { /* The in-memory ref still prevents repeats in this render. */ }
  }
}

export function PlatformCommunicationOverlays({ communications, blocked = false }) {
  const [clock, setClock] = useState(() => Date.now());
  const [activeCampaign, setActiveCampaign] = useState(null);
  const closeButtonRef = useRef(null);
  const shownThisRender = useRef(new Set());

  const campaigns = useMemo(() => {
    const rows = [];
    const site = communications?.site_notice;
    const windowNotice = communications?.window_notice;
    // Maintenance/site notices take priority, followed by a general window notice.
    if (site) rows.push({ ...site, kind: 'site', frequency: site.frequency || 'once_per_device' });
    if (windowNotice) rows.push({ ...windowNotice, kind: 'window', frequency: windowNotice.frequency || 'once_per_device' });
    return rows.filter((campaign) => campaignIsActive(campaign, clock));
  }, [communications, clock]);

  // A single timeout activates scheduled notices without polling or repeated API calls.
  useEffect(() => {
    const now = Date.now();
    const nextBoundary = [communications?.site_notice, communications?.window_notice]
      .flatMap((item) => [item?.starts_at, item?.ends_at])
      .map((value) => value ? new Date(value).getTime() : NaN)
      .filter((value) => Number.isFinite(value) && value > now)
      .sort((a, b) => a - b)[0];
    if (!nextBoundary) return undefined;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(nextBoundary - now + 25, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [communications, clock]);

  useEffect(() => {
    if (blocked || activeCampaign) return;
    const next = campaigns.find((campaign) => {
      const key = campaignStorageKey(campaign);
      return !shownThisRender.current.has(key) && !wasShown(campaign);
    });
    if (!next) return;
    const key = campaignStorageKey(next);
    shownThisRender.current.add(key);
    markShown(next);
    setActiveCampaign(next);
  }, [blocked, activeCampaign, campaigns]);

  useEffect(() => {
    if (activeCampaign && !campaignIsActive(activeCampaign, clock)) setActiveCampaign(null);
  }, [activeCampaign, clock]);

  // Keep the page from scrolling behind the notice and support keyboard dismissal.
  useEffect(() => {
    if (!activeCampaign || blocked) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveCampaign(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [activeCampaign, blocked]);

  if (!activeCampaign || blocked) return null;
  const close = () => setActiveCampaign(null);
  const isImage = activeCampaign.kind === 'site' && activeCampaign.mode === 'image' && activeCampaign.image_url;

  return (
    <div className="platform-communication-backdrop" role="presentation">
      <section className="platform-communication-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-communication-title">
        <button ref={closeButtonRef} type="button" className="platform-communication-close" onClick={close} aria-label="বন্ধ করুন">×</button>
        <span className={`platform-communication-icon ${activeCampaign.kind === 'site' ? 'is-maintenance' : ''}`}>
          <Icon name={activeCampaign.kind === 'site' ? 'wrench' : 'bell'} size={22} />
        </span>
        <span className="eyebrow">{activeCampaign.kind === 'site' ? 'HOSTEL LIFE · বিজ্ঞপ্তি' : 'HOSTEL LIFE · গুরুত্বপূর্ণ বার্তা'}</span>
        <h2 id="platform-communication-title">{activeCampaign.title || (activeCampaign.kind === 'site' ? 'সাময়িক বিজ্ঞপ্তি' : 'আপনার জন্য একটি বার্তা')}</h2>
        {isImage && <img className="platform-communication-image" src={activeCampaign.image_url} alt={activeCampaign.title || 'Hostel Life বিজ্ঞপ্তি'} loading="eager" />}
        {activeCampaign.body && <p>{activeCampaign.body}</p>}
        <div className="platform-communication-actions">
          <button type="button" className="primary-button" onClick={close}>বুঝেছি</button>
        </div>
      </section>
    </div>
  );
}
