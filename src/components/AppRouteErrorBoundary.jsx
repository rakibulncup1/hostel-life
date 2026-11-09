import React from 'react';

/**
 * Contains render/lifecycle failures in a routed app screen so one broken page
 * cannot leave the entire PWA as a blank white viewport. Errors are reported
 * only to the local console; no user data or error payload is persisted.
 */
export class AppRouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep diagnostics local to the browser; never send them to a database.
    console.error('Hostel Life screen render failed.', error, info?.componentStack || '');
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-route-error-wrap" role="alert" aria-live="assertive">
        <section className="card app-route-error-card">
          <div className="app-route-error-icon" aria-hidden="true">!</div>
          <h1>এই পেজটি লোড করা যায়নি</h1>
          <p>একটি অপ্রত্যাশিত সমস্যার কারণে এই অংশটি দেখানো যাচ্ছে না। আবার চেষ্টা করুন অথবা ড্যাশবোর্ডে ফিরে যান।</p>
          <div className="app-route-error-actions">
            <button type="button" className="primary-button" onClick={() => this.setState({ hasError: false })}>আবার চেষ্টা করুন</button>
            <button type="button" className="secondary-button" onClick={this.props.onReturnToDashboard}>ড্যাশবোর্ডে ফিরে যান</button>
          </div>
        </section>
      </main>
    );
  }
}
