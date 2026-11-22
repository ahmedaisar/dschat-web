import { useEffect, useState, type FormEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { AuthApiError, useAuthStore } from '../../services/auth/authStore.js'
import styles from './AuthDialog.module.css'

export type AuthDialogMode = 'signIn' | 'signUp' | 'forgotPassword'

export const AuthDialog = ({
  mode,
  onClose,
  onModeChange,
}: {
  mode: AuthDialogMode
  onClose: () => void
  onModeChange: (mode: AuthDialogMode) => void
}) => {
  const t = useTranslate()
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)
  const storeError = useAuthStore((state) => state.error)
  const signIn = useAuthStore((state) => state.signIn)
  const signUp = useAuthStore((state) => state.signUp)
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset)
  const signOut = useAuthStore((state) => state.signOut)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const pending = status === 'loading'

  useEffect(() => {
    setLocalError(null)
    setSubmitted(false)
    setPassword('')
  }, [mode])

  if (user) {
    return (
      <Modal title={t('account')} closable onClose={onClose}>
        <div className={styles.account}>
          <div className={styles.avatar}>{(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}</div>
          <div>
            <strong>{user.name || t('accountUser')}</strong>
            <div className={styles.secondary}>{user.email}</div>
          </div>
        </div>
        {!user.emailVerified ? <p className={styles.notice}>{t('authEmailVerificationPending')}</p> : null}
        <Button
          block
          variant="outlined"
          disabled={pending}
          onClick={async () => {
            try {
              await signOut()
              onClose()
            } catch {
              // The store exposes the error; keep the dialog open.
            }
          }}
        >
          {pending ? t('authWorking') : t('authSignOut')}
        </Button>
      </Modal>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError(null)
    setSubmitted(false)
    try {
      if (mode === 'signIn') {
        await signIn(email, password)
        onClose()
      } else if (mode === 'signUp') {
        await signUp(name, email, password)
        setSubmitted(true)
      } else {
        await requestPasswordReset(email)
        setSubmitted(true)
      }
    } catch (error) {
      if (error instanceof AuthApiError) {
        if (error.status === 503) {
          setLocalError(t('authServiceUnavailable'))
        } else if (error.code === 'INVALID_EMAIL_OR_PASSWORD') {
          setLocalError(t('authInvalidCredentials'))
        } else if (error.status === 400) {
          setLocalError(t('authValidationFailed'))
        } else {
          setLocalError(t('authRequestFailed'))
        }
      } else {
        setLocalError(error instanceof Error ? error.message : t('authRequestFailed'))
      }
    }
  }

  const error = localError ?? storeError
  const title =
    mode === 'signIn'
      ? t('authSignIn')
      : mode === 'signUp'
        ? t('authCreateAccount')
        : t('authForgotPassword')

  return (
    <Modal title={title} closable onClose={onClose}>
      {submitted ? (
        <div className={styles.success} role="status">
          {mode === 'signUp' ? t('authVerificationSent') : t('authResetSent')}
        </div>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {mode === 'signUp' ? (
            <label>
              {t('authName')}
              <input value={name} autoComplete="name" required onChange={(event) => setName(event.target.value)} />
            </label>
          ) : null}
          <label>
            {t('authEmail')}
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {mode !== 'forgotPassword' ? (
            <label>
              {t('authPassword')}
              <input
                type="password"
                value={password}
                autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                minLength={8}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : null}
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <Button block disabled={pending} type="submit">
            {pending ? t('authWorking') : mode === 'forgotPassword' ? t('authSendReset') : title}
          </Button>
        </form>
      )}
      <div className={styles.links}>
        {mode === 'signIn' ? (
          <>
            <button type="button" onClick={() => onModeChange('signUp')}>{t('authNeedAccount')}</button>
            <button type="button" onClick={() => onModeChange('forgotPassword')}>{t('authForgotPassword')}</button>
          </>
        ) : (
          <button type="button" onClick={() => onModeChange('signIn')}>{t('authBackToSignIn')}</button>
        )}
      </div>
    </Modal>
  )
}
