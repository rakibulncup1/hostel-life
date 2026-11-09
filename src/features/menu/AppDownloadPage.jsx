import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BrandMark } from '../../components/BrandMark';
import { useInstallPromptContext } from '../../contexts/InstallPromptContext';
import { useToast } from '../../components/Toast';

function getManualInstallGuide() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || '';
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  if (isIOS) return {
    title: 'iPhone বা iPad-এ ইনস্টল',
    message: 'এই ব্রাউজার এখন সরাসরি ইনস্টল অনুমতি দিচ্ছে না। Safari-এর Share মেনু থেকে “Add to Home Screen” নির্বাচন করুন।',
  };
  if (isAndroid) return {
    title: 'Android-এ ইনস্টল',
    message: 'এই ব্রাউজার এখন সরাসরি ইনস্টল অনুমতি দিচ্ছে না। Chrome-এ “Install app” বা “Add to Home screen” নির্বাচন করুন।',
  };
  return {
    title: 'কম্পিউটারে ইনস্টল',
    message: 'এই ব্রাউজার এখন সরাসরি ইনস্টল অনুমতি দিচ্ছে না। Chrome বা Edge-এর Address Bar থেকে Install নির্বাচন করুন।',
  };
}

export function AppDownloadPage() {
  const { canInstall, installed, install } = useInstallPromptContext();
  const toast = useToast();
  const [installing, setInstalling] = useState(false);
  const guide = useMemo(() => getManualInstallGuide(), []);

  const installNow = async () => {
    if (!canInstall || installing) return;
    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted) toast.success('Hostel Life ইনস্টল হয়েছে।');
      else toast.info('ইনস্টল সম্পন্ন হয়নি। চাইলে নিচের নির্দেশনা অনুসরণ করুন।');
    } catch (error) {
      console.error('PWA install failed:', error);
      toast.error('ইনস্টল অনুরোধটি সম্পন্ন হয়নি। নিচের নির্দেশনা অনুসরণ করুন।');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <main className="app-download-page">
      <section className="card app-download-single-card" aria-labelledby="app-download-title">
        <span className="app-download-single-icon" aria-hidden="true"><BrandMark size={62}/></span>
        <span className="eyebrow">HOSTEL LIFE · APP</span>
        <h1 id="app-download-title">{installed ? 'Hostel Life ইনস্টল করা আছে' : 'নিজের ডিভাইসে Hostel Life রাখুন'}</h1>
        <p className="app-download-intro">হোম স্ক্রিন থেকে এক ট্যাপে Hostel Life খুলুন।</p>
        {installed ? (
          <p className="app-download-single-status"><Icon name="check-circle" size={17}/> এই ডিভাইসে অ্যাপটি ইনস্টল করা আছে।</p>
        ) : canInstall ? (
          <button className="primary-button large app-download-single-button" type="button" onClick={installNow} disabled={installing}>
            <Icon name="download" size={19}/>{installing ? 'ইনস্টল হচ্ছে...' : 'এখনই ইনস্টল করুন'}
          </button>
        ) : (
          <div className="app-download-manual-guide">
            <div className="app-download-manual-heading"><Icon name="info" size={18}/><strong>{guide.title}</strong></div>
            <p>{guide.message}</p>
          </div>
        )}
      </section>
    </main>
  );
}
