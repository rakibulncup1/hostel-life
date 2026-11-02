import { Icon } from '../../components/Icon';
import { useInstallPromptContext } from '../../contexts/InstallPromptContext';
import { useToast } from '../../components/Toast';

export function AppDownloadPage() {
  const { canInstall, installed, install } = useInstallPromptContext();
  const toast = useToast();

  const installNow = async () => {
    try {
      const accepted = await install();
      if (accepted) toast.success('Hostel Life ইনস্টল করার অনুরোধ গ্রহণ করা হয়েছে।');
      else toast.info('ইনস্টল অপশনটি এখন ব্রাউজারে পাওয়া যাচ্ছে না। নিচের নির্দেশনা অনুসরণ করুন।');
    } catch (error) {
      console.error('PWA install failed:', error);
      toast.error('ইনস্টল করা যায়নি। ব্রাউজারের নির্দেশনা অনুসরণ করুন।');
    }
  };

  return (
    <div className="page-stack app-download-page">
      <section className="menu-page-intro-card card app-download-hero">
        <span className="app-download-hero-icon"><Icon name="smartphone" size={27} /></span>
        <div className="menu-page-title-copy">
          <span className="eyebrow">HOSTEL LIFE · MOBILE EXPERIENCE</span>
          <h1>Hostel Life অ্যাপ ইনস্টল করুন</h1>
          <p>হোম স্ক্রিন থেকে দ্রুত খুলুন, অ্যাপের মতো ব্যবহার করুন—বারবার ব্রাউজারে ঠিকানা লিখতে হবে না।</p>
        </div>
      </section>

      <section className="card app-download-install-card">
        <div className="app-download-install-copy">
          <span className={`app-download-status ${installed ? 'is-installed' : ''}`}><Icon name={installed ? 'check-circle' : 'download'} size={15}/>{installed ? 'ইনস্টল করা আছে' : 'ওয়েব অ্যাপ ইনস্টল'}</span>
          <h2>{installed ? 'Hostel Life আপনার ডিভাইসে আছে' : 'এক ট্যাপে ইনস্টল করুন'}</h2>
          <p>{installed ? 'হোম স্ক্রিন বা অ্যাপ তালিকা থেকে Hostel Life খুলতে পারবেন।' : 'আপনার ব্রাউজার ইনস্টল সমর্থন করলে নিচের বোতামটি ব্যবহার করুন।'}</p>
        </div>
        {canInstall && <button className="primary-button large" type="button" onClick={installNow}><Icon name="download" size={18}/> অ্যাপ ইনস্টল করুন</button>}
        {!canInstall && !installed && <p className="app-download-note"><Icon name="info" size={17}/> এই ব্রাউজারে স্বয়ংক্রিয় Install Prompt পাওয়া যাচ্ছে না। নিচের পদ্ধতি অনুসরণ করে Home Screen-এ যোগ করতে পারবেন।</p>}
      </section>

      <section className="card app-download-steps">
        <div className="panel-header"><div><span className="eyebrow">INSTALL GUIDE</span><h2>আপনার ডিভাইসে ইনস্টল করার নিয়ম</h2><p>ডিভাইস ও ব্রাউজার অনুযায়ী পদ্ধতি বেছে নিন।</p></div></div>
        <article className="app-download-step"><span className="app-download-step-icon"><Icon name="chrome" size={20}/></span><div><strong>Android · Chrome</strong><p>Chrome-এর উপরের তিন-ডট মেনু খুলুন। “Install app” বা “Add to Home screen” নির্বাচন করে নির্দেশনা অনুসরণ করুন।</p></div></article>
        <article className="app-download-step"><span className="app-download-step-icon"><Icon name="compass" size={20}/></span><div><strong>iPhone / iPad · Safari</strong><p>Safari-তে Hostel Life খুলুন। Share বোতাম চাপুন, “Add to Home Screen” নির্বাচন করুন এবং Add চাপুন।</p></div></article>
        <article className="app-download-step"><span className="app-download-step-icon"><Icon name="monitor" size={20}/></span><div><strong>Desktop · Chrome / Edge</strong><p>Address Bar-এর Install আইকন অথবা Browser Menu থেকে “Install Hostel Life” নির্বাচন করুন।</p></div></article>
      </section>

      <section className="app-download-security-note"><Icon name="shield-check" size={18}/><p><strong>নিরাপত্তা ও তথ্য:</strong> এটি Hostel Life-এর Installable Web App (PWA)। অ্যাপ ইনস্টল করলেও আপনার বর্তমান অ্যাকাউন্ট, মেসের সদস্যপদ ও সার্ভারে থাকা তথ্য একই থাকবে।</p></section>
    </div>
  );
}
