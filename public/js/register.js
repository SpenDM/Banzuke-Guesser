// The Register button and its popover: pick a shikona (kept per browser token) and, optionally,
// sign in with Google or email/password so the shikona and the predictions follow the user to
// every device. Once registered the button shows the shikona; clicking it reopens the popover to
// rename or change the sign-in. Talks to /api/register and /api/me; the sign-in itself is
// Firebase's (auth.js).
import { api, auth, authMessage, cancelled, signInEnabled } from './auth.js';
import { loadProfile, saveProfile } from './storage.js';

/**
 * `els`: {button, box, form, input, error, account, out, in: signedIn, google, emailForm, email,
 * password, create, reset, who, signout, accountMsg}. Fires 'change' with detail
 * { profile, submission, roundId } after every answer from the API (`submission` is the user's
 * prediction for round `roundId`, or null); `shikona` is the registered shikona or null.
 */
export class RegisterController extends EventTarget {
  constructor(els) {
    super();
    this.els = els;
    this.profile = loadProfile() || { shikona: null, signed_in: false, provider: null };
    this.roundId = null;
    this.busy = false;
    els.account.hidden = !signInEnabled;
    els.button.addEventListener('click', () => (els.box.hidden ? this.open() : this.close()));
    els.form.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    els.google.addEventListener('click', () => this.signIn(() => auth.signInWithGoogle()));
    els.emailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.signIn(() => auth.signInWithEmail(els.email.value.trim(), els.password.value));
    });
    els.create.addEventListener('click', () => {
      if (!els.emailForm.reportValidity()) return;
      this.signIn(() => auth.createAccount(els.email.value.trim(), els.password.value));
    });
    els.reset.addEventListener('click', () => this.resetPassword());
    els.signout.addEventListener('click', () => this.signOut());
    document.addEventListener('click', (e) => {
      if (!els.box.hidden && !e.target.closest('.register-wrap')) this.close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.render();
  }

  get shikona() { return this.profile.shikona; }

  /** The round whose submission the API is asked for alongside the profile. */
  setRound(roundId) { this.roundId = roundId; }

  /** Waits for a persisted sign-in to be restored, then asks the API who the user is. */
  async init() {
    await auth.ready;
    await this.refresh().catch(() => {});
  }

  open() {
    this.els.box.hidden = false;
    this.els.input.value = this.profile.shikona || '';
    this.setError('');
    this.setAccountMsg('');
    this.render();
    this.els.input.focus();
  }

  close() { this.els.box.hidden = true; }

  async refresh() {
    const roundId = this.roundId;
    const res = await api(`/api/me?basho=${roundId || ''}`);
    if (!res.ok) throw new Error(`me: HTTP ${res.status}`);
    this.apply(await res.json(), roundId);
  }

  /** Registers (or renames to) the shikona in the input. */
  async save() {
    const shikona = this.els.input.value.trim().replace(/\s+/g, ' ');
    if (!shikona) { this.setError('Enter a shikona'); return; }
    if (await this.register(shikona)) this.close();
  }

  /**
   * POST /api/register with `shikona` (undefined: just fetch the profile, which also folds this
   * browser's anonymous identity into a freshly signed-in account). True on success.
   */
  async register(shikona) {
    this.setError('');
    this.setBusy(true);
    try {
      const roundId = this.roundId;
      const res = await api('/api/register', { method: 'POST', body: { shikona, basho: roundId || undefined } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { this.apply(data, roundId); return true; }
      if (data.error === 'shikona_taken') this.setError('Shikona taken');
      else if (data.error === 'bad_shikona') this.setError('Shikona must be 1–30 characters');
      else if (data.error === 'bad_auth') this.setError('Sign in again');
      else this.setError('Try again');
    } catch {
      this.setError('Try again');
    } finally {
      this.setBusy(false);
    }
    return false;
  }

  /** Runs a Firebase sign-in, then registers the typed shikona (if any) under the account. */
  async signIn(method) {
    this.setAccountMsg('');
    this.setBusy(true);
    try {
      await method();
    } catch (e) {
      if (!cancelled(e)) this.setAccountMsg(authMessage(e));
      this.setBusy(false);
      return;
    }
    this.setBusy(false);
    const typed = this.els.input.value.trim().replace(/\s+/g, ' ');
    // The account's own shikona is kept unless the user typed a different one before signing in.
    const ok = await this.register(typed && typed !== this.profile.shikona ? typed : undefined);
    this.render();
    if (ok && this.profile.shikona) this.close();
    else this.els.input.focus();
  }

  async resetPassword() {
    const email = this.els.email.value.trim();
    if (!email) { this.setAccountMsg('Enter your email address first'); return; }
    this.setBusy(true);
    try {
      await auth.resetPassword(email);
      this.setAccountMsg('Password reset email sent', true);
    } catch (e) {
      this.setAccountMsg(authMessage(e));
    } finally {
      this.setBusy(false);
    }
  }

  async signOut() {
    this.setBusy(true);
    try {
      await auth.signOut();
      await this.refresh();
    } catch {
      this.setAccountMsg('Try again');
    } finally {
      this.setBusy(false);
    }
    this.render();
  }

  /** Takes a profile as /api/me and /api/register answer it; `roundId` is the round `submission` is for. */
  apply(data, roundId = this.roundId) {
    this.profile = { shikona: data.shikona ?? null, signed_in: !!data.signed_in, provider: data.provider ?? null };
    saveProfile(this.profile);
    this.render();
    this.dispatchEvent(new CustomEvent('change', { detail: { profile: this.profile, submission: data.submission ?? null, roundId } }));
  }

  setBusy(busy) {
    this.busy = busy;
    for (const el of this.els.box.querySelectorAll('button')) el.disabled = busy;
  }

  setError(text) { this.els.error.textContent = text; }

  setAccountMsg(text, ok = false) {
    this.els.accountMsg.textContent = text;
    this.els.accountMsg.classList.toggle('ok', ok);
  }

  render() {
    const { button, out, in: signedIn, who, input } = this.els;
    button.textContent = this.profile.shikona || 'Login';
    // Bold only when the button shows the user's shikona (not the plain "Login" label).
    button.classList.toggle('has-shikona', !!this.profile.shikona);
    button.title = this.profile.shikona ? 'Change your shikona or sign-in' : 'Pick a shikona to submit a guess';
    const user = auth.user;
    out.hidden = !!user;
    signedIn.hidden = !user;
    if (user) {
      const via = auth.providerName ? ` via ${auth.providerName}` : '';
      who.textContent = `Signed in as ${user.email || user.displayName || 'account'}${via}`;
    }
    input.placeholder = user && !this.profile.shikona ? 'Pick a shikona' : '';
  }
}
