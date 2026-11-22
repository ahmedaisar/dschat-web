import { openAuth } from '../auth/authDialogState.js'
import { useAuthStore } from '../../services/auth/authStore.js'
import { navigate, newConversationPath } from '../../services/routing.js'
import styles from './LandingPage.module.css'

const Arrow = () => <span aria-hidden="true">→</span>

export const LandingPage = () => {
  const authStatus = useAuthStore((state) => state.status)
  const openWorkspace = () => {
    if (authStatus === 'authenticated') {
      navigate(newConversationPath())
    } else {
      openAuth('signUp')
    }
  }

  return (
  <div className={styles.page}>
    <header className={styles.nav}>
      <button className={styles.brand} onClick={() => navigate('/')} aria-label="Go to home">
        <span className={styles.brandMark} aria-hidden="true" />
        <span>deepseek unrestricted</span>
      </button>
      <nav className={styles.navLinks} aria-label="Main navigation">
        <a href="#features">Features</a>
        <a href="#security">Security</a>
        <button className={styles.signIn} onClick={() => openAuth('signIn')}>Sign in</button>
        <button className={styles.navCta} onClick={() => openAuth('signUp')}>Start free <Arrow /></button>
      </nav>
    </header>

    <main>
      <section className={styles.hero}>
        <div className={styles.eyebrow}><span className={styles.liveDot} /> AI conversations, beautifully organized</div>
        <h1>Think clearly.<br /><em>Move faster.</em></h1>
        <p className={styles.heroCopy}>A focused workspace for turning big questions into clear next steps. Threadline keeps your ideas, context, and momentum in one place.</p>
        <div className={styles.actions}>
          <button className={styles.primaryCta} onClick={openWorkspace}>Open your workspace <Arrow /></button>
          <button className={styles.secondaryCta} onClick={() => openAuth('signUp')}>Create a free account</button>
        </div>
        <p className={styles.note}>No credit card required · Free to get started</p>
        <div className={styles.heroVisual} aria-label="Illustration of an organized AI workspace">
          <div className={styles.windowBar}><span /><span /><span /><b>New conversation</b></div>
          <div className={styles.visualBody}><div className={styles.visualSide}><i /><i /><i /><i /></div><div className={styles.visualChat}><div className={styles.prompt}>How can I make this idea clearer?</div><div className={styles.answer}>Let’s find the signal in your thinking.<br /><small>Here are three focused directions to explore...</small></div><div className={styles.input}>Continue the conversation <span>↗</span></div></div></div>
        </div>
      </section>

      <section className={styles.proof}><span>BUILT FOR THE WAY YOU WORK</span><span>Private by default</span><span>⌁ Thoughtful by design</span><span>↗ Ready when you are</span></section>
      <section className={styles.features} id="features">
        <div className={styles.sectionIntro}><p className={styles.kicker}>A calmer way to work with AI</p><h2>Less noise.<br /><em>More momentum.</em></h2></div>
        <div className={styles.featureGrid}><article><div className={styles.icon}>◌</div><h3>Keep context close</h3><p>Your conversations stay organized and easy to return to, so every session starts with the full picture.</p></article><article><div className={styles.icon}>✦</div><h3>Find the next step</h3><p>Move from a blank page to useful progress with an assistant that helps you think, write, and decide.</p></article><article id="security"><div className={styles.icon}>⌁</div><h3>Built with trust</h3><p>Your workspace is yours. We make security, transparent billing, and control part of the experience.</p></article></div>
      </section>
      <section className={styles.finalCta}><p className={styles.kicker}>Your best thinking starts here</p><h2>Make space for<br /><em>what’s next.</em></h2><button className={styles.primaryCta} onClick={openWorkspace}>Open your workspace <Arrow /></button></section>
    </main>
    <footer><span>© 2025 deepseek unrestricted</span><span>Secure workspace · Simple billing · Human support</span></footer>
  </div>
  )
}
