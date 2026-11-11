import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Rendered instead of the children after an error; `reset` re-renders the children. */
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  /** Changing this value clears the error (e.g. the pathname, so navigating away recovers). */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: string | undefined;
}

/**
 * Catches render errors below it. Errors are logged to this browser's console only: Typeroom
 * sends no error reports anywhere (see the Privacy Policy).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Typeroom hit an unexpected error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset });
    return this.props.children;
  }
}
