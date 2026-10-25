import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui';

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.error) return <ErrorState message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
