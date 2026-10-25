import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { requestVerificationCode } from '../services/api.js';
import { getStorage, removeStorage } from '../services/storage.js';

export const VerificationPage = ({ onDone }) => {
  const { user, verifyAccount, isSubmitting, globalError, setEntryMode } = useApp();
  const pendingEmail = getStorage('waymate_pending_verification_email') || '';
  const codeAlreadySent = getStorage('waymate_pending_verification_sent') === 'true';
  const [email, setEmail] = useState(user?.email || pendingEmail);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(codeAlreadySent ? 'OTP' : 'EMAIL');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState('');

  const send = async e => {
    e.preventDefault();
    if (!email.includes('@')) return setError('Enter a valid campus email address.');
    setError('');
    setSending(true);
    try {
      const result = await requestVerificationCode(email);
      if (!result.emailSent) {
        if (result.developmentVerificationCode) {
          setDevelopmentCode(result.developmentVerificationCode);
          setStep('OTP');
        } else {
          throw new Error('Email delivery is not configured on the backend yet. Configure BREVO_API_KEY and EMAIL_FROM in Vercel before requesting a code.');
        }
      } else {
        setDevelopmentCode('');
        setStep('OTP');
      }
    } catch (err) {
      setError(err.message || 'Could not send verification code.');
    } finally {
      setSending(false);
    }
  };

  const confirm = async e => {
    e.preventDefault();
    if (otp.trim().length !== 6) return setError('Enter the 6-digit verification code.');
    try {
      await verifyAccount({ email, otp });
      removeStorage('waymate_pending_verification_email');
      removeStorage('waymate_pending_verification_sent');
      setStep('SUCCESS');
    } catch (err) {
      setError(err.message || 'Verification failed.');
    }
  };

  return <div className="verification-page"><div className="auth-shell compact-auth"><button type="button" className="brand-lockup auth-brand" onClick={() => setEntryMode('landing')} aria-label="Go to landing page" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}><img src="/waymate-mark.png" alt="" /><span>Way <span>Mate</span></span></button><div className="auth-card">
    <span className="eyebrow"><ShieldCheck size={14} /> Community verification</span>
    <h1>Verify your campus identity.</h1>
    <p>Keep the existing demo verification flow, now presented as a full page instead of a popup.</p>
    {globalError && <div className="auth-error"><AlertCircle size={16} />{globalError.message}<button onClick={globalError.onRetry}><RefreshCw size={13} /> Retry</button></div>}
    {error && <div className="auth-error"><AlertCircle size={16} />{error}</div>}
    {step === 'EMAIL' && <form onSubmit={send} className="auth-form"><label>Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="you@campus.edu" /></label><button className="btn btn-primary btn-block" disabled={sending}>{sending ? "Sending code…" : "Send verification code"} <ArrowRight size={16} /></button><button type="button" className="btn btn-secondary btn-block" style={{ marginTop: '8px' }} onClick={onDone}>Cancel & Return to App</button></form>}
    {step === 'OTP' && <form onSubmit={confirm} className="auth-form"><div className="verify-address">Code sent to <strong>{email}</strong></div><label>6-digit verification code<input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} required placeholder="123456" /></label>{developmentCode && <small>Development code: {developmentCode}</small>}<button className="btn btn-primary btn-block" disabled={isSubmitting}>{isSubmitting ? 'Verifying…' : 'Confirm verification'}</button><button type="button" className="btn btn-secondary btn-block" onClick={() => setStep('EMAIL')}>Back</button></form>}
    {step === 'SUCCESS' && <div className="verify-success"><CheckCircle size={38} /><h2>Community verified.</h2><p>Your trust status is now updated for ride and vehicle-sharing flows.</p><button className="btn btn-primary" onClick={onDone}>Return to Way Mate <ArrowRight size={16} /></button></div>}
  </div></div></div>;
};
