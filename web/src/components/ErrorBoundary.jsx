import { Component } from 'react'
import { Link } from 'react-router-dom'
import { usePrefs } from '../lib/prefs.jsx'
import { reportError } from '../lib/report.js'
import Icon from './Icon.jsx'

function Fallback({ onRetry }) {
  const { t } = usePrefs()
  return (
    <main className="page" style={{ justifyContent: 'center', gap: 18 }}>
      <span className="icon-tile coral" style={{ width: 56, height: 56, borderRadius: 18 }}><Icon name="alert" size={28} /></span>
      <h1 className="display" style={{ fontSize: 24, lineHeight: 1.5 }}>{t('crashTitle')}</h1>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.9 }}>{t('crashSub')}</p>
      <button type="button" className="btn btn-primary" onClick={() => location.reload()}>{t('reload')}</button>
      <Link to="/profile/feedback" className="btn btn-secondary" onClick={onRetry}>{t('reportProblem')}</Link>
    </main>
  )
}

// Catches render errors so the user sees a way out instead of a blank page, and reports them.
export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  // Navigating elsewhere clears the error.
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (this.state.error) return <Fallback onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
