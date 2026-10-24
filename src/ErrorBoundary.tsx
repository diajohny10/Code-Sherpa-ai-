import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <main className="content" role="alert"><h1>Code Sherpa could not display this page</h1><p>Your browser progress has not been cleared.</p><button type="button" onClick={() => window.location.reload()}>Reload page</button></main>
    }
    return this.props.children
  }
}