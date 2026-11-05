import { useEffect, useMemo, useRef, useState } from 'react';
import { SystemNoticeDialog } from './SystemNoticeDialog';

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

function campaignHasMissingImage(campaign) {
  return campaign?.kind === 'site' && campaign.mode === 'image' && !campaign.image_url;
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
    // Do not record the campaign as seen until the user dismisses it.
    // This keeps it visible across route changes/reloads if it was not acknowledged.
    setActiveCampaign(next);
  }, [blocked, activeCampaign, campaigns]);

  useEffect(() => {
    if (activeCampaign && !campaignIsActive(activeCampaign, clock)) setActiveCampaign(null);
  }, [activeCampaign, clock]);

  useEffect(() => {
    if (!activeCampaign) return;
    const latest = campaigns.find((campaign) => campaign.kind === activeCampaign.kind);
    if (!latest) setActiveCampaign(null);
    else if (campaignStorageKey(latest) !== campaignStorageKey(activeCampaign)) setActiveCampaign(latest);
  }, [campaigns, activeCampaign]);

  const closeActiveCampaign = () => {
    if (activeCampaign) {
      const key = campaignStorageKey(activeCampaign);
      shownThisRender.current.add(key);
      markShown(activeCampaign);
      setActiveCampaign(null);
    }
  };

  if (!activeCampaign || blocked) return null;
  const close = closeActiveCampaign;
  const isImage = activeCampaign.kind === 'site' && activeCampaign.mode === 'image' && activeCampaign.image_url;
  const missingImage = campaignHasMissingImage(activeCampaign);
  const title = activeCampaign.title || (activeCampaign.kind === 'site' ? 'সাময়িক বিজ্ঞপ্তি' : 'আপনার জন্য একটি বার্তা');
  const kicker = activeCampaign.kind === 'site' ? 'HOSTEL LIFE · বিজ্ঞপ্তি' : 'HOSTEL LIFE · গুরুত্বপূর্ণ বার্তা';

  if (isImage) {
    return <SystemNoticeDialog imageOnly imageUrl={activeCampaign.image_url} title={title} kicker={kicker} onClose={close} />;
  }

  return (
    <SystemNoticeDialog
      kicker={kicker}
      icon={activeCampaign.kind === 'site' ? 'wrench' : 'bell'}
      title={title}
      onClose={close}
      description={missingImage ? 'এই বিজ্ঞপ্তির ছবি বর্তমানে পাওয়া যাচ্ছে না। অনুগ্রহ করে পরে আবার চেষ্টা করুন।' : ''}
      actions={<button type="button" className="primary-button" onClick={close}>বুঝেছি</button>}
    >
      {activeCampaign.body && <p className="system-notice-description">{activeCampaign.body}</p>}
    </SystemNoticeDialog>
  );
}
