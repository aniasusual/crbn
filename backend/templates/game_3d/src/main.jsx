import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Game Preview Intercepted Error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#090d16',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, system-ui, sans-serif'
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            backgroundColor: '#131826',
            borderRadius: '16px',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                fontSize: '14px',
                fontWeight: 'bold'
              }}>!</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Game Runtime Notice</h3>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.5', margin: '0 0 16px 0' }}>
              The game canvas encountered an issue during update. The agent is resolving this live.
            </p>
            <pre style={{
              backgroundColor: '#0a0d14',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#fca5a5',
              overflowX: 'auto',
              maxHeight: '180px',
              margin: '0 0 16px 0',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              fontFamily: 'JetBrains Mono, monospace'
            }}>
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Retry Canvas
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PreviewErrorBoundary>
      <App />
    </PreviewErrorBoundary>
  </React.StrictMode>
);
