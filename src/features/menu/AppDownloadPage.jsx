import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useInstallPromptContext } from '../../contexts/InstallPromptContext';
import { useToast } from '../../components/Toast';

export function AppDownloadPage() {
  const { canInstall, installed, install } = useInstallPromptContext();
  const toast = useToast();
  const [installing, setInstalling] = useState(false);

  const installNow = async () => {
    if (!canInstall || installing) return;
    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted) toast.success('Hostel Life ইনস্টল হয়েছে।');
      else toast.info('ইনস্টল অনুরোধটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।');
    } catch (error) {
      console.error('PWA install failed:', error);
      toast.error('এখন ইনস্টল করা যায়নি। পরে আবার চেষ্টা করুন।');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <main className="app-download-page">
      <section className="card app-download-single-card" aria-labelledby="app-download-title">
        <span className="app-download-single-icon" aria-hidden="true">
          <Icon name={installed ? 'check-circle' : 'smartphone'} size={32} />
        </span>
        <h1 id="app-download-title">{installed ? 'Hostel Life ইনস্টল করা আছে' : 'Hostel Life অ্যাপ ইনস্টল করুন'}</h1>
        {installed ? (
          <p className="app-download-single-status"><Icon name="check-circle" size={16}/> আপনার ডিভাইসে অ্যাপটি প্রস্তুত।</p>
        ) : canInstall ? (
          <button className="primary-button large app-download-single-button" type="button" onClick={installNow} disabled={installing}>
            <Icon name="download" size={19}/>{installing ? 'ইনস্টল হচ্ছে...' : 'এখনই ইনস্টল করুন'}
          </button>
        ) : (
          <p className="app-download-single-fallback">এই ব্রাউজারে সরাসরি ইনস্টল সুবিধা নেই। Browser Menu থেকে “Add to Home Screen” নির্বাচন করুন।</p>
        )}
      </section>
    </main>
  );
}
